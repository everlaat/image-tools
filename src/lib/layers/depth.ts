import { clamp01, type GrayMask } from '../image/pixels.ts';

/**
 * A depth map says how far away each pixel is, not what the objects are.
 * Slicing it at thresholds gives a usable first guess at foreground,
 * midground and background, which the user can then correct by clicking.
 */
export interface DepthBand {
  readonly name: string;
  /** Inclusive lower bound on normalised depth, 0 = furthest, 1 = nearest. */
  readonly from: number;
  /** Exclusive upper bound, except for the topmost band. */
  readonly to: number;
}

/**
 * Default thirds. Depth Anything emits relative depth with no absolute
 * scale, so fixed fractions of the observed range are as principled as it
 * gets without knowing the scene.
 */
export const DEFAULT_BANDS: readonly [DepthBand, DepthBand, DepthBand] = [
  { name: 'Foreground', from: 2 / 3, to: 1 },
  { name: 'Midground', from: 1 / 3, to: 2 / 3 },
  { name: 'Background', from: 0, to: 1 / 3 },
];

/**
 * Rescales a raw depth map to 0..1, where 1 is nearest.
 *
 * The model's output has no absolute scale and its sign convention varies by
 * export, so the range is normalised from what is actually present.
 */
export function normaliseDepth(
  values: Float32Array,
  width: number,
  height: number,
): GrayMask {
  const count = Math.min(values.length, width * height);
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < count; i += 1) {
    const v = values[i] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const span = max - min;
  const data = new Float32Array(width * height);
  for (let i = 0; i < count; i += 1) {
    data[i] = span > 1e-6 ? ((values[i] ?? 0) - min) / span : 0;
  }

  return { data, width, height };
}

/**
 * Cuts a normalised depth map into one mask per band.
 *
 * Edges are feathered across a small depth margin rather than cut hard, so
 * neighbouring layers overlap slightly instead of leaving a seam when they
 * are composited back together.
 */
export function bandsToMasks(
  depth: GrayMask,
  bands: readonly DepthBand[] = DEFAULT_BANDS,
  softness = 0.04,
): GrayMask[] {
  return bands.map((band) => {
    const data = new Float32Array(depth.data.length);

    // The outermost bounds are inclusive, so a pixel at exactly 0 or exactly
    // 1 lands in a band instead of falling out of all of them.
    const openBelow = band.from <= 0;
    const openAbove = band.to >= 1;

    for (let i = 0; i < data.length; i += 1) {
      const d = depth.data[i] ?? 0;
      const above = openBelow ? 1 : ramp(d, band.from, softness);
      const below = openAbove ? 1 : 1 - ramp(d, band.to, softness);
      data[i] = clamp01(Math.min(above, below));
    }

    return { data, width: depth.width, height: depth.height };
  });
}

/**
 * 0 below `edge`, 1 above it, with a smooth transition of width `softness`.
 * A zero-width ramp degenerates to a hard step.
 */
function ramp(value: number, edge: number, softness: number): number {
  if (softness <= 0) return value >= edge ? 1 : 0;
  const t = clamp01((value - (edge - softness)) / (softness * 2));
  return t * t * (3 - 2 * t);
}
