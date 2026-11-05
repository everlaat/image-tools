import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/subject.png', import.meta.url));

/** Alpha statistics of the produced cutout, read back in the page. */
async function alphaStats(page: Page) {
  return page.evaluate(async () => {
    const link = document.querySelector<HTMLAnchorElement>('a[download="cutout.png"]');
    if (!link?.href.startsWith('blob:')) throw new Error('no result yet');

    const blob = await (await fetch(link.href)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

    let opaque = 0;
    let clear = 0;
    let partial = 0;
    for (let i = 3; i < data.length; i += 4) {
      const a = data[i] ?? 0;
      if (a > 250) opaque += 1;
      else if (a < 5) clear += 1;
      else partial += 1;
    }
    const total = data.length / 4;
    return {
      width: bitmap.width,
      height: bitmap.height,
      opaqueRatio: opaque / total,
      clearRatio: clear / total,
      partialRatio: partial / total,
    };
  });
}

test.describe('background removal', () => {
  // Weights are downloaded from Hugging Face, then cached by the browser.
  test.slow();

  test('cuts the subject out and offers a transparent PNG', async ({ page }) => {
    await page.goto('/');

    // MODNet is the smallest model, so this stays a smoke test rather than a
    // 114 MB download on every run.
    await page.getByLabel('Model').selectOption('modnet');
    await page.getByRole('button', { name: /Drop an image/ }).waitFor();
    await page.setInputFiles('input[type="file"]', FIXTURE);

    const download = page.getByRole('link', { name: 'Download PNG' });
    await expect(download).not.toHaveAttribute('aria-disabled', 'true', {
      timeout: 180_000,
    });

    const stats = await alphaStats(page);

    // Full resolution is preserved: the mask is lifted back up from the
    // model's own working size.
    expect(stats.width).toBe(768);
    expect(stats.height).toBe(768);

    // A real cutout keeps some of the image and discards some of it. These
    // bounds are deliberately loose — this asserts the pipeline works, not
    // that the model is accurate.
    expect(stats.opaqueRatio).toBeGreaterThan(0.02);
    expect(stats.clearRatio).toBeGreaterThan(0.02);
  });

  test('reports which backend is in use', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Model').selectOption('modnet');
    await page.setInputFiles('input[type="file"]', FIXTURE);

    const badge = page.getByText(/Running on (WebGPU|WASM)/);
    await expect(badge).toBeVisible({ timeout: 180_000 });
  });
});
