import { describe, expect, it } from 'vitest';
import {
  medianCut,
  quantise,
  refineKMeans,
  type Rgb,
} from '../../src/lib/color/quantise.ts';
import type { Rgba } from '../../src/lib/image/pixels.ts';

/** Builds an Rgba raster from a flat list of [r,g,b] pixels, all opaque. */
function raster(pixels: readonly Rgb[]): Rgba {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  });
  return { data, width: pixels.length, height: 1 };
}

const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 255, 0];
const BLUE: Rgb = [0, 0, 255];

describe('medianCut', () => {
  it('returns nothing for an empty input', () => {
    expect(medianCut([], 4)).toEqual([]);
  });

  it('never returns more colours than asked for', () => {
    const pixels = Array.from({ length: 200 }, (_, i): Rgb => [
      i,
      255 - i,
      (i * 7) % 256,
    ]);
    expect(medianCut(pixels, 8)).toHaveLength(8);
  });

  it('never returns more colours than there are pixels', () => {
    expect(medianCut([RED, GREEN], 16)).toHaveLength(2);
  });

  it('recovers the exact colours of a flat image', () => {
    const palette = medianCut([RED, RED, GREEN, GREEN, BLUE, BLUE], 3);
    expect(palette).toHaveLength(3);
    for (const entry of palette) {
      expect([RED, GREEN, BLUE]).toContainEqual(entry);
    }
  });

  it('collapses a single-colour image to one entry', () => {
    expect(medianCut([RED, RED, RED, RED], 4)).toEqual([RED]);
  });

  it('keeps flat artwork exact rather than averaging it', () => {
    // Four flat colours, four slots: every one must survive untouched, which
    // is the whole point for logos.
    const flat: Rgb[] = [RED, GREEN, BLUE, [17, 34, 51]];
    const palette = medianCut([...flat, ...flat, ...flat], 4);
    expect(new Set(palette.map(String))).toEqual(new Set(flat.map(String)));
  });

  it('falls back to splitting when there are more colours than slots', () => {
    const flat: Rgb[] = [RED, GREEN, BLUE, [17, 34, 51]];
    const palette = medianCut(flat, 2);
    expect(palette).toHaveLength(2);
    // Averages, not originals, once it has to merge.
    expect(new Set(palette.map(String))).not.toEqual(new Set(flat.map(String)));
  });

  it('is deterministic', () => {
    const pixels = Array.from({ length: 64 }, (_, i): Rgb => [i * 3, i, 255 - i * 2]);
    expect(medianCut(pixels, 5)).toEqual(medianCut(pixels, 5));
  });
});

describe('refineKMeans', () => {
  it('leaves an already-optimal palette alone', () => {
    const pixels = [RED, RED, GREEN, GREEN];
    expect(refineKMeans(pixels, [RED, GREEN])).toEqual([RED, GREEN]);
  });

  it('moves a seed towards the cluster it owns', () => {
    const pixels: Rgb[] = [
      [10, 10, 10],
      [20, 20, 20],
      [30, 30, 30],
    ];
    const [centre] = refineKMeans(pixels, [[0, 0, 0]]);
    expect(centre).toEqual([20, 20, 20]);
  });

  it('keeps an empty cluster rather than dropping it', () => {
    // The second seed owns nothing; the palette length must not change.
    const palette = refineKMeans([RED, RED], [RED, [0, 0, 1]]);
    expect(palette).toHaveLength(2);
  });

  it('handles an empty pixel list', () => {
    expect(refineKMeans([], [RED])).toEqual([RED]);
  });
});

describe('quantise', () => {
  it('reduces an image to at most the requested colour count', () => {
    const pixels = Array.from({ length: 300 }, (_, i): Rgb => [
      i % 256,
      (i * 3) % 256,
      i % 128,
    ]);
    const { image } = quantise(raster(pixels), { colors: 4, method: 'k-means' });

    const seen = new Set<string>();
    for (let i = 0; i < image.width; i += 1) {
      seen.add(`${image.data[i * 4]},${image.data[i * 4 + 1]},${image.data[i * 4 + 2]}`);
    }
    expect(seen.size).toBeLessThanOrEqual(4);
  });

  it('leaves an image alone when it already has few enough colours', () => {
    const input = raster([RED, GREEN, BLUE]);
    const { image } = quantise(input, { colors: 8, method: 'median-cut' });
    expect(Array.from(image.data)).toEqual(Array.from(input.data));
  });

  it('preserves dimensions and the alpha channel', () => {
    const input = raster([RED, GREEN, BLUE, RED]);
    input.data[7] = 128; // partially transparent second pixel
    const { image } = quantise(input, { colors: 2, method: 'k-means' });

    expect(image.width).toBe(4);
    expect(image.height).toBe(1);
    expect(image.data[7]).toBe(128);
    expect(image.data[3]).toBe(255);
  });

  it('does not mutate the source raster', () => {
    const input = raster([RED, GREEN, BLUE, [1, 2, 3]]);
    const before = Array.from(input.data);
    quantise(input, { colors: 2, method: 'k-means' });
    expect(Array.from(input.data)).toEqual(before);
  });

  it('reports the palette it used', () => {
    const { palette } = quantise(raster([RED, GREEN, BLUE]), {
      colors: 3,
      method: 'median-cut',
    });
    expect(palette).toHaveLength(3);
  });

  it('ignores fully transparent pixels when building the palette', () => {
    // A transparent black pixel must not pull a palette entry towards black.
    const input = raster([RED, RED, RED, [0, 0, 0]]);
    input.data[15] = 0;
    const { palette } = quantise(input, { colors: 1, method: 'median-cut' });
    expect(palette[0]).toEqual(RED);
  });

  it('survives a fully transparent image', () => {
    const input = raster([RED, GREEN]);
    input.data[3] = 0;
    input.data[7] = 0;
    const { image, palette } = quantise(input, { colors: 4, method: 'k-means' });
    expect(palette).toEqual([]);
    expect(image.width).toBe(2);
  });
});
