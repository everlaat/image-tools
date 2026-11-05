import { clamp01, type GrayMask } from './pixels.ts';

export type BrushMode = 'add' | 'erase';

export interface BrushPoint {
  readonly x: number;
  readonly y: number;
}

export interface BrushStroke {
  /** Path of the stroke in the source image's own pixel coordinates. */
  readonly points: readonly BrushPoint[];
  /** Radius in source pixels. */
  readonly radius: number;
  /** 0 is a fully soft edge, 1 a hard one. */
  readonly hardness: number;
  readonly mode: BrushMode;
}

/**
 * Manual corrections live in their own signed buffer rather than being burnt
 * into the model's mask: positive values force a pixel opaque, negative force
 * it transparent, zero defers to the model. Keeping them separate means the
 * refinement sliders can still be moved afterwards without destroying the
 * painting, and a stroke can be undone by rebuilding the buffer.
 */
export function createEditBuffer(width: number, height: number): Float32Array {
  return new Float32Array(width * height);
}

/**
 * Stamps a stroke into the edit buffer.
 *
 * Discs are stamped along each segment rather than once per reported pointer
 * position, because pointer events are far too sparse at speed and would
 * leave a dotted line. Within one stroke the strongest value wins, so
 * overlapping stamps do not accumulate into a harder edge than the brush.
 */
export function stampStroke(
  edits: Float32Array,
  width: number,
  height: number,
  stroke: BrushStroke,
): void {
  const radius = Math.max(0.5, stroke.radius);
  const step = Math.max(1, radius / 3);
  const sign = stroke.mode === 'add' ? 1 : -1;

  for (const [x, y] of walk(stroke.points, step)) {
    stamp(edits, width, height, x, y, radius, stroke.hardness, sign);
  }
}

/** Yields points spaced at most `step` apart along the stroke path. */
function* walk(
  points: readonly BrushPoint[],
  step: number,
): Generator<readonly [number, number]> {
  if (points.length === 0) return;

  const first = points[0];
  if (!first) return;
  yield [first.x, first.y];

  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to) continue;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const steps = Math.ceil(distance / step);

    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      yield [from.x + dx * t, from.y + dy * t];
    }
  }
}

function stamp(
  edits: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  hardness: number,
  sign: number,
): void {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));

  // Below this fraction of the radius the brush is at full strength; beyond
  // it the weight falls off smoothly to zero at the rim.
  const solid = clamp01(hardness);

  for (let y = minY; y <= maxY; y += 1) {
    const dy = y - cy;
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const distance = Math.hypot(dx, dy) / radius;
      if (distance > 1) continue;

      const weight =
        distance <= solid ? 1 : falloff(1 - (distance - solid) / (1 - solid || 1));

      const index = y * width + x;
      const current = edits[index] ?? 0;
      const value = sign * weight;

      // Strongest wins within a mode; the opposite mode overrides.
      edits[index] = sign > 0 ? Math.max(current, value) : Math.min(current, value);
    }
  }
}

function falloff(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/**
 * Blends the manual edits over a mask. Applied after the refinement sliders,
 * so a deliberate correction is not then blurred or thresholded away.
 */
export function applyEdits(mask: GrayMask, edits: Float32Array): GrayMask {
  if (edits.length !== mask.data.length) {
    throw new Error('Edit buffer does not match the mask it is applied to');
  }

  const data = new Float32Array(mask.data.length);
  for (let i = 0; i < data.length; i += 1) {
    const base = mask.data[i] ?? 0;
    const edit = edits[i] ?? 0;
    data[i] =
      edit > 0
        ? base + (1 - base) * edit // pull towards opaque
        : base * (1 + edit); // edit is negative: pull towards transparent
  }

  return { data, width: mask.width, height: mask.height };
}

/** True when nothing has been painted, so composing can skip the blend. */
export function hasEdits(edits: Float32Array): boolean {
  for (let i = 0; i < edits.length; i += 1) if (edits[i] !== 0) return true;
  return false;
}
