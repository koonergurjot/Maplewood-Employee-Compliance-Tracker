import { test, expect } from '@playwright/test';

test.describe('Function.prototype.call compatibility', () => {
  test('synchronous functions called with .call return direct values', async ({ page }) => {
    await page.goto('/');

    const evaluation = await page.evaluate(() => {
      function add(a, b) {
        return a + b;
      }

      const value = add.call(null, 2, 3);
      const isPromiseLike = value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';

      return { value, isPromiseLike };
    });

    expect(evaluation.value).toBe(5);
    expect(evaluation.isPromiseLike).toBe(false);
  });
});
