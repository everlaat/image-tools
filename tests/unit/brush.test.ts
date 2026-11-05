import { describe, expect, it } from 'vitest';
import {
  applyEdits,
  createEditBuffer,
  hasEdits,
  stampStroke,
  type BrushStroke,
} from '../../src/lib/image/brush.ts';
import type { GrayMask } from '../../src/lib/image/pixels.ts';

const W = 21;
const H = 21;
const CENTRE = Math.floor(H / 2) * W + Math.floor(W / 2);

function stroke(partial: Partial<BrushStroke> = {}): BrushStroke {
  return {
    points: [{ x: 10, y: 10 }],
    radius: 4,
    hardness: 1,
    mode: 'add',
    ...partial,
  };
}

describe('stampStroke', () => {
  it('marks the centre of the brush at full strength', () => {
    const edits = createEditBuffer(W, H);
    stampStroke(edits, W, H, stroke());
    expect(edits[CENTRE]).toBeCloseTo(1, 5);
  });

  it('leaves pixels outside the radius untouched', () => {
    const edits = createEditBuffer(W, H);
    stampStroke(edits, W, H, stroke({ radius: 3 }));
    expect(edits[0]).toBe(0);
  });

  it('erasing writes negative values', () => {
    const edits = createEditBuffer(W, H);
    stampStroke(edits, W, H, stroke({ mode: 'erase' }));
    expect(edits[CENTRE]).toBeCloseTo(-1, 5);
  });

  it('falls off towards the rim when soft', () => {
    const edits = createEditBuffer(W, H);
    stampStroke(edits, W, H, stroke({ radius: 6, hardness: 0 }));
    const centre = edits[CENTRE] ?? 0;
    const nearRim = edits[CENTRE + 5] ?? 0;
    expect(centre).toBeGreaterThan(nearRim);
    expect(nearRim).toBeGreaterThan(0);
  });

  it('a hard brush does not fall off until the rim', () => {
    const edits = createEditBuffer(W, H);
    stampStroke(edits, W, H, stroke({ radius: 6, hardness: 1 }));
    expect(edits[CENTRE + 3]).toBeCloseTo(1, 5);
  });

  it('draws a continuous line between sparse pointer samples', () => {
    const edits = createEditBuffer(W, H);
    // Two points far apart: everything between them must be covered.
    stampStroke(
      edits,
      W,
      H,
      stroke({
        points: [
          { x: 2, y: 10 },
          { x: 18, y: 10 },
        ],
        radius: 2,
      }),
    );
    const row = 10 * W;
    for (let x = 3; x <= 17; x += 1) {
      expect(edits[row + x]).toBeGreaterThan(0.5);
    }
  });

  it('does not run off the edge of the buffer', () => {
    const edits = createEditBuffer(W, H);
    expect(() => {
      stampStroke(
        edits,
        W,
        H,
        stroke({
          points: [
            { x: -5, y: -5 },
            { x: 25, y: 25 },
          ],
        }),
      );
    }).not.toThrow();
    expect(edits).toHaveLength(W * H);
  });

  it('overlapping stamps in one stroke do not exceed full strength', () => {
    const edits = createEditBuffer(W, H);
    stampStroke(
      edits,
      W,
      H,
      stroke({
        points: [
          { x: 10, y: 10 },
          { x: 10, y: 10 },
        ],
      }),
    );
    for (const v of edits) expect(v).toBeLessThanOrEqual(1);
  });

  it('erasing over a painted area wins', () => {
    const edits = createEditBuffer(W, H);
    stampStroke(edits, W, H, stroke({ mode: 'add' }));
    stampStroke(edits, W, H, stroke({ mode: 'erase' }));
    expect(edits[CENTRE]).toBeLessThan(0);
  });

  it('painting over an erased area wins', () => {
    const edits = createEditBuffer(W, H);
    stampStroke(edits, W, H, stroke({ mode: 'erase' }));
    stampStroke(edits, W, H, stroke({ mode: 'add' }));
    expect(edits[CENTRE]).toBeGreaterThan(0);
  });

  it('ignores an empty stroke', () => {
    const edits = createEditBuffer(W, H);
    stampStroke(edits, W, H, stroke({ points: [] }));
    expect(hasEdits(edits)).toBe(false);
  });
});

describe('applyEdits', () => {
  const mask = (value: number): GrayMask => ({
    data: new Float32Array([value, value]),
    width: 2,
    height: 1,
  });

  it('is a no-op where nothing was painted', () => {
    const out = applyEdits(mask(0.4), new Float32Array([0, 0]));
    // Not toEqual: 0.4 has no exact float32 representation.
    expect(out.data[0]).toBeCloseTo(0.4, 6);
    expect(out.data[1]).toBeCloseTo(0.4, 6);
  });

  it('pulls a transparent pixel fully opaque at full strength', () => {
    const out = applyEdits(mask(0), new Float32Array([1, 0]));
    expect(out.data[0]).toBeCloseTo(1, 6);
  });

  it('pulls an opaque pixel fully transparent at full erase strength', () => {
    const out = applyEdits(mask(1), new Float32Array([-1, 0]));
    expect(out.data[0]).toBeCloseTo(0, 6);
  });

  it('blends partially for a soft brush edge', () => {
    const out = applyEdits(mask(0.2), new Float32Array([0.5, 0]));
    expect(out.data[0]).toBeCloseTo(0.2 + 0.8 * 0.5, 6);
  });

  it('keeps every result inside 0..1', () => {
    const out = applyEdits(mask(0.5), new Float32Array([1, -1]));
    for (const v of out.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('refuses a buffer of the wrong size', () => {
    expect(() => applyEdits(mask(0.5), new Float32Array([0]))).toThrow(/does not match/);
  });
});

describe('hasEdits', () => {
  it('is false for a fresh buffer', () => {
    expect(hasEdits(createEditBuffer(4, 4))).toBe(false);
  });

  it('is true once something is painted', () => {
    const edits = createEditBuffer(W, H);
    stampStroke(edits, W, H, stroke());
    expect(hasEdits(edits)).toBe(true);
  });
});
