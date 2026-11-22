export const EXECUTOR_URL = process.env.EXECUTOR_URL || 'http://localhost:8080'

/** Headers for calls to the executor; includes the shared secret when EXECUTOR_TOKEN is configured. */
export function executorHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = (process.env.EXECUTOR_TOKEN || '').trim()
  if (token) headers['X-Executor-Token'] = token
  return headers
}

export async function validateOnExecutor(language: string, code: string, testCases: unknown[]) {
  const res = await fetch(`${EXECUTOR_URL}/validate`, {
    method: 'POST',
    headers: executorHeaders(),
    body: JSON.stringify({ language, code, testCases }),
  })
  return res.json() as Promise<any>
}
