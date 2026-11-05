import { describe, expect, it } from 'vitest';
import {
  applyMask,
  DEFAULT_REFINEMENT,
  refineMask,
  resizeMask,
} from '../../src/lib/image/mask.ts';
import type { GrayMask, Rgba } from '../../src/lib/image/pixels.ts';

function mask(values: readonly number[], width: number, height: number): GrayMask {
  return { data: new Float32Array(values), width, height };
}

describe('resizeMask', () => {
  it('returns the same mask when the size already matches', () => {
    const input = mask([0, 1, 1, 0], 2, 2);
    expect(resizeMask(input, 2, 2)).toBe(input);
  });

  it('reports the requested dimensions', () => {
    const out = resizeMask(mask([0, 1, 1, 0], 2, 2), 7, 5);
    expect([out.width, out.height]).toEqual([7, 5]);
    expect(out.data.length).toBe(35);
  });

  it('keeps a constant mask constant, so edges do not darken', () => {
    const out = resizeMask(mask(new Array(16).fill(0.42), 4, 4), 9, 9);
    for (const value of out.data) expect(value).toBeCloseTo(0.42, 5);
  });

  it('interpolates rather than duplicating samples', () => {
    // 0 -> 1 ramp across two pixels, upscaled: the middle must land between.
    const out = resizeMask(mask([0, 1], 2, 1), 4, 1);
    expect(out.data[0]).toBeLessThan(out.data[1] ?? 0);
    expect(out.data[1]).toBeLessThan(out.data[2] ?? 0);
    expect(out.data[2]).toBeLessThan(out.data[3] ?? 0);
  });

  it('does not shift the image by half a pixel', () => {
    // Symmetric input must stay symmetric after a symmetric resize.
    const out = resizeMask(mask([0, 1, 1, 0], 4, 1), 8, 1);
    const values = Array.from(out.data);
    for (let i = 0; i < values.length / 2; i += 1) {
      expect(values[i]).toBeCloseTo(values[values.length - 1 - i] ?? 0, 5);
    }
  });

  it('downscales as well as upscales', () => {
    const out = resizeMask(mask(new Array(64).fill(1), 8, 8), 3, 3);
    expect(out.data.length).toBe(9);
    for (const value of out.data) expect(value).toBeCloseTo(1, 5);
  });
});

describe('refineMask', () => {
  it('is a no-op at its defaults', () => {
    const input = mask([0.1, 0.6], 2, 1);
    expect(refineMask(input, DEFAULT_REFINEMENT)).toBe(input);
  });

  it('binarises at full hardness', () => {
    const out = refineMask(mask([0.2, 0.49, 0.51, 0.9], 4, 1), {
      threshold: 0.5,
      hardness: 1,
      feather: 0,
    });
    expect(Array.from(out.data)).toEqual([0, 0, 1, 1]);
  });

  it('moves the cut point with the threshold', () => {
    const values = [0.3, 0.7];
    const low = refineMask(mask(values, 2, 1), {
      threshold: 0.2,
      hardness: 1,
      feather: 0,
    });
    const high = refineMask(mask(values, 2, 1), {
      threshold: 0.8,
      hardness: 1,
      feather: 0,
    });

    expect(Array.from(low.data)).toEqual([1, 1]);
    expect(Array.from(high.data)).toEqual([0, 0]);
  });

  it('keeps a soft ramp monotonic when hardness is partial', () => {
    const out = refineMask(mask([0, 0.25, 0.5, 0.75, 1], 5, 1), {
      threshold: 0.5,
      hardness: 0.5,
      feather: 0,
    });
    const values = Array.from(out.data);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] ?? 0);
    }
  });

  it('feathering softens a hard edge without moving it', () => {
    const hard = new Array(16).fill(0).map((_, i) => (i % 4 < 2 ? 1 : 0));
    const out = refineMask(mask(hard, 4, 4), {
      threshold: 0.5,
      hardness: 0,
      feather: 1,
    });
    // The step is now a ramp: interior values are strictly between 0 and 1.
    const second = out.data[1] ?? 0;
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(1);
  });

  it('preserves a fully opaque mask under feathering', () => {
    const out = refineMask(mask(new Array(25).fill(1), 5, 5), {
      threshold: 0.5,
      hardness: 0,
      feather: 2,
    });
    for (const value of out.data) expect(value).toBeCloseTo(1, 5);
  });
});

describe('applyMask', () => {
  const image: Rgba = {
    data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]),
    width: 2,
    height: 1,
  };

  it('writes the mask into alpha and leaves colour alone', () => {
    const out = applyMask(image, mask([1, 0], 2, 1));
    expect(Array.from(out.data)).toEqual([10, 20, 30, 255, 40, 50, 60, 0]);
  });

  it('scales fractional alpha to 0..255', () => {
    const out = applyMask(image, mask([0.5, 0.25], 2, 1));
    expect(out.data[3]).toBe(128);
    expect(out.data[7]).toBe(64);
  });

  it('does not mutate the input raster', () => {
    const before = Array.from(image.data);
    applyMask(image, mask([0, 0], 2, 1));
    expect(Array.from(image.data)).toEqual(before);
  });

  it('refuses a mask of the wrong size', () => {
    expect(() => applyMask(image, mask([1], 1, 1))).toThrow(/does not match/);
  });
});
