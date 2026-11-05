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

  test('the preview background can be changed to judge the edges', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Model').selectOption('modnet');
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByRole('link', { name: 'Download PNG' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
      { timeout: 180_000 },
    );

    // Defaults to the transparency checkerboard.
    const surface = page.locator('figure div').first();
    await expect(surface).toHaveClass(/alpha-grid/);

    await page.getByRole('radio', { name: 'White' }).click();
    await expect(surface).not.toHaveClass(/alpha-grid/);
    await expect(surface).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    await page.getByRole('radio', { name: 'Black' }).click();
    await expect(surface).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  });

  test('the brush adds to the cutout, and undo takes it back', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Model').selectOption('modnet');
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByRole('link', { name: 'Download PNG' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
      { timeout: 180_000 },
    );

    const before = (await alphaStats(page)).opaqueRatio;

    await page.getByRole('button', { name: 'Fix with brush' }).click();
    const surface = page.locator('canvas').first();
    // The paint surface is taller than the viewport, so without this its top
    // sits at a negative y and synthetic pointer events land outside the page.
    await surface.scrollIntoViewIfNeeded();
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Paint across a transparent corner, so any change is from the brush.
    await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.12);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.16, {
      steps: 12,
    });
    await page.mouse.up();

    const undo = page.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeEnabled({ timeout: 60_000 });
    await expect
      .poll(async () => (await alphaStats(page)).opaqueRatio, { timeout: 60_000 })
      .toBeGreaterThan(before);

    await undo.click();
    await expect(undo).toBeDisabled({ timeout: 60_000 });
    await expect
      .poll(async () => (await alphaStats(page)).opaqueRatio, { timeout: 60_000 })
      .toBeCloseTo(before, 3);
  });

  test('the paint surface does not start a native image drag', async ({ page }) => {
    // Regression: the cutout <img> is draggable by default, so a real
    // press-and-drag started an HTML5 image drag and no stroke was ever
    // painted. Synthetic pointer events do not trigger native drag, which is
    // why the painting test passed while the feature was unusable.
    await page.goto('/');
    await page.getByLabel('Model').selectOption('modnet');
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByRole('link', { name: 'Download PNG' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
      { timeout: 180_000 },
    );
    await page.getByRole('button', { name: 'Fix with brush' }).click();

    const image = page.getByRole('img', { name: /Cutout being corrected/ });
    await expect(image).toHaveJSProperty('draggable', false);

    // The image must not swallow the pointer stream either.
    await expect(image).toHaveCSS('pointer-events', 'none');

    // A dragstart anywhere on the surface has to be cancelled.
    const prevented = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const surface = canvas?.parentElement;
      if (!surface) throw new Error('no paint surface');
      const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
      surface.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });

  test('smart select pulls in a whole object with one click', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Model').selectOption('modnet');
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.getByRole('link', { name: 'Download PNG' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
      { timeout: 180_000 },
    );

    const before = (await alphaStats(page)).opaqueRatio;

    await page.getByRole('button', { name: 'Fix with brush' }).click();
    await page.getByRole('checkbox', { name: /Smart select/ }).check();

    const surface = page.locator('canvas').first();
    await surface.scrollIntoViewIfNeeded();
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // The head, which MODNet leaves partly transparent on this fixture.
    await page.mouse.click(box.x + box.width * 0.47, box.y + box.height * 0.27);

    // Downloads SlimSAM (~17.5 MB) and encodes on first use.
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled({
      timeout: 300_000,
    });
    await expect
      .poll(async () => (await alphaStats(page)).opaqueRatio, { timeout: 60_000 })
      .toBeGreaterThan(before);
  });

  test('reports which backend is in use', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Model').selectOption('modnet');
    await page.setInputFiles('input[type="file"]', FIXTURE);

    const badge = page.getByText(/Running on (WebGPU|WASM)/);
    await expect(badge).toBeVisible({ timeout: 180_000 });
  });
});
