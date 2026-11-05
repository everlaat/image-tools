import { describe, expect, it } from 'vitest';
import { fromModelOutput, toNchwFloat32 } from '../../src/lib/image/tensor.ts';
import type { Rgba } from '../../src/lib/image/pixels.ts';

const NO_OP = { mean: [0, 0, 0], std: [1, 1, 1] } as const;

function rgba(pixels: readonly number[], width: number, height: number): Rgba {
  return { data: new Uint8ClampedArray(pixels), width, height };
}

describe('toNchwFloat32', () => {
  it('lays channels out planar, not interleaved', () => {
    // Two pixels: pure red then pure green.
    const image = rgba([255, 0, 0, 255, 0, 255, 0, 255], 2, 1);
    const out = toNchwFloat32(image, NO_OP);

    expect(Array.from(out)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('scales to 0..1 and applies per-channel normalisation', () => {
    const image = rgba([255, 128, 0, 255], 1, 1);
    const out = toNchwFloat32(image, { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] });

    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo((128 / 255 - 0.5) / 0.5, 5);
    expect(out[2]).toBeCloseTo(-1, 5);
  });

  it('discards alpha', () => {
    const opaque = toNchwFloat32(rgba([10, 20, 30, 255], 1, 1), NO_OP);
    const transparent = toNchwFloat32(rgba([10, 20, 30, 0], 1, 1), NO_OP);

    expect(Array.from(opaque)).toEqual(Array.from(transparent));
  });

  it('emits three full planes', () => {
    const out = toNchwFloat32(rgba(new Array(4 * 6).fill(0), 3, 2), NO_OP);
    expect(out.length).toBe(3 * 6);
  });
});

describe('fromModelOutput', () => {
  it('passes probabilities through unchanged', () => {
    const mask = fromModelOutput(new Float32Array([0, 0.25, 0.5, 1]), 2, 2);
    expect(Array.from(mask.data)).toEqual([0, 0.25, 0.5, 1]);
  });

  it('clamps values outside 0..1', () => {
    const mask = fromModelOutput(new Float32Array([-3, 7]), 2, 1);
    expect(Array.from(mask.data)).toEqual([0, 1]);
  });

  it('applies a sigmoid when the export emits logits', () => {
    const mask = fromModelOutput(new Float32Array([0]), 1, 1, { sigmoid: true });
    expect(mask.data[0]).toBeCloseTo(0.5, 6);
  });

  it('rescales to the full range when asked', () => {
    const mask = fromModelOutput(new Float32Array([0.2, 0.4, 0.6]), 3, 1, {
      normalise: true,
    });
    expect(mask.data[0]).toBeCloseTo(0, 6);
    expect(mask.data[1]).toBeCloseTo(0.5, 6);
    expect(mask.data[2]).toBeCloseTo(1, 6);
  });

  it('leaves a flat mask alone rather than dividing by zero', () => {
    const mask = fromModelOutput(new Float32Array([0.3, 0.3]), 2, 1, { normalise: true });
    // Not toEqual: 0.3 has no exact float32 representation.
    expect(mask.data[0]).toBeCloseTo(0.3, 6);
    expect(mask.data[1]).toBeCloseTo(0.3, 6);
  });
});
