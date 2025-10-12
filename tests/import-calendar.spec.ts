import { test, expect, Page } from '@playwright/test';
import path from 'node:path';

const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'sample-import.csv');

async function mapField(page: Page, fieldLabel: string, optionLabel: string) {
  const row = page.getByRole('listitem').filter({ hasText: fieldLabel }).first();
  const combo = row.getByRole('combobox');
  await expect(combo).toBeVisible();
  await combo.selectOption({ label: optionLabel });
}

async function mapRequirement(page: Page, requirementName: string, optionLabel: string) {
  const label = page.locator('label').filter({ hasText: requirementName }).first();
  await expect(label).toBeVisible();
  const select = label.locator('xpath=../select');
  await expect(select).toBeVisible();
  await select.selectOption({ label: optionLabel });
}

async function navigateCalendarTo(page: Page, target: Date) {
  const titleLocator = page.locator('.fc-toolbar-title');
  await expect(titleLocator).toBeVisible();

  const maxIterations = 48;
  for (let i = 0; i < maxIterations; i += 1) {
    const titleText = (await titleLocator.textContent())?.trim();
    if (!titleText) {
      throw new Error('Calendar title unavailable');
    }
    const current = new Date(`${titleText} 1`);
    const diff = (target.getFullYear() - current.getFullYear()) * 12 + (target.getMonth() - current.getMonth());
    if (diff === 0) {
      return;
    }
    if (diff > 0) {
      await page.locator('.fc-next-button').click();
    } else {
      await page.locator('.fc-prev-button').click();
    }
    await titleLocator.waitFor();
  }
  throw new Error('Failed to reach target calendar month');
}

const expectedEmployees = ['Alice Anderson', 'Bob Brown', 'Cara Cruz'];
const targetExpiryMonth = new Date('2025-04-01T00:00:00');

test('CSV import populates dashboard and calendar', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');

  const importButton = page.locator('#import-btn');
  await expect(importButton).toBeEnabled({ timeout: 20000 });
  await importButton.click();

  const fileInput = page.locator('#file-upload');
  await fileInput.setInputFiles(fixturePath);

  await expect(page.locator('table').last()).toContainText('EMP-001');

  await mapField(page, 'First Name', 'First Name');
  await mapField(page, 'Last Name', 'Last Name');
  await mapField(page, 'Role / Job Title', 'Role / Job Title');
  await mapField(page, 'Employment Type / Class', 'Employment Type / Class');
  await mapField(page, 'Position Status', 'Position Status');
  await mapField(page, 'Employee ID / Position ID', 'Employee ID');

  await mapRequirement(page, 'CPR', 'CPR Completed');

  await page.getByRole('button', { name: 'Process Import' }).click();
  await expect(page.locator('div[data-close-import-modal]')).toBeHidden({ timeout: 20000 });

  await expect(page.locator('#employee-table tbody tr')).toHaveCount(expectedEmployees.length, { timeout: 20000 });

  const names = await page.locator('#employee-table tbody tr').evaluateAll(rows =>
    rows.map(row => row.querySelector('.text-sm.font-semibold')?.textContent?.trim() || '')
  );
  expect(names).toEqual(expectedEmployees);

  await importButton.click();
  await page.locator('input[type="radio"][value="completions"]').check();
  await fileInput.setInputFiles(fixturePath);

  await mapField(page, 'Employee ID / Position ID', 'Employee ID');
  await mapRequirement(page, 'CPR', 'CPR Completed');

  await page.getByRole('button', { name: 'Process Import' }).click();
  await expect(page.locator('div[data-close-import-modal]')).toBeHidden({ timeout: 20000 });
  await expect(page.locator('text=Completions updated:')).toBeVisible({ timeout: 20000 });

  await page.goto('/calendar.html');
  await navigateCalendarTo(page, targetExpiryMonth);
  await expect(page.locator('.fc-daygrid-event')).toHaveCount(expectedEmployees.length, { timeout: 20000 });
});
