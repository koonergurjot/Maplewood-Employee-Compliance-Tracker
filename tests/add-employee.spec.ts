import { test, expect } from '@playwright/test';

const withTimestamp = (label: string) => `${label} ${Date.now()}`;

test('user can add an employee from the quick add modal', async ({ page }) => {
  await page.goto('/');

  const addEmployeeButton = page.locator('#add-employee-btn');
  await expect(addEmployeeButton).toBeEnabled({ timeout: 20000 });
  await addEmployeeButton.click();

  const nameInput = page.locator('#add-emp-name');
  await expect(nameInput).toBeVisible();

  const employeeName = withTimestamp('Test Employee');
  await nameInput.fill(employeeName);

  const newPosition = withTimestamp('QA Position');
  const positionDialog = page.waitForEvent('dialog');
  await page.click('button[aria-label="Add new position"]');
  const positionPrompt = await positionDialog;
  expect(positionPrompt.type()).toBe('prompt');
  await positionPrompt.accept(newPosition);
  await expect(page.locator('#add-emp-position')).toHaveValue(newPosition);

  const newStatus = withTimestamp('Status');
  const statusDialog = page.waitForEvent('dialog');
  await page.click('button[aria-label="Add new status"]');
  const statusPrompt = await statusDialog;
  expect(statusPrompt.type()).toBe('prompt');
  await statusPrompt.accept(newStatus);
  await expect(page.locator('#add-emp-status')).toHaveValue(newStatus);

  const newRank = withTimestamp('Rank');
  const rankDialog = page.waitForEvent('dialog');
  await page.click('button[aria-label="Add new rank"]');
  const rankPrompt = await rankDialog;
  expect(rankPrompt.type()).toBe('prompt');
  await rankPrompt.accept(newRank);
  await expect(page.locator('#add-emp-rank')).toHaveValue(newRank);

  await page.click('#add-emp-modal button[type="submit"]');
  await expect(page.locator('#add-emp-modal')).toBeHidden();

  const newRow = page.locator('#employee-table tbody tr').filter({ hasText: newPosition });
  await expect(newRow).toBeVisible();
  await expect(newRow).toContainText(employeeName);
  await expect(newRow).toContainText(newStatus);
});
