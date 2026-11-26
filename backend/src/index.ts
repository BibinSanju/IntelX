import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import { processQuestionInBackground } from './aiProcessor.js'
import { JWT_SECRET, requireAuth, signToken, safeEqual, resolveCorsOrigin, type AppEnv, type Role } from './auth.js'
import { buildMoodleCodeRunnerXml } from './moodleXmlBuilder.js'
import { validateOnExecutor } from './executorClient.js'
import { transcribeAudio } from './transcribe.js'
import { normalizeEvidenceList } from './leetcodeEnrichmentService.js'
import { ProviderPoolExhaustedError, getProviderPoolSnapshots } from './providerKeyPool.js'
import { authorizeFaculty } from './facultyAuth.js'
import {
  FacultyTextInputError,
  normalizeFacultyTextInput,
} from './facultyTextIngestionService.js'
import {
  SCREENSHOT_MAX_FILES,
  SCREENSHOT_MAX_FILE_BYTES,
  SCREENSHOT_MAX_TOTAL_BYTES,
  buildScreenshotExternalId,
  detectScreenshotMime,
  extractQuestionFromScreenshots,
  type ScreenshotInput,
} from './screenshotIngestionService.js'

// Prisma 7 explicit connection adapter
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const app = new Hono<AppEnv>()
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000
console.log(`Server is running on port ${port}`)

// Only allow known frontends (see CORS_ORIGINS). Auth uses Bearer tokens, not cookies.
app.use('/*', cors({
  origin: (origin) => resolveCorsOrigin(origin),
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))

const authenticated = requireAuth()
const facultyOnly = requireAuth('FACULTY')

app.get('/', (c) => {
  return c.json({ status: 'live', message: 'Backend Engine is running 🚀' })
})

app.get('/health', (c) => {
  try {
    return c.json({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      providerPools: getProviderPoolSnapshots(),
    })
  } catch (error) {
    return c.json({
      status: 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      providerPools: [],
      configurationError: error instanceof Error ? error.message : 'Invalid provider pool configuration',
    }, 503)
  }
})

// Faculty free-form text ingestion. This endpoint is intentionally separate
// from the general scraper endpoint so future frontend controls can enforce a
// faculty-only workflow without exposing provider credentials.
app.post('/api/ingest/text', async (c) => {
  const authorization = authorizeFaculty(c.req.header('Authorization'), JWT_SECRET)
  if (!authorization.ok) {
    return c.json({ success: false, error: authorization.error }, authorization.status)
  }

  try {
    const input = normalizeFacultyTextInput(await c.req.json())
    const existing = await prisma.stagedQuestion.findFirst({
      where: { externalId: input.externalId },
      select: { id: true, status: true },
    })
    if (existing) {
      return c.json({
        success: true,
        message: 'This faculty description was already submitted; processing was not repeated.',
        questionId: existing.id,
        status: existing.status,
        alreadyExists: true,
      })
    }

    const stagedQuestion = await prisma.stagedQuestion.create({
      data: {
        rawText: input.rawText,
        source: 'Faculty Text Description',
        status: 'PENDING_AI',
        inputTags: input.tags,
        inputHints: input.hints,
        sourceUrl: input.sourceUrl,
        externalId: input.externalId,
        sourceMetadata: {
          provider: 'faculty-text',
          content_type: input.contentType,
          submitted_title: input.title || null,
          company: input.company || null,
          interview_round: input.interviewRound || null,
          submitted_by: authorization.userId,
        },
      },
    })

    processQuestionInBackground(stagedQuestion.id).catch(console.error)
    return c.json({
      success: true,
      message: 'Faculty description was queued for curation.',
      questionId: stagedQuestion.id,
      status: stagedQuestion.status,
      contentType: input.contentType,
    }, 202)
  } catch (error) {
    if (error instanceof FacultyTextInputError) {
      return c.json({ success: false, error: error.message }, 400)
    }
    if (error instanceof SyntaxError) {
      return c.json({ success: false, error: 'A valid JSON request body is required.' }, 400)
    }
    console.error('Faculty text ingestion error:', error)
    return c.json({ success: false, error: 'Failed to ingest faculty description.' }, 500)
  }
})

// Faculty screenshot ingestion. Images are used transiently for Groq vision
// extraction and are never persisted. The extracted transcript enters the same
// Groq curation -> deduplication -> staging pipeline as text.
app.post('/api/ingest/screenshots', async (c) => {
  const authorization = authorizeFaculty(c.req.header('Authorization'), JWT_SECRET)
  if (!authorization.ok) {
    return c.json({ success: false, error: authorization.error }, authorization.status)
  }

  const declaredLength = Number(c.req.header('Content-Length') || 0)
  const multipartOverheadAllowance = 2 * 1024 * 1024
  if (Number.isFinite(declaredLength) && declaredLength > SCREENSHOT_MAX_TOTAL_BYTES + multipartOverheadAllowance) {
    return c.json({ success: false, error: 'Screenshot upload is too large.' }, 413)
  }

  try {
    const form = await c.req.formData()
    const entries = ['screenshots', 'files', 'file', 'image']
      .flatMap(field => form.getAll(field))
      .filter((entry): entry is File => typeof entry !== 'string' && typeof entry.arrayBuffer === 'function')

    if (!entries.length) {
      return c.json({
        success: false,
        error: 'Upload at least one screenshot using the screenshots field.',
      }, 400)
    }
    if (entries.length > SCREENSHOT_MAX_FILES) {
      return c.json({
        success: false,
        error: `Upload no more than ${SCREENSHOT_MAX_FILES} screenshots in one question.`,
      }, 400)
    }

    const screenshots: ScreenshotInput[] = []
    let totalBytes = 0
    for (const file of entries) {
      if (!file.size || file.size > SCREENSHOT_MAX_FILE_BYTES) {
        return c.json({
          success: false,
          error: `Each screenshot must be a non-empty file no larger than ${SCREENSHOT_MAX_FILE_BYTES / 1024 / 1024} MB.`,
        }, 400)
      }
      const data = Buffer.from(await file.arrayBuffer())
      const detectedMime = detectScreenshotMime(data)
      if (!detectedMime) {
        return c.json({
          success: false,
          error: 'Only genuine PNG, JPEG, and WebP screenshots are accepted.',
        }, 415)
      }
      totalBytes += data.length
      if (totalBytes > SCREENSHOT_MAX_TOTAL_BYTES) {
        return c.json({
          success: false,
          error: `Combined screenshots must be no larger than ${SCREENSHOT_MAX_TOTAL_BYTES / 1024 / 1024} MB.`,
        }, 413)
      }
      screenshots.push({ data, mimeType: detectedMime })
    }

    const externalId = buildScreenshotExternalId(screenshots)
    const existing = await prisma.stagedQuestion.findFirst({
      where: { externalId },
      select: { id: true, status: true },
    })
    if (existing) {
      return c.json({
        success: true,
        message: 'These screenshots were already submitted; processing was not repeated.',
        questionId: existing.id,
        status: existing.status,
        alreadyExists: true,
      })
    }

    const vision = await extractQuestionFromScreenshots(screenshots)
    const facultyTags = normalizeEvidenceList(form.get('tags'), { maxItems: 15, maxLength: 80 })
    const facultyHints = normalizeEvidenceList(form.get('hints'), {
      maxItems: 12,
      maxLength: 600,
      splitPattern: /\n/,
    })
    const inputTags = normalizeEvidenceList(
      [...facultyTags, ...vision.extraction.visibleTags],
      { maxItems: 15, maxLength: 80 },
    )
    const inputHints = normalizeEvidenceList(
      [...facultyHints, ...vision.extraction.visibleHints],
      { maxItems: 12, maxLength: 600, splitPattern: /\n/ },
    )
    const facultyNotes = typeof form.get('notes') === 'string'
      ? String(form.get('notes')).replace(/[\u0000-\u001F]+/g, ' ').trim().slice(0, 2_000)
      : ''
    const sourceUrl = typeof form.get('source_url') === 'string'
      ? String(form.get('source_url')).trim().slice(0, 2_000) || null
      : null
    const rawText = [
      `# Screenshot evidence (${vision.extraction.detectedPlatform || 'unknown platform'})`,
      vision.extraction.transcript,
      facultyNotes ? `## Faculty notes\n${facultyNotes}` : '',
    ].filter(Boolean).join('\n\n').slice(0, 50_000)

    const stagedQuestion = await prisma.stagedQuestion.create({
      data: {
        rawText,
        source: 'Faculty Screenshot Upload',
        status: 'PENDING_AI',
        inputTags,
        inputHints,
        sourceUrl,
        externalId,
        sourceMetadata: {
          provider: 'faculty-screenshot',
          content_type: 'auto',
          detected_platform: vision.extraction.detectedPlatform,
          screenshot_count: screenshots.length,
          screenshot_bytes: totalBytes,
          screenshots_retained: false,
          extraction_model: vision.model,
          extraction_warnings: vision.extraction.warnings,
          submitted_by: authorization.userId,
        },
      },
    })

    // Buffers become unreachable after this request; only extracted text and
    // non-identifying audit metadata are retained.
    processQuestionInBackground(stagedQuestion.id).catch(console.error)
    return c.json({
      success: true,
      message: 'Screenshots were extracted and queued for curation.',
      questionId: stagedQuestion.id,
      status: stagedQuestion.status,
      extraction: {
        detectedPlatform: vision.extraction.detectedPlatform,
        screenshotCount: screenshots.length,
        warnings: vision.extraction.warnings,
        transcriptPreview: vision.extraction.transcript.slice(0, 500),
      },
    }, 202)
  } catch (error) {
    console.error('Screenshot ingestion error:', error)
    if (error instanceof ProviderPoolExhaustedError) {
      if (error.retryAfterMs) c.header('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))))
      return c.json({
        success: false,
        error: 'Screenshot extraction capacity is temporarily exhausted. Please retry later.',
      }, 503)
    }
    const message = error instanceof Error ? error.message : 'Screenshot ingestion failed.'
    if (/No readable interview-question content/.test(message)) {
      return c.json({ success: false, error: message }, 422)
    }
    return c.json({ success: false, error: 'Failed to extract and ingest screenshots.' }, 500)
  }
})

// Phase 1: Ingestion API (For Scraper & Student Feeder)
app.post('/api/ingest', authenticated, async (c) => {
  try {
    const body = await c.req.json()
    const { raw_text, source, source_url, external_id, source_metadata } = body

    if (typeof raw_text !== 'string' || !raw_text.trim()) {
      return c.json({ success: false, error: 'raw_text is required' }, 400)
    }

    if (raw_text.length > 50000) {
      return c.json({ success: false, error: 'raw_text must be 50,000 characters or fewer' }, 400)
    }

    const inputTags = normalizeEvidenceList(body.tags, { maxItems: 15, maxLength: 80 })
    const inputHints = normalizeEvidenceList(body.hints, {
      maxItems: 12,
      maxLength: 600,
      splitPattern: /\n/
    })
    const normalizedExternalId = typeof external_id === 'string'
      ? external_id.trim().slice(0, 200) || null
      : null

    if (normalizedExternalId) {
      const existing = await prisma.stagedQuestion.findFirst({
        where: { externalId: normalizedExternalId },
        select: { id: true, status: true },
      })
      if (existing) {
        return c.json({
          success: true,
          message: 'Question already exists; ingestion was not repeated',
          questionId: existing.id,
          status: existing.status,
          alreadyExists: true,
        })
      }
    }

    const stagedQuestion = await prisma.stagedQuestion.create({
      data: {
        rawText: raw_text.trim(),
        source: typeof source === 'string' && source.trim() ? source.trim().slice(0, 200) : 'Student',
        status: 'PENDING_AI',
        inputTags,
        inputHints,
        sourceUrl: typeof source_url === 'string' ? source_url.trim().slice(0, 2000) || null : null,
        externalId: normalizedExternalId,
        sourceMetadata: source_metadata && typeof source_metadata === 'object' ? source_metadata : undefined,
      }
    })

    // Trigger AI processing in background
    processQuestionInBackground(stagedQuestion.id).catch(console.error)

    return c.json({ 
      success: true, 
      message: 'Question ingested successfully',
      questionId: stagedQuestion.id 
    })
  } catch (error) {
    console.error('Ingestion error:', error)
    return c.json({ success: false, error: 'Failed to ingest question' }, 500)
  }
})

// Speech-to-Text (STT) Transcription API using Groq Whisper Large v3 Turbo
app.post('/api/transcribe', authenticated, async (c) => {
  try {
    const body = await c.req.parseBody()
    const audioFile = (body['file'] || body['audio']) as unknown as File

    if (!audioFile) {
      return c.json({ 
        success: false, 
        error: 'No audio file provided. Please record speech or upload an audio file.' 
      }, 400)
    }

    // Size limit check (25 MB max)
    const MAX_SIZE = 25 * 1024 * 1024
    if (audioFile.size && audioFile.size > MAX_SIZE) {
      return c.json({ 
        success: false, 
        error: 'Audio file exceeds 25 MB size limit.' 
      }, 400)
    }

    const arrayBuffer = await audioFile.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const fileName = audioFile.name || 'recording.webm'
    const mimeType = audioFile.type || 'audio/webm'

    console.log(`[STT Endpoint] Processing audio upload: ${fileName} (${mimeType}, ${buffer.length} bytes)`)
    const result = await transcribeAudio(buffer, fileName, mimeType)

    return c.json({
      success: true,
      text: result.text,
      model: result.model,
      duration: result.duration,
    })
  } catch (error: any) {
    console.error('Transcription error:', error)
    if (error instanceof ProviderPoolExhaustedError) {
      if (error.retryAfterMs) c.header('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))))
      return c.json({
        success: false,
        error: 'Transcription capacity is temporarily exhausted. Please retry later.',
      }, 503)
    }
    return c.json({ 
      success: false, 
      error: error.message || 'Failed to transcribe audio' 
    }, 500)
  }
})

// Phase 1: Status Polling API
app.get('/api/status/:id', authenticated, async (c) => {
  try {
    const id = c.req.param('id')
    const stagedQuestion = await prisma.stagedQuestion.findUnique({
      where: { id }
    })
    
    if (!stagedQuestion) {
      return c.json({ success: false, error: 'Question not found' }, 404)
    }

    return c.json({ success: true, status: stagedQuestion.status, data: stagedQuestion })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to fetch status' }, 500)
  }
})

// Phase 1: Staged Questions API for Faculty UI (Supports status filter)
app.get('/api/staged', facultyOnly, async (c) => {
  try {
    const status = c.req.query('status')
    const where = status ? { status } : {}
    const questions = await prisma.stagedQuestion.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    })
    return c.json({ success: true, data: questions })
  } catch (error) {
    return c.json({ success: false, error: 'Failed to fetch staged questions' }, 500)
  }
})

// Phase 1: Export Selected / All Staged Questions as Moodle CodeRunner XML
app.post('/api/staged/export-xml', facultyOnly, async (c) => {
  try {
    const { questionIds } = await c.req.json()
    let questions = []

    if (Array.isArray(questionIds) && questionIds.length > 0) {
      questions = await prisma.stagedQuestion.findMany({
        where: { id: { in: questionIds } }
      })
    } else {
      questions = await prisma.stagedQuestion.findMany({
        where: { status: 'STAGED' }
      })
    }

    const formatted = questions.map(q => {
      const sourceMetadata = q.sourceMetadata && typeof q.sourceMetadata === 'object' ? q.sourceMetadata as any : {}
      const enrichment = q.enrichment && typeof q.enrichment === 'object' ? q.enrichment as any : {}
      const isTheory = sourceMetadata.content_type === 'theory' || enrichment.contentType === 'theory'
      return {
        id: q.id,
        title: q.title || 'Untitled Question',
        description: q.description || q.rawText,
        category: q.category || 'DSA',
        subtopic: q.subtopic || 'General',
        difficulty: enrichment.difficulty || 'Medium',
        type: isTheory ? 'Theory' as const : 'Programming' as const,
        metadata: isTheory ? enrichment.metadata : undefined,
        solutionCode: q.solutionCode || undefined,
        testCases: (q.testCases as any[]) || []
      }
    })

    const xml = buildMoodleCodeRunnerXml(formatted)
    c.header('Content-Type', 'application/xml')
    c.header('Content-Disposition', 'attachment; filename="moodle_coderunner_export.xml"')
    return c.body(xml)
  } catch (error) {
    console.error('XML Export error:', error)
    return c.json({ success: false, error: 'Failed to generate XML' }, 500)
  }
})

// Phase 1: Update Staged Question (Edit title, taxonomy, testcases)
app.patch('/api/staged/:id', facultyOnly, async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const updated = await prisma.stagedQuestion.update({
      where: { id },
      data: {
        ...(body.title && { title: body.title }),
        ...(body.category && { category: body.category }),
        ...(body.subtopic && { subtopic: body.subtopic }),
        ...(body.description && { description: body.description }),
        ...(body.testCases && { testCases: body.testCases }),
        ...(body.tags !== undefined && { inputTags: normalizeEvidenceList(body.tags, { maxItems: 15, maxLength: 80 }) }),
        ...(body.hints !== undefined && {
          inputHints: normalizeEvidenceList(body.hints, { maxItems: 12, maxLength: 600, splitPattern: /\n/ })
        })
      }
    })
    return c.json({ success: true, data: updated })
  } catch (error) {
    console.error('Update error:', error)
    return c.json({ success: false, error: 'Failed to update question' }, 500)
  }
})

// Phase 1: Approve Staged Question API
app.post('/api/staged/:id/approve', facultyOnly, async (c) => {
  try {
    const id = c.req.param('id')
    const stagedQuestion = await prisma.stagedQuestion.findUnique({
      where: { id }
    })
    
    if (!stagedQuestion || stagedQuestion.status !== 'STAGED') {
      return c.json({ success: false, error: 'Question not ready for approval' }, 400)
    }

    const sourceMetadata = stagedQuestion.sourceMetadata && typeof stagedQuestion.sourceMetadata === 'object'
      ? stagedQuestion.sourceMetadata as any
      : {}
    const enrichment = stagedQuestion.enrichment && typeof stagedQuestion.enrichment === 'object'
      ? stagedQuestion.enrichment as any
      : {}
    const isTheory = sourceMetadata.content_type === 'theory' || enrichment.contentType === 'theory'

    // Move to main Question table
    const question = await prisma.question.create({
      data: {
        title: stagedQuestion.title || 'Untitled',
        description: stagedQuestion.description || stagedQuestion.rawText,
        category: stagedQuestion.category || 'General',
        subtopic: stagedQuestion.subtopic || 'General',
        type: isTheory ? 'Theory' : 'Programming',
        difficulty: isTheory && ['Easy', 'Medium', 'Hard'].includes(enrichment.difficulty)
          ? enrichment.difficulty
          : 'Medium',
        testCases: isTheory ? undefined : stagedQuestion.testCases || [],
        metadata: {
          ...(isTheory && enrichment.metadata ? enrichment.metadata : {}),
          constraints: stagedQuestion.constraints || '',
          ingestion: {
            source: stagedQuestion.source,
            sourceUrl: stagedQuestion.sourceUrl,
            externalId: stagedQuestion.externalId,
            inputTags: stagedQuestion.inputTags,
            inputHints: stagedQuestion.inputHints,
            sourceMetadata: stagedQuestion.sourceMetadata,
          },
          enrichment: stagedQuestion.enrichment,
          verification: {
            sandboxVerdict: stagedQuestion.sandboxVerdict,
            solutionLanguage: stagedQuestion.solutionLang,
          }
        }
      }
    })

    // Update status to APPROVED
    await prisma.stagedQuestion.update({
      where: { id },
      data: { status: 'APPROVED' }
    })

    return c.json({ success: true, data: question })
  } catch (error) {
    console.error('Approval error:', error)
    return c.json({ success: false, error: 'Failed to approve question' }, 500)
  }
})

// Phase 1: Discard Staged Question API
app.delete('/api/staged/:id', facultyOnly, async (c) => {
  try {
    const id = c.req.param('id')
    await prisma.stagedQuestion.delete({
      where: { id }
    })
    return c.json({ success: true, message: 'Question discarded' })
  } catch (error) {
    console.error('Discard error:', error)
    return c.json({ success: false, error: 'Failed to discard question' }, 500)
  }
})

// Demo accounts are only provisioned when explicitly enabled (ENABLE_DEMO_ACCOUNTS=true).
// Their passwords are public, so never enable this on a deployment holding real data.
const DEMO_ACCOUNTS_ENABLED = process.env.ENABLE_DEMO_ACCOUNTS === 'true'
const DEMO_ACCOUNTS: Array<{ email: string; username: string; password: string; role: Role }> = [
  { email: 'faculty@intelx.edu', username: 'Faculty Professor', password: 'Faculty@123', role: 'FACULTY' },
  { email: 'student@intelx.edu', username: 'Student Candidate', password: 'Student@123', role: 'STUDENT' },
]

async function ensureDemoAccount(identifier: string) {
  if (!DEMO_ACCOUNTS_ENABLED) return
  const demo = DEMO_ACCOUNTS.find(d => d.email === identifier.toLowerCase())
  if (!demo) return
  const existing = await prisma.user.findUnique({ where: { email: demo.email } })
  if (existing) return
  await prisma.user.create({
    data: {
      email: demo.email,
      username: demo.username,
      password: await bcrypt.hash(demo.password, 10),
      role: demo.role,
    },
  })
}

// Phase 2: Native Signup API
app.post('/signup', async (c) => {
  try {
    const body = await c.req.json()
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!email || !username || !password) {
      return c.json({ success: false, error: 'Username, email and password are required' }, 400)
    }
    if (password.length < 6) {
      return c.json({ success: false, error: 'Password must be at least 6 characters' }, 400)
    }

    // Faculty accounts require the faculty invite code configured on the server.
    let userRole: Role = 'STUDENT'
    if (body.role === 'FACULTY') {
      const inviteCode = (process.env.FACULTY_SIGNUP_CODE || '').trim()
      const provided = typeof body.facultyCode === 'string' ? body.facultyCode.trim() : ''
      if (!inviteCode || !provided || !safeEqual(provided, inviteCode)) {
        return c.json({ success: false, error: 'A valid faculty invite code is required to register as faculty' }, 403)
      }
      userRole = 'FACULTY'
    }

    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      return c.json({ success: false, error: 'Email already in use' }, 400)
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        username,
        role: userRole
      }
    })

    const token = signToken({ id: newUser.id, role: userRole })
    return c.json({
      success: true,
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        role: userRole
      }
    })
  } catch (error) {
    console.error('Signup error:', error)
    return c.json({ success: false, error: 'Signup failed' }, 500)
  }
})

// Phase 2: Native Login API (Supports Email or Username & Roles)
app.post('/login', async (c) => {
  try {
    const { email, password, expectedRole } = await c.req.json()
    const identifier = (typeof email === 'string' ? email : '').trim()
    if (!identifier || typeof password !== 'string' || !password) {
      return c.json({ success: false, error: 'Invalid credentials' }, 401)
    }

    await ensureDemoAccount(identifier)

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier.toLowerCase() },
          { email: identifier },
          { username: identifier }
        ]
      }
    })

    // Only bcrypt verification; no master passwords or plaintext comparisons.
    const isValid = !!user?.password && await bcrypt.compare(password, user.password)
    if (!user || !isValid) {
      return c.json({ success: false, error: 'Invalid credentials' }, 401)
    }

    const assignedRole: Role = user.role === 'FACULTY' ? 'FACULTY' : 'STUDENT'

    // If expectedRole is specified, inform the user if their account has a different role
    if (expectedRole && expectedRole !== assignedRole) {
      return c.json({
        success: false,
        error: `This account is registered as ${assignedRole}. Please switch to the ${assignedRole.toLowerCase()} portal.`
      }, 403)
    }

    const token = signToken({ id: user.id, role: assignedRole })
    return c.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: assignedRole
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ success: false, error: 'Login failed' }, 500)
  }
})

// Phase 2: Advanced User Profile API (LeetCode Style)
app.get('/users/:id', authenticated, async (c) => {
  try {
    const userId = c.req.param('id')
    const requester = c.get('user')
    if (requester.id !== userId && requester.role !== 'FACULTY') {
      return c.json({ success: false, error: 'Forbidden' }, 403)
    }

    // Fetch user and all their submissions, including the related question data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        submissions: {
          include: { question: true }
        }
      }
    })

    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404)
    }

    // Process data for the frontend dashboard
    const passedSubmissions = user.submissions.filter(sub => sub.status === 'Pass')

    // 1. Total Solved Count (Unique questions passed)
    const uniqueSolvedIds = new Set(passedSubmissions.map(sub => sub.questionId))
    const totalSolved = uniqueSolvedIds.size

    // 2. Difficulty Breakdown (Easy, Medium, Hard)
    const difficultyStats = passedSubmissions.reduce((acc: any, sub) => {
      const diff = sub.question.difficulty || 'Medium'
      if (!acc[diff]) acc[diff] = new Set()
      acc[diff].add(sub.questionId)
      return acc
    }, {})

    const formattedDifficulty = {
      Easy: difficultyStats['Easy']?.size || 0,
      Medium: difficultyStats['Medium']?.size || 0,
      Hard: difficultyStats['Hard']?.size || 0,
    }

    // 3. Calendar Data (Submissions grouped by date for heatmap)
    const calendarData = user.submissions.reduce((acc: any, sub) => {
      const dateString = sub.submittedAt.toISOString().split('T')[0]
      acc[dateString] = (acc[dateString] || 0) + 1
      return acc
    }, {})

    // Calculate Max Streak and Total Active Days
    const activeDays = Object.keys(calendarData).sort()
    const totalActiveDays = activeDays.length
    let maxStreak = 0
    let currentStreak = 0
    let previousDate: Date | null = null

    for (const dateStr of activeDays) {
      const date = new Date(dateStr)
      if (!previousDate) {
        currentStreak = 1
      } else {
        const diffTime = Math.abs(date.getTime() - previousDate.getTime())
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
        if (diffDays === 1) {
          currentStreak++
        } else {
          currentStreak = 1
        }
      }
      maxStreak = Math.max(maxStreak, currentStreak)
      previousDate = date
    }

    // Query for total questions
    const totalQuestions = await prisma.question.count()
    const totalEasy = await prisma.question.count({ where: { difficulty: 'Easy' } })
    const totalMedium = await prisma.question.count({ where: { difficulty: 'Medium' } })
    const totalHard = await prisma.question.count({ where: { difficulty: 'Hard' } })

    // Pass all the user fields from the schema as well
    return c.json({
      success: true,
      data: {
        username: user.username,
        joinedAt: user.createdAt,
        rank: user.rank,
        reputation: user.reputation,
        views: user.views,
        discuss: user.discuss,
        solution: user.solution,
        contestRating: user.contestRating,
        globalRanking: user.globalRanking,
        attendedContests: user.attendedContests,
        stats: {
          totalSolved,
          difficultyBreakdown: formattedDifficulty,
          calendarHeatmap: calendarData,
          totalActiveDays,
          maxStreak
        },
        totalAvailable: {
          Total: totalQuestions,
          Easy: totalEasy,
          Medium: totalMedium,
          Hard: totalHard
        },
        recentSubmissions: user.submissions.slice(-10)
      }
    })

  } catch (error) {
    console.error('User fetch error:', error)
    return c.json({ success: false, error: 'Failed to fetch user profile' }, 500)
  }
})

// Phase 3: Record Submission API
app.post('/submissions', authenticated, async (c) => {
  try {
    // The submitter is always the authenticated user, and the verdict is computed server-side.
    const userId = c.get('user').id
    const { questionId, code, language } = await c.req.json()
    if (typeof questionId !== 'string' || typeof code !== 'string' || !code.trim() || typeof language !== 'string') {
      return c.json({ success: false, error: 'questionId, code and language are required' }, 400)
    }

    const question = await prisma.question.findUnique({ where: { id: questionId } })
    if (!question) {
      return c.json({ success: false, error: 'Question not found' }, 404)
    }
    const testCases = Array.isArray(question.testCases) ? question.testCases : []
    if (testCases.length === 0) {
      return c.json({ success: false, error: 'This question has no test cases to grade against' }, 400)
    }

    let status = 'Fail'
    try {
      const verdict = await validateOnExecutor(language, code, testCases)
      status = verdict?.allPassed === true ? 'Pass' : 'Fail'
    } catch (err) {
      console.error('Grading error:', err)
      return c.json({ success: false, error: 'Grading service unavailable' }, 503)
    }

    const submission = await prisma.submission.create({
      data: {
        userId,
        questionId,
        status,
        code,
        language
      }
    })

    return c.json({ success: true, data: submission })
  } catch (error) {
    console.error('Submission error:', error)
    return c.json({ success: false, error: 'Failed to record submission' }, 500)
  }
})

// Phase 2: GET Questions API
app.get('/questions', facultyOnly, async (c) => {
  try {
    const questions = await prisma.question.findMany()
    return c.json({ success: true, data: questions })
  } catch (error) {
    console.error(error)
    return c.json({ success: false, error: 'Failed to fetch questions' }, 500)
  }
})

// GET Single Question API
app.get('/questions/:id', facultyOnly, async (c) => {
  try {
    const id = c.req.param('id')
    const question = await prisma.question.findUnique({
      where: { id }
    })
    if (!question) {
      return c.json({ success: false, error: 'Question not found' }, 404)
    }
    return c.json({ success: true, data: question })
  } catch (error) {
    console.error(error)
    return c.json({ success: false, error: 'Failed to fetch question' }, 500)
  }
})



serve({
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0'
})
