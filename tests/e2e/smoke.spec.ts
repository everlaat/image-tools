import { expect, test } from '@playwright/test';

test('app shell loads with the background removal tool selected', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { name: 'Image Tools', level: 1 }),
  ).toBeVisible();

  const tool = page.getByRole('button', { name: /Remove background/ });
  await expect(tool).toHaveAttribute('aria-current', 'page');

  // Shipped tools are selectable; tools from later phases are not.
  await expect(page.getByRole('button', { name: /Logo to SVG/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Split layers/ })).toBeDisabled();
});

test('tool navigation is reachable by keyboard', async ({ page }) => {
  await page.goto('/');

  const tool = page.getByRole('button', { name: /Remove background/ });
  await tool.focus();
  await expect(tool).toBeFocused();
});
