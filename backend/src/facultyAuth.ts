import jwt from 'jsonwebtoken';

export type FacultyAuthorizationResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string };

export function authorizeFaculty(
  authorizationHeader: string | undefined,
  secret: string,
): FacultyAuthorizationResult {
  const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, status: 401, error: 'A faculty Bearer token is required.' };
  }

  try {
    const payload = jwt.verify(match[1], secret);
    if (!payload || typeof payload === 'string') {
      return { ok: false, status: 401, error: 'The authentication token is invalid.' };
    }
    if (payload.role !== 'FACULTY') {
      return { ok: false, status: 403, error: 'Only faculty users can upload screenshots.' };
    }
    return { ok: true, userId: typeof payload.id === 'string' ? payload.id : 'unknown' };
  } catch {
    return { ok: false, status: 401, error: 'The authentication token is invalid or expired.' };
  }
}
