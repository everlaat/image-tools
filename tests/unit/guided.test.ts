import { describe, expect, it } from 'vitest';
import { guidedRefine, lumaOf } from '../../src/lib/image/guided.ts';
import type { GrayMask, Rgba } from '../../src/lib/image/pixels.ts';

function mask(values: readonly number[], width: number, height: number): GrayMask {
  return { data: new Float32Array(values), width, height };
}

const DEFAULTS = { radius: 2, epsilon: 1e-3, strength: 1 };

describe('lumaOf', () => {
  it('maps white to 1 and black to 0', () => {
    const image: Rgba = {
      data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]),
      width: 2,
      height: 1,
    };
    const luma = lumaOf(image);
    expect(luma[0]).toBeCloseTo(1, 5);
    expect(luma[1]).toBeCloseTo(0, 5);
  });

  it('weights green most, as perceptual luma does', () => {
    const image: Rgba = {
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]),
      width: 3,
      height: 1,
    };
    const [r = 0, g = 0, b = 0] = Array.from(lumaOf(image));
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
  });

  it('ignores alpha', () => {
    const opaque: Rgba = {
      data: new Uint8ClampedArray([200, 200, 200, 255]),
      width: 1,
      height: 1,
    };
    const clear: Rgba = {
      data: new Uint8ClampedArray([200, 200, 200, 0]),
      width: 1,
      height: 1,
    };
    expect(Array.from(lumaOf(opaque))).toEqual(Array.from(lumaOf(clear)));
  });
});

describe('guidedRefine', () => {
  it('is a no-op at zero strength', () => {
    const input = mask([0.2, 0.8], 2, 1);
    expect(
      guidedRefine(input, new Float32Array([0, 1]), { ...DEFAULTS, strength: 0 }),
    ).toBe(input);
  });

  it('is a no-op for a radius below one pixel', () => {
    const input = mask([0.2, 0.8], 2, 1);
    expect(
      guidedRefine(input, new Float32Array([0, 1]), { ...DEFAULTS, radius: 0 }),
    ).toBe(input);
  });

  it('refuses a guide of the wrong size', () => {
    expect(() =>
      guidedRefine(mask([0.5, 0.5], 2, 1), new Float32Array([0]), DEFAULTS),
    ).toThrow(/does not match/);
  });

  it('leaves a constant mask constant', () => {
    const flat = mask(new Array(64).fill(0.5), 8, 8);
    const guide = new Float32Array(64).map((_, i) => (i % 8) / 8);
    const out = guidedRefine(flat, guide, DEFAULTS);
    for (const v of out.data) expect(v).toBeCloseTo(0.5, 4);
  });

  it('keeps every value within 0..1', () => {
    const noisy = mask(
      Array.from({ length: 64 }, (_, i) => (i % 2 === 0 ? 0 : 1)),
      8,
      8,
    );
    const guide = new Float32Array(64).map((_, i) => (i % 2 === 0 ? 0 : 1));
    for (const v of guidedRefine(noisy, guide, DEFAULTS).data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('snaps a blurred alpha edge back onto the image edge', () => {
    // A 16-wide strip: the guide steps hard at x=8, while the alpha ramps
    // gradually across x=5..11, as an upscaled model mask would.
    const width = 16;
    const height = 8;
    const guide = new Float32Array(width * height);
    const alpha = new Float32Array(width * height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        guide[i] = x < 8 ? 0 : 1;
        alpha[i] = Math.min(1, Math.max(0, (x - 5) / 6));
      }
    }

    const out = guidedRefine({ data: alpha, width, height }, guide, {
      radius: 3,
      epsilon: 1e-4,
      strength: 1,
    });

    const row = 4 * width;
    const before = out.data[row + 7] ?? 0;
    const after = out.data[row + 8] ?? 0;

    // The transition should now be sharper across the guide's edge than the
    // original ramp was over the same pair of pixels.
    const originalStep = (alpha[row + 8] ?? 0) - (alpha[row + 7] ?? 0);
    expect(after - before).toBeGreaterThan(originalStep * 2);
  });

  it('blends partially at intermediate strength', () => {
    const width = 16;
    const height = 4;
    const guide = new Float32Array(width * height);
    const alpha = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        guide[i] = x < 8 ? 0 : 1;
        alpha[i] = Math.min(1, Math.max(0, (x - 5) / 6));
      }
    }
    const input = { data: alpha, width, height };
    const full = guidedRefine(input, guide, { radius: 3, epsilon: 1e-4, strength: 1 });
    const half = guidedRefine(input, guide, { radius: 3, epsilon: 1e-4, strength: 0.5 });

    const i = 2 * width + 7;
    const original = alpha[i] ?? 0;
    expect(Math.abs((half.data[i] ?? 0) - original)).toBeLessThan(
      Math.abs((full.data[i] ?? 0) - original),
    );
  });
});
