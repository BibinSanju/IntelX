import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { processQuestionInBackground } from './aiProcessor.js'
import { buildMoodleCodeRunnerXml } from './moodleXmlBuilder.js'

// Prisma 7 explicit connection adapter
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const app = new Hono()
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000
console.log(`Server is running on port ${port}`)

// Allow m1's frontend to talk to your backend
app.use('/*', cors({
  origin: [
    'http://localhost:5173',
    'https://intelxf.vercel.app'
  ],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}))

app.get('/', (c) => {
  return c.json({ status: 'live', message: 'Backend Engine is running 🚀' })
})

app.get('/health', (c) => {
  return c.json({ status: 'healthy', uptime: process.uptime(), timestamp: new Date().toISOString() })
})

// Phase 1: Ingestion API (For Scraper & Student Feeder)
app.post('/api/ingest', async (c) => {
  try {
    const { raw_text, source } = await c.req.json()

    if (!raw_text) {
      return c.json({ success: false, error: 'raw_text is required' }, 400)
    }

    const stagedQuestion = await prisma.stagedQuestion.create({
      data: {
        rawText: raw_text,
        source: source || 'Student',
        status: 'PENDING_AI',
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

// Phase 1: Status Polling API
app.get('/api/status/:id', async (c) => {
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
app.get('/api/staged', async (c) => {
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
app.post('/api/staged/export-xml', async (c) => {
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

    const formatted = questions.map(q => ({
      id: q.id,
      title: q.title || 'Untitled Question',
      description: q.description || q.rawText,
      category: q.category || 'DSA',
      subtopic: q.subtopic || 'General',
      difficulty: 'Medium',
      testCases: (q.testCases as any[]) || []
    }))

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
app.patch('/api/staged/:id', async (c) => {
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
        ...(body.testCases && { testCases: body.testCases })
      }
    })
    return c.json({ success: true, data: updated })
  } catch (error) {
    console.error('Update error:', error)
    return c.json({ success: false, error: 'Failed to update question' }, 500)
  }
})

// Phase 1: Approve Staged Question API
app.post('/api/staged/:id/approve', async (c) => {
  try {
    const id = c.req.param('id')
    const stagedQuestion = await prisma.stagedQuestion.findUnique({
      where: { id }
    })
    
    if (!stagedQuestion || stagedQuestion.status !== 'STAGED') {
      return c.json({ success: false, error: 'Question not ready for approval' }, 400)
    }

    // Move to main Question table
    const question = await prisma.question.create({
      data: {
        title: stagedQuestion.title || 'Untitled',
        description: stagedQuestion.description || stagedQuestion.rawText,
        category: stagedQuestion.category || 'General',
        subtopic: stagedQuestion.subtopic || 'General',
        type: 'Programming',
        difficulty: 'Medium',
        testCases: stagedQuestion.testCases || [],
        metadata: { constraints: stagedQuestion.constraints || '' }
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
app.delete('/api/staged/:id', async (c) => {
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

const JWT_SECRET = process.env.JWT_SECRET || 'hackathon_super_secret'

// Phase 2: Native Signup API
app.post('/signup', async (c) => {
  try {
    const { email, password, username } = await c.req.json()

    // Check if user exists
    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      return c.json({ success: false, error: 'Email already in use' }, 400)
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10)
    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        username
      }
    })

    const token = jwt.sign({ id: newUser.id }, JWT_SECRET, { expiresIn: '24h' })
    return c.json({ success: true, token, user: { id: newUser.id, username: newUser.username } })
  } catch (error) {
    console.error('Signup error:', error)
    return c.json({ success: false, error: 'Signup failed' }, 500)
  }
})

// Phase 2: Native Login API
app.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json()

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.password) {
      return c.json({ success: false, error: 'Invalid credentials' }, 401)
    }

    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) {
      return c.json({ success: false, error: 'Invalid credentials' }, 401)
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '24h' })
    return c.json({ success: true, token, user: { id: user.id, username: user.username } })
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ success: false, error: 'Login failed' }, 500)
  }
})

// Phase 2: Advanced User Profile API (LeetCode Style)
app.get('/users/:id', async (c) => {
  try {
    const userId = c.req.param('id')

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
app.post('/submissions', async (c) => {
  try {
    const { userId, questionId, status, code, language } = await c.req.json()

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
app.get('/questions', async (c) => {
  try {
    const questions = await prisma.question.findMany()
    return c.json({ success: true, data: questions })
  } catch (error) {
    console.error(error)
    return c.json({ success: false, error: 'Failed to fetch questions' }, 500)
  }
})

// GET Single Question API
app.get('/questions/:id', async (c) => {
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