// Use playwright's page.setInputFiles with file content from Node.js
const fs = require('fs');

module.exports = async (page, args) => {
  // Step 1: Navigate to homepage
  await page.goto('https://20260704155001.vercel.app/');
  await page.waitForLoadState('networkidle');

  // Step 2: Find and click AI mode button
  await page.getByText('AI 智能识别').click();
  await page.waitForTimeout(500);

  // Step 3: Set file on the hidden input
  const fileInput = page.locator('input[type=file]').first();
  await fileInput.setInputFiles('test-data/10000-orders.xlsx');

  // Step 4: Wait for AI analysis to complete (button appears)
  await page.waitForSelector('button.bg-jingtian', { timeout: 60000 });

  // Step 5: Capture the fetch response when submitting
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/import-tasks') && r.request().method() === 'POST', { timeout: 60000 }),
    page.click('button.bg-jingtian'),
  ]);

  const status = response.status();
  const body = await response.text();
  return JSON.stringify({ status, body: body.slice(0, 3000) }, null, 2);
};