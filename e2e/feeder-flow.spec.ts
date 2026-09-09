import { test, expect } from '@playwright/test';

test.describe('End-to-End Question Curation, Sandbox & Moodle XML Pipeline', () => {
  test.setTimeout(90000);

  test('should ingest prompt, verify 10/10 in sandbox, stage in UI, and export Moodle XML', async ({ page, request, baseURL }) => {
    const apiUrl = process.env.VITE_API_BASE || 'http://localhost:3000';
    const frontendUrl = baseURL || 'http://localhost:5173';

    console.log('--- Step 1: Ingesting Raw Interview Question ---');
    const rawQuestionText = "Given a 2D grid of 0s and 1s, find the shortest path from the top-left to bottom-right cell avoiding obstacles (1s). Return the minimum steps or -1 if unreachable.";

    const ingestResponse = await request.post(`${apiUrl}/api/ingest`, {
      data: { raw_text: rawQuestionText, source: "Playwright_E2E" }
    });

    expect(ingestResponse.ok()).toBeTruthy();
    const data = await ingestResponse.json();
    const questionId = data.questionId;
    expect(questionId).toBeDefined();

    console.log(`--- Step 2: Polling for Curation & Sandbox 10/10 Verification (ID: ${questionId}) ---`);
    await expect.poll(async () => {
      const statusRes = await request.get(`${apiUrl}/api/status/${questionId}`);
      if (!statusRes.ok()) return 'PENDING_AI';
      const statusData = await statusRes.json();
      return statusData.status;
    }, {
      message: 'Waiting for Groq synthesis and Sandbox execution',
      timeout: 60000
    }).toBe('STAGED');

    console.log('--- Step 3: Verifying Faculty Staging Dashboard UI ---');
    await page.goto(`${frontendUrl}/staging`);
    await expect(page).toHaveTitle(/frontend|IntelX/i);

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
      data: { questionIds: [questionId] }
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
    await page.goto(`${frontendUrl}/submit-prompt`);
    await expect(page.locator('h1')).toContainText('Campus Interview Question Feeder');
    await expect(page.locator('textarea')).toBeVisible();

    console.log('🎉 Full End-to-End Pipeline & CI Quality Gate Passed Successfully!');
  });
});
