import { describe, expect, it } from 'vitest';
import {
  bandsToMasks,
  DEFAULT_BANDS,
  normaliseDepth,
} from '../../src/lib/layers/depth.ts';

describe('normaliseDepth', () => {
  it('rescales to the full 0..1 range', () => {
    const out = normaliseDepth(new Float32Array([5, 10, 15]), 3, 1);
    expect(out.data[0]).toBeCloseTo(0, 6);
    expect(out.data[1]).toBeCloseTo(0.5, 6);
    expect(out.data[2]).toBeCloseTo(1, 6);
  });

  it('handles negative depth values', () => {
    const out = normaliseDepth(new Float32Array([-20, 0, 20]), 3, 1);
    expect(out.data[0]).toBeCloseTo(0, 6);
    expect(out.data[2]).toBeCloseTo(1, 6);
  });

  it('does not divide by zero on a flat map', () => {
    const out = normaliseDepth(new Float32Array([7, 7, 7]), 3, 1);
    for (const v of out.data) expect(v).toBe(0);
  });

  it('reports the requested dimensions', () => {
    const out = normaliseDepth(new Float32Array(12), 4, 3);
    expect([out.width, out.height]).toEqual([4, 3]);
    expect(out.data.length).toBe(12);
  });
});

describe('bandsToMasks', () => {
  const depth = normaliseDepth(new Float32Array([0, 0.5, 1]), 3, 1);

  it('produces one mask per band', () => {
    expect(bandsToMasks(depth)).toHaveLength(DEFAULT_BANDS.length);
  });

  it('assigns near pixels to the foreground and far ones to the background', () => {
    const [foreground, , background] = bandsToMasks(depth, DEFAULT_BANDS, 0);
    // Pixel 2 is nearest, pixel 0 is furthest.
    expect(foreground?.data[2]).toBe(1);
    expect(foreground?.data[0]).toBe(0);
    expect(background?.data[0]).toBe(1);
    expect(background?.data[2]).toBe(0);
  });

  it('covers every pixel across the bands', () => {
    // With hard edges the bands partition the depth range exactly once.
    const masks = bandsToMasks(depth, DEFAULT_BANDS, 0);
    for (let i = 0; i < 3; i += 1) {
      const total = masks.reduce((sum, m) => sum + (m.data[i] ?? 0), 0);
      expect(total).toBeCloseTo(1, 5);
    }
  });

  it('feathers band edges so neighbours overlap instead of leaving a seam', () => {
    const atEdge = normaliseDepth(new Float32Array([0, 1 / 3, 1]), 3, 1);
    const masks = bandsToMasks(atEdge, DEFAULT_BANDS, 0.1);
    const total = masks.reduce((sum, m) => sum + (m.data[1] ?? 0), 0);
    expect(total).toBeGreaterThan(0.9);
  });

  it('keeps every value within 0..1', () => {
    for (const m of bandsToMasks(depth, DEFAULT_BANDS, 0.2)) {
      for (const v of m.data) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
