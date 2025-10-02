const { test, expect } = require('@playwright/test');

test('dashboard loads in legacy-compatible bundle', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto('/', { waitUntil: 'load' });

  await page.waitForFunction(() => {
    const dashboard = document.getElementById('dashboard-app');
    const fallback = document.getElementById('alpine-fallback');
    return Boolean(dashboard && !dashboard.hasAttribute('hidden') && fallback && fallback.hasAttribute('hidden'));
  }, { timeout: 20000 });

  await page.waitForTimeout(500);

  const filteredErrors = consoleErrors.filter((message) => {
    if (message.includes('Failed to load resource')) return false;
    if (message.includes('XLSX library failed to load')) return false;
    if (message.includes('Alternative XLSX CDN also failed to load')) return false;
    return true;
  });

  expect(filteredErrors).toEqual([]);
});
