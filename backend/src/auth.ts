import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import type { Context, Next } from 'hono'

export type Role = 'STUDENT' | 'FACULTY'
export interface AuthUser {
  id: string
  role: Role
}
export type AppEnv = { Variables: { user: AuthUser } }

// JWT secret: mandatory in production. In development a random per-process secret is used
// (tokens are invalidated on restart) so a well-known fallback can never be used to forge tokens.
function resolveJwtSecret(): string {
  const secret = (process.env.JWT_SECRET || '').trim()
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production')
  }
  console.warn('[Auth] JWT_SECRET is not set; using a random development secret (tokens reset on restart).')
  return crypto.randomBytes(32).toString('hex')
}

export const JWT_SECRET = resolveJwtSecret()

export function signToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '24h' })
}

/** Middleware: requires a valid Bearer token; optionally restricts to the given roles. */
export function requireAuth(...roles: Role[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const header = c.req.header('Authorization') || ''
    const match = header.match(/^Bearer\s+(.+)$/i)
    if (!match) {
      return c.json({ success: false, error: 'Authentication required' }, 401)
    }
    let payload: any
    try {
      payload = jwt.verify(match[1], JWT_SECRET, { algorithms: ['HS256'] })
    } catch {
      return c.json({ success: false, error: 'Invalid or expired token' }, 401)
    }
    if (!payload || typeof payload.id !== 'string' || (payload.role !== 'STUDENT' && payload.role !== 'FACULTY')) {
      return c.json({ success: false, error: 'Invalid token' }, 401)
    }
    if (roles.length > 0 && !roles.includes(payload.role)) {
      return c.json({ success: false, error: 'Forbidden' }, 403)
    }
    c.set('user', { id: payload.id, role: payload.role })
    await next()
  }
}

/** Constant-time string comparison (for invite codes / shared secrets). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

// CORS: explicit allowlist (CORS_ORIGINS, comma-separated) plus local dev origins.
const DEFAULT_ORIGINS = 'https://intelxf.vercel.app,https://intel-x-sage.vercel.app'
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || DEFAULT_ORIGINS).split(',').map(s => s.trim()).filter(Boolean)
)
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export function resolveCorsOrigin(origin: string): string | null {
  if (!origin) return null
  if (allowedOrigins.has(origin)) return origin
  if (process.env.NODE_ENV !== 'production' && LOCAL_ORIGIN.test(origin)) return origin
  return null
}
