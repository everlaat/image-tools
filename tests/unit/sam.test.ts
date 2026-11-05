import { describe, expect, it } from 'vitest';
import {
  bestMaskIndex,
  maskToSource,
  samTransform,
  toModelPoint,
} from '../../src/lib/image/sam.ts';
import type { GrayMask } from '../../src/lib/image/pixels.ts';

function mask(values: readonly number[], width: number, height: number): GrayMask {
  return { data: new Float32Array(values), width, height };
}

describe('samTransform', () => {
  it('scales the longest edge to the model size', () => {
    const t = samTransform({ width: 2048, height: 1024 }, 1024);
    expect(t.scale).toBe(0.5);
    expect(t.resizedWidth).toBe(1024);
    expect(t.resizedHeight).toBe(512);
  });

  it('works when height is the longest edge', () => {
    const t = samTransform({ width: 512, height: 2048 }, 1024);
    expect(t.resizedHeight).toBe(1024);
    expect(t.resizedWidth).toBe(256);
  });

  it('upscales a small image rather than leaving it small', () => {
    const t = samTransform({ width: 256, height: 128 }, 1024);
    expect(t.scale).toBe(4);
    expect(t.resizedWidth).toBe(1024);
  });

  it('keeps the padded square square', () => {
    const t = samTransform({ width: 1000, height: 10 }, 1024);
    expect(t.paddedSize).toBe(1024);
  });
});

describe('toModelPoint', () => {
  it('maps a click through the same scale as the image', () => {
    const t = samTransform({ width: 2048, height: 1024 }, 1024);
    expect(toModelPoint({ x: 1024, y: 512, positive: true }, t)).toEqual([512, 256]);
  });

  it('maps the origin to the origin', () => {
    const t = samTransform({ width: 800, height: 600 }, 1024);
    expect(toModelPoint({ x: 0, y: 0, positive: true }, t)).toEqual([0, 0]);
  });

  it('puts a bottom-right click inside the content, not the padding', () => {
    const t = samTransform({ width: 2048, height: 1024 }, 1024);
    const [x, y] = toModelPoint({ x: 2047, y: 1023, positive: true }, t);
    expect(x).toBeLessThanOrEqual(t.resizedWidth);
    expect(y).toBeLessThanOrEqual(t.resizedHeight);
  });
});

describe('maskToSource', () => {
  it('returns a mask at the source resolution', () => {
    const t = samTransform({ width: 300, height: 200 }, 1024);
    const out = maskToSource(mask(new Array(16).fill(0.5), 4, 4), t);
    expect([out.width, out.height]).toEqual([300, 200]);
  });

  it('keeps a constant mask constant', () => {
    const t = samTransform({ width: 64, height: 64 }, 1024);
    const out = maskToSource(mask(new Array(64).fill(0.25), 8, 8), t);
    for (const v of out.data) expect(v).toBeCloseTo(0.25, 5);
  });

  it('skips the padding for a non-square image', () => {
    // A wide image fills only the top half of the padded square, so the
    // bottom half of the mask is padding and must never be sampled.
    const t = samTransform({ width: 1024, height: 512 }, 1024);
    const half = 8;
    const values = new Array(16 * 16).fill(0);
    for (let y = 0; y < half; y += 1) {
      for (let x = 0; x < 16; x += 1) values[y * 16 + x] = 1;
    }
    const out = maskToSource(mask(values, 16, 16), t);
    // Every source pixel maps into the content half, so all should be ~1.
    for (const v of out.data) expect(v).toBeGreaterThan(0.5);
  });

  it('applies a sigmoid when asked, turning logits into 0..1', () => {
    const t = samTransform({ width: 2, height: 2 }, 1024);
    const out = maskToSource(mask([0, 0, 0, 0], 2, 2), t, { sigmoid: true });
    for (const v of out.data) expect(v).toBeCloseTo(0.5, 6);
  });

  it('leaves logits alone when sigmoid is off', () => {
    const t = samTransform({ width: 2, height: 2 }, 1024);
    const out = maskToSource(mask([-4, -4, -4, -4], 2, 2), t);
    for (const v of out.data) expect(v).toBeCloseTo(-4, 4);
  });
});

describe('bestMaskIndex', () => {
  it('picks the highest scoring proposal', () => {
    expect(bestMaskIndex(new Float32Array([0.2, 0.9, 0.5]))).toBe(1);
  });

  it('defaults to the first when scores tie', () => {
    expect(bestMaskIndex(new Float32Array([0.7, 0.7]))).toBe(0);
  });

  it('handles an empty score list', () => {
    expect(bestMaskIndex(new Float32Array([]))).toBe(0);
  });
});
