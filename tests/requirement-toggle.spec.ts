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

test('single toggles and bulk updates refresh the grid and analytics', async ({ page }) => {
  await page.goto('/');

  const importButton = page.locator('button', { hasText: 'Import' }).first();
  await importButton.waitFor({ state: 'visible', timeout: 60000 });
  await importButton.click();

  const fileInput = page.locator('#file-upload');
  await fileInput.setInputFiles(fixturePath);

  await mapField(page, 'First Name', 'First Name');
  await mapField(page, 'Last Name', 'Last Name');
  await mapField(page, 'Role / Job Title', 'Role / Job Title');
  await mapField(page, 'Employment Type / Class', 'Employment Type / Class');
  await mapField(page, 'Position Status', 'Position Status');
  await mapField(page, 'Employee ID / Position ID', 'Employee ID');

  await mapRequirement(page, 'CPR', 'CPR Completed');

  await page.getByRole('button', { name: 'Process Import' }).click();
  await expect(page.locator('div[data-close-import-modal]')).toBeHidden({ timeout: 20000 });

  const tableRows = page.locator('.requirements-table tbody tr');
  await expect(tableRows).toHaveCount(3, { timeout: 20000 });

  await page.evaluate(async () => {
    const appFactory = (window as any).AppStore;
    if (typeof appFactory !== 'function') {
      throw new Error('App store unavailable');
    }
    const app = appFactory();
    const requirement = app.requirements?.[0];
    const employee = app.employees?.[0];
    if (!app.db || !requirement || !employee) {
      throw new Error('Seed data unavailable');
    }
    const record = await app.db.employeeRequirements
      .where({ employeeId: employee.id, requirementId: requirement.id })
      .first();
    if (!record) {
      throw new Error('Requirement link unavailable');
    }
    const expiresSoon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    record.status = 'Pending';
    record.completedOn = null;
    record.completedAt = null;
    record.expiresOn = expiresSoon;
    record.updatedAt = new Date().toISOString();
    await app.db.employeeRequirements.put(record);
    app.setEmployeeRequirement(record);
    app.refreshAnalytics();
    app.applyFilters();
  });

  const requirementCell = tableRows.first().locator('td').nth(1);
  const requirementCheckbox = requirementCell.locator('input[type="checkbox"]');
  const requirementLabel = requirementCell.locator('span.text-xs');

  await expect(requirementLabel).toHaveText('Pending', { timeout: 5000 });
  await expect
    .poll(() => page.evaluate(() => (window as any).AppStore().analytics.totals.atRiskAssignments))
    .toBe(1);

  await requirementCheckbox.check();
  await expect(requirementLabel).toHaveText('Complete', { timeout: 5000 });
  await expect
    .poll(() => page.evaluate(() => (window as any).AppStore().analytics.totals.atRiskAssignments))
    .toBe(0);

  await requirementCheckbox.uncheck();
  await expect(requirementLabel).toHaveText('Pending', { timeout: 5000 });
  await expect
    .poll(() => page.evaluate(() => (window as any).AppStore().analytics.totals.atRiskAssignments))
    .toBe(1);

  await page.evaluate(async () => {
    const app = (window as any).AppStore();
    const employeeId = app.employees?.[0]?.id;
    const requirementId = app.requirements?.[0]?.id;
    if (!employeeId || !requirementId) {
      throw new Error('Unable to resolve bulk context');
    }
    app.selectedEmployees = [employeeId];
    app.bulk.requirementId = requirementId;
    app.bulk.action = 'complete';
    app.bulk.date = new Date().toISOString().slice(0, 10);
    await app.runBulkUpdate();
  });

  await expect(requirementLabel).toHaveText('Complete', { timeout: 5000 });
  await expect
    .poll(() => page.evaluate(() => (window as any).AppStore().analytics.totals.atRiskAssignments))
    .toBe(0);
});
