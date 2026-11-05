import { clamp01, type GrayMask, type Rgba } from './pixels.ts';

/**
 * Edge treatment applied to the raw model mask.
 *
 * Matting models produce a soft alpha ramp. Left alone it often carries a
 * faint halo of the old background; clamped too hard it turns hair into a
 * cutout. These three controls cover the useful middle, and are applied in
 * the order declared: remap first, then blur, so feathering softens whatever
 * the remap produced rather than being erased by it.
 */
export interface EdgeRefinement {
  /**
   * How strongly the mask is re-fitted to the image's own edges before
   * anything else. Applied by the worker rather than `refineMask`, because
   * it needs the source image as a guide. 0 disables it.
   */
  readonly edgeAlign: number;
  /** Alpha midpoint. Raise to trim halo, lower to keep more of the edge. */
  readonly threshold: number;
  /** How abruptly alpha crosses the threshold. 0 leaves the ramp alone, 1 is binary. */
  readonly hardness: number;
  /** Blur radius in pixels applied to the alpha edge. 0 disables. */
  readonly feather: number;
}

export const DEFAULT_REFINEMENT: EdgeRefinement = {
  // On by default: every model's mask is computed below full resolution, so
  // there is always an upscaled edge worth re-fitting.
  edgeAlign: 0.7,
  threshold: 0.5,
  hardness: 0,
  feather: 0,
};

export function refineMask(mask: GrayMask, refinement: EdgeRefinement): GrayMask {
  const remapped = remap(mask, refinement.threshold, refinement.hardness);
  return refinement.feather > 0 ? blur(remapped, refinement.feather) : remapped;
}

/**
 * Smoothstep remap around `threshold`. `hardness` narrows the transition band;
 * at 1 the band collapses and the mask becomes a hard cut.
 */
function remap(mask: GrayMask, threshold: number, hardness: number): GrayMask {
  const t = clamp01(threshold);
  const h = clamp01(hardness);
  if (h === 0 && t === 0.5) return mask;

  const out = new Float32Array(mask.data.length);
  // Band shrinks towards zero as hardness approaches 1.
  const halfBand = (1 - h) * 0.5;

  for (let i = 0; i < out.length; i += 1) {
    const v = mask.data[i] ?? 0;
    if (halfBand <= 1e-6) {
      out[i] = v >= t ? 1 : 0;
      continue;
    }
    const x = clamp01((v - (t - halfBand)) / (halfBand * 2));
    out[i] = x * x * (3 - 2 * x);
  }

  return { data: out, width: mask.width, height: mask.height };
}

/**
 * Two passes of a separable box blur, which approximates a Gaussian closely
 * enough for an alpha edge at a fraction of the cost.
 */
function blur(mask: GrayMask, radius: number): GrayMask {
  const r = Math.max(1, Math.round(radius));
  let current = mask;
  for (let pass = 0; pass < 2; pass += 1) {
    current = boxBlurVertical(boxBlurHorizontal(current, r), r);
  }
  return current;
}

function boxBlurHorizontal(mask: GrayMask, radius: number): GrayMask {
  const { width, height, data } = mask;
  const out = new Float32Array(data.length);
  const window = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    // Seed the window, clamping at the edges so borders do not darken.
    for (let x = -radius; x <= radius; x += 1) {
      sum += data[row + clampIndex(x, width)] ?? 0;
    }
    for (let x = 0; x < width; x += 1) {
      out[row + x] = sum / window;
      sum -= data[row + clampIndex(x - radius, width)] ?? 0;
      sum += data[row + clampIndex(x + radius + 1, width)] ?? 0;
    }
  }

  return { data: out, width, height };
}

function boxBlurVertical(mask: GrayMask, radius: number): GrayMask {
  const { width, height, data } = mask;
  const out = new Float32Array(data.length);
  const window = radius * 2 + 1;

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) {
      sum += data[clampIndex(y, height) * width + x] ?? 0;
    }
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / window;
      sum -= data[clampIndex(y - radius, height) * width + x] ?? 0;
      sum += data[clampIndex(y + radius + 1, height) * width + x] ?? 0;
    }
  }

  return { data: out, width, height };
}

function clampIndex(value: number, length: number): number {
  if (value < 0) return 0;
  if (value > length - 1) return length - 1;
  return value;
}

/**
 * Bilinear resample. Model masks come back at the inference resolution and
 * have to be lifted to the full image size before they are any use.
 */
export function resizeMask(mask: GrayMask, width: number, height: number): GrayMask {
  if (mask.width === width && mask.height === height) return mask;

  const out = new Float32Array(width * height);
  // Map destination centres into source space to avoid a half-pixel shift.
  const scaleX = mask.width / width;
  const scaleY = mask.height / height;

  for (let y = 0; y < height; y += 1) {
    const srcY = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.floor(srcY);
    const dy = srcY - y0;
    const row0 = clampIndex(y0, mask.height) * mask.width;
    const row1 = clampIndex(y0 + 1, mask.height) * mask.width;

    for (let x = 0; x < width; x += 1) {
      const srcX = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.floor(srcX);
      const dx = srcX - x0;
      const xa = clampIndex(x0, mask.width);
      const xb = clampIndex(x0 + 1, mask.width);

      const top = lerp(mask.data[row0 + xa] ?? 0, mask.data[row0 + xb] ?? 0, dx);
      const bottom = lerp(mask.data[row1 + xa] ?? 0, mask.data[row1 + xb] ?? 0, dx);
      out[y * width + x] = lerp(top, bottom, dy);
    }
  }

  return { data: out, width, height };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Writes the mask into the image's alpha channel, returning a new raster.
 * Colour channels are left untouched so the result stays unpremultiplied and
 * survives a PNG round trip.
 */
export function applyMask(image: Rgba, mask: GrayMask): Rgba {
  if (mask.width !== image.width || mask.height !== image.height) {
    throw new Error(
      `Mask ${mask.width}x${mask.height} does not match image ` +
        `${image.width}x${image.height}`,
    );
  }

  const out = new Uint8ClampedArray(image.data);
  for (let i = 0; i < mask.data.length; i += 1) {
    out[i * 4 + 3] = Math.round(clamp01(mask.data[i] ?? 0) * 255);
  }

  return { data: out, width: image.width, height: image.height };
}
