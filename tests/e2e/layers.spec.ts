import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const SCENE = fileURLToPath(new URL('./fixtures/scene.png', import.meta.url));

/** Opens the tool, loads the scene and waits for SAM to finish encoding. */
async function prepare(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Split layers/ }).click();
  await page.setInputFiles('input[type="file"]', SCENE);
  await expect(page.getByText(/Click to add a point/)).toBeVisible({ timeout: 300_000 });
}

const layerItems = (page: Page) =>
  page.getByRole('list', { name: 'Layers' }).getByRole('listitem');

test.describe('layer splitting', () => {
  // Downloads ~45 MB of models and runs an encoder pass.
  test.slow();

  test('a click produces a layer whose mask lands where it was clicked', async ({
    page,
  }) => {
    await prepare(page);

    const canvas = page.getByRole('button', { name: /Select an object/ });
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const fx = 0.5;
    const fy = 0.62;
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.getByRole('button', { name: /Make layer from 1 point/ }).click();
    await expect(layerItems(page)).toHaveCount(1, { timeout: 180_000 });

    // The real check: SAM's padded-square coordinate transform has to round
    // trip, or the mask comes back offset from the click.
    const centroid = await page.evaluate(async () => {
      const img = document.querySelector<HTMLImageElement>(
        'ol[aria-label="Layers"] li img',
      );
      if (!img) throw new Error('no layer thumbnail');
      const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
      const canvasEl = document.createElement('canvas');
      canvasEl.width = bmp.width;
      canvasEl.height = bmp.height;
      const ctx = canvasEl.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);

      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) > 128) {
          const index = i / 4;
          sx += index % bmp.width;
          sy += Math.floor(index / bmp.width);
          n += 1;
        }
      }
      return n > 0 ? { cx: sx / n / bmp.width, cy: sy / n / bmp.height } : null;
    });

    expect(centroid).not.toBeNull();
    if (!centroid) return;
    expect(centroid.cx).toBeCloseTo(fx, 1);
    expect(centroid.cy).toBeCloseTo(fy, 1);
  });

  test('depth estimation suggests foreground, midground and background', async ({
    page,
  }) => {
    await prepare(page);

    await page.getByRole('button', { name: /Suggest layers from depth/ }).click();
    await expect(layerItems(page)).toHaveCount(3, { timeout: 300_000 });

    // exact, because each name also appears in the checkbox's "Show X" label.
    await expect(page.getByText('Foreground', { exact: true })).toBeVisible();
    await expect(page.getByText('Midground', { exact: true })).toBeVisible();
    await expect(page.getByText('Background', { exact: true })).toBeVisible();

    // The bands partition the image, so coverage should roughly add to 100%.
    const coverages = await page
      .getByRole('list', { name: 'Layers' })
      .getByText(/% of the image/)
      .allInnerTexts();
    const total = coverages.reduce((sum, text) => sum + parseFloat(text), 0);
    expect(total).toBeGreaterThan(80);
    expect(total).toBeLessThan(120);
  });

  test('layers can be hidden, reordered and exported as a ZIP', async ({ page }) => {
    await prepare(page);
    await page.getByRole('button', { name: /Suggest layers from depth/ }).click();
    await expect(layerItems(page)).toHaveCount(3, { timeout: 300_000 });

    // Reorder: Background starts last, one press moves it up.
    await page.getByRole('button', { name: 'Move Background up' }).click();
    await expect(layerItems(page).nth(1)).toContainText('Background');

    // Hiding a layer takes it out of the ZIP count.
    await page.getByRole('checkbox', { name: 'Show Midground' }).uncheck();
    await expect(
      page.getByRole('button', { name: /Export 2 layers as ZIP/ }),
    ).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export 2 layers as ZIP/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('layers.zip');
  });
});
