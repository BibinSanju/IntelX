import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// The backend requires a JWT. CI starts it with ENABLE_DEMO_ACCOUNTS=true; override for other envs.
const FACULTY_LOGIN = process.env.E2E_FACULTY_EMAIL || 'faculty@intelx.edu';
const FACULTY_PASSWORD = process.env.E2E_FACULTY_PASSWORD || 'Faculty@123';
const STUDENT_LOGIN = process.env.E2E_STUDENT_EMAIL || 'student@intelx.edu';
const STUDENT_PASSWORD = process.env.E2E_STUDENT_PASSWORD || 'Student@123';

async function login(request: APIRequestContext, apiUrl: string, email: string, password: string) {
  const res = await request.post(`${apiUrl}/login`, { data: { email, password } });
  expect(res.ok(), `login failed for ${email}`).toBeTruthy();
  return (await res.json()) as { token: string; user: unknown };
}

async function useSession(page: Page, frontendUrl: string, session: { token: string; user: unknown }) {
  await page.goto(`${frontendUrl}/login`);
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  }, session);
}

test.describe('End-to-End Question Curation, Sandbox & Moodle XML Pipeline', () => {
  // Free-tier token pacing can intentionally spread the multi-stage Groq work
  // across several minute windows instead of triggering 429 responses.
  test.setTimeout(600000);

  test('should ingest prompt, verify 10/10 in sandbox, stage in UI, and export Moodle XML', async ({ page, request, baseURL }) => {
    const apiUrl = process.env.VITE_API_BASE || 'http://localhost:3000';
    const frontendUrl = baseURL || 'http://localhost:5173';

    const faculty = await login(request, apiUrl, FACULTY_LOGIN, FACULTY_PASSWORD);
    const authHeaders = { Authorization: `Bearer ${faculty.token}` };

    console.log('--- Step 1: Ingesting Raw Interview Question ---');
    const runId = Date.now();
    const rawQuestionText = `Interview Problem ${runId}: Given an array of integers representing stock prices on consecutive days, calculate the maximum profit you can achieve with at most two transactions. You cannot engage in multiple transactions simultaneously. Return the maximum profit as an integer.`;

    const ingestResponse = await request.post(`${apiUrl}/api/ingest`, {
      data: { raw_text: rawQuestionText, source: `Playwright_E2E_${runId}` },
      headers: authHeaders
    });

    expect(ingestResponse.ok()).toBeTruthy();
    const data = await ingestResponse.json();
    const questionId = data.questionId;
    expect(questionId).toBeDefined();

    console.log(`--- Step 2: Polling for Curation & Sandbox 10/10 Verification (ID: ${questionId}) ---`);
    await expect.poll(async () => {
      const statusRes = await request.get(`${apiUrl}/api/status/${questionId}`, { headers: authHeaders });
      if (!statusRes.ok()) return 'PENDING_AI';
      const statusData = await statusRes.json();
      console.log(`[E2E Poll] Status: ${statusData.status} | Verdict: ${statusData.data?.sandboxVerdict || 'Processing...'}`);
      return statusData.status;
    }, {
      message: 'Waiting for Gemini preparation, Groq synthesis, and sandbox execution',
      timeout: 480000,
      intervals: [2000, 3000, 4000]
    }).toBe('STAGED');

    console.log('--- Step 3: Verifying Faculty Staging Dashboard UI ---');
    await useSession(page, frontendUrl, faculty);
    await page.goto(`${frontendUrl}/staging`);
    await expect(page).toHaveTitle(/frontend|IntelX/i);

    // Fetch from the page context so this check exercises browser CORS.
    // Surface an API/CORS regression directly instead of timing out on a missing card.
    const stagingApiResult = await page.evaluate(async ({ url, token }) => {
      try {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        return { ok: response.ok, status: response.status };
      } catch (error) {
        return { ok: false, status: 0, error: String(error) };
      }
    }, { url: `${apiUrl}/api/staged`, token: faculty.token });
    expect(stagingApiResult).toMatchObject({ ok: true, status: 200 });
    await expect(page.locator('.error-banner')).toHaveCount(0);

    const newQuestionCard = page.locator(`.staged-card[data-id="${questionId}"]`);
    await expect(newQuestionCard).toBeVisible({ timeout: 15000 });
    await expect(newQuestionCard).toContainText('STAGED');
    await expect(newQuestionCard).toContainText('Playwright_E2E');

    console.log('--- Step 4: Testing Side-by-Side Testcase Inspector Modal ---');
    const inspectBtn = newQuestionCard.locator('text=Inspect Testcases');
    await expect(inspectBtn).toBeVisible();
    await inspectBtn.click();

    const inspectorModal = page.locator('.inspector-modal');
    await expect(inspectorModal).toBeVisible();
    await expect(inspectorModal).toContainText('10 Standard I/O Test Cases');

    // Close inspector
    await inspectorModal.locator('.close-btn').click();
    await expect(inspectorModal).not.toBeVisible();

    console.log('--- Step 5: Testing Moodle CodeRunner XML Export ---');
    // Test XML export endpoint directly for schema assertion
    const exportResponse = await request.post(`${apiUrl}/api/staged/export-xml`, {
      data: { questionIds: [questionId] },
      headers: authHeaders
    });
    expect(exportResponse.ok()).toBeTruthy();
    const xmlContent = await exportResponse.text();

    expect(xmlContent).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xmlContent).toContain('<quiz>');
    expect(xmlContent).toContain('</quiz>');
    expect(xmlContent).toContain('<question type="coderunner">');
    expect(xmlContent).toContain('<question type="category">');
    expect(xmlContent).toContain('$course$/top/');
    expect(xmlContent).toContain('<coderunnertype>python3</coderunnertype>');

    console.log('--- Step 6: Verifying Student Public Intake Page ---');
    const student = await login(request, apiUrl, STUDENT_LOGIN, STUDENT_PASSWORD);
    await useSession(page, frontendUrl, student);
    await page.goto(`${frontendUrl}/submit-prompt`);
    await expect(page.locator('h1')).toContainText(/Interview Question Feeder/i);
    await expect(page.locator('textarea')).toBeVisible();

    console.log('🎉 Full End-to-End Pipeline & CI Quality Gate Passed Successfully!');
  });
});
