import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const LOGO = fileURLToPath(new URL('./fixtures/logo.png', import.meta.url));

async function openTool(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Logo to SVG/ }).click();
}

async function svgText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const link = document.querySelector<HTMLAnchorElement>('a[download="traced.svg"]');
    if (!link?.href.startsWith('blob:')) throw new Error('no svg yet');
    return (await fetch(link.href)).text();
  });
}

test.describe('logo to svg', () => {
  // Tracing plus the wasm download; comfortably longer than the default.
  test.slow();

  test('traces a raster logo into downloadable SVG paths', async ({ page }) => {
    await openTool(page);
    await page.setInputFiles('input[type="file"]', LOGO);

    const download = page.getByRole('link', { name: 'Download SVG' });
    await expect(download).not.toHaveAttribute('aria-disabled', 'true', {
      timeout: 60_000,
    });

    const svg = await svgText(page);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');

    // The fixture is four flat colours on a light ground, so a correct trace
    // is a handful of paths — not one per pixel, and not nothing.
    const paths = svg.match(/<path/g) ?? [];
    expect(paths.length).toBeGreaterThan(1);
    expect(paths.length).toBeLessThan(40);

    // The dominant source colours should survive quantisation.
    expect(svg.toUpperCase()).toContain('#1C5EA8');
  });

  test('changing the colour count re-traces with that many colours', async ({ page }) => {
    await openTool(page);
    await page.setInputFiles('input[type="file"]', LOGO);
    await expect(page.getByRole('link', { name: 'Download SVG' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
      { timeout: 60_000 },
    );

    const swatches = page.getByRole('list', { name: 'Palette' }).getByRole('listitem');
    // The fixture has four flat colours, so asking for eight yields four:
    // flat artwork keeps its exact colours rather than being padded out.
    await expect(swatches).toHaveCount(4, { timeout: 60_000 });

    // Driven by keyboard rather than fill(): setting a range input's value
    // directly bypasses React's change tracking, and this doubles as a check
    // that the control is keyboard operable.
    const colors = page.getByLabel('Colours');
    await colors.focus();
    await expect(colors).toBeFocused();
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowLeft');
    await expect(colors).toHaveValue('2');

    await expect(swatches).toHaveCount(2, { timeout: 60_000 });

    const svg = await svgText(page);
    expect(svg).toContain('<svg');
  });
});
