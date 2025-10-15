import { test, expect } from '@playwright/test';

const withTimestamp = (label: string) => `${label} ${Date.now()}`;

test('user can add an employee from the quick add modal', async ({ page }) => {
  await page.goto('/');

  const addEmployeeButton = page.locator('#add-employee-btn');
  await expect(addEmployeeButton).toBeEnabled({ timeout: 20000 });
  await addEmployeeButton.click();

  const firstNameInput = page.locator('#add-emp-first');
  const lastNameInput = page.locator('#add-emp-last');
  await expect(firstNameInput).toBeVisible();
  await expect(lastNameInput).toBeVisible();

  const employeeFirstName = withTimestamp('Test First');
  const employeeLastName = withTimestamp('Test Last');
  await firstNameInput.fill(employeeFirstName);
  await lastNameInput.fill(employeeLastName);

  const addLookupValue = async (trigger: string, value: string) => {
    const dialog = page.locator('#lookup-dialog');
    await page.click(trigger);
    await expect(dialog).toBeVisible();
    const input = dialog.locator('#lookup-dialog-input');
    await input.fill(value);
    await dialog.locator('button.btn-primary').click();
    await expect(dialog).toBeHidden();
  };

  const newRole = withTimestamp('QA Role');
  await addLookupValue('button[aria-label="Add new role"]', newRole);
  await expect(page.locator('#add-emp-role')).toHaveValue(newRole);

  const newEmploymentType = withTimestamp('Employment Type');
  await addLookupValue('button[aria-label="Add new employment type"]', newEmploymentType);
  await expect(page.locator('#add-emp-employment-type')).toHaveValue(newEmploymentType);

  const newStatus = withTimestamp('Status');
  await addLookupValue('button[aria-label="Add new status"]', newStatus);
  await expect(page.locator('#add-emp-status')).toHaveValue(newStatus);

  await page.click('#add-emp-modal button[type="submit"]');
  await expect(page.locator('#add-emp-modal')).toBeHidden();

  const newRow = page.locator('#employee-table tbody tr').filter({ hasText: newRole });
  await expect(newRow).toBeVisible();
  await expect(newRow).toContainText(employeeFirstName);
  await expect(newRow).toContainText(employeeLastName);
  await expect(newRow).toContainText(newStatus);
});
