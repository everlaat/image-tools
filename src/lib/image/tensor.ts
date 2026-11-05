import type { Normalisation } from '../models/registry.ts';
import type { GrayMask, Rgba } from './pixels.ts';

/**
 * Converts an RGBA raster into the planar NCHW float tensor every matting
 * model here expects: channel-major, scaled to 0..1, then normalised per
 * channel. Alpha is discarded — the models take opaque RGB.
 */
export function toNchwFloat32(image: Rgba, normalisation: Normalisation): Float32Array {
  const { width, height, data } = image;
  const plane = width * height;
  const out = new Float32Array(plane * 3);
  const [meanR, meanG, meanB] = normalisation.mean;
  const [stdR, stdG, stdB] = normalisation.std;

  for (let i = 0; i < plane; i += 1) {
    const src = i * 4;
    out[i] = ((data[src] ?? 0) / 255 - meanR) / stdR;
    out[plane + i] = ((data[src + 1] ?? 0) / 255 - meanG) / stdG;
    out[plane * 2 + i] = ((data[src + 2] ?? 0) / 255 - meanB) / stdB;
  }

  return out;
}

/**
 * Reads a model's single-channel output into a mask.
 *
 * Some exports emit logits rather than probabilities, and some emit an
 * arbitrary range; `normalise` rescales by the observed min/max, which is what
 * the reference implementations of these models do before saving a cutout.
 */
export function fromModelOutput(
  values: Float32Array,
  width: number,
  height: number,
  options: { readonly sigmoid?: boolean; readonly normalise?: boolean } = {},
): GrayMask {
  const count = width * height;
  const out = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const raw = values[i] ?? 0;
    out[i] = options.sigmoid === true ? 1 / (1 + Math.exp(-raw)) : raw;
  }

  if (options.normalise === true) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const v = out[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min;
    if (span > 1e-6) {
      for (let i = 0; i < count; i += 1) out[i] = ((out[i] ?? 0) - min) / span;
    }
  }

  for (let i = 0; i < count; i += 1) {
    const v = out[i] ?? 0;
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }

  return { data: out, width, height };
}
