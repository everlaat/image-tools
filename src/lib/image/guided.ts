import type { GrayMask, Rgba } from './pixels.ts';

/**
 * Edge-aware alpha refinement (He et al.'s guided filter).
 *
 * A matting mask is produced at the model's own resolution — 512 or 1024 —
 * and then stretched to the full image, so its edges are soft and slightly
 * off wherever the real boundary is. The guided filter re-fits the alpha to
 * the *image's* edges: inside a flat region it behaves like a blur, but
 * across a strong edge in the guide it follows that edge. That is what turns
 * a stair-stepped upscaled boundary back into something that tracks the
 * subject's outline.
 *
 * Runs in O(pixels) via box filters, independent of radius.
 */

/** Perceptual luma, 0..1, used as the guide. */
export function lumaOf(image: Rgba): Float32Array {
  const out = new Float32Array(image.width * image.height);
  for (let i = 0; i < out.length; i += 1) {
    const p = i * 4;
    out[i] =
      ((image.data[p] ?? 0) * 0.299 +
        (image.data[p + 1] ?? 0) * 0.587 +
        (image.data[p + 2] ?? 0) * 0.114) /
      255;
  }
  return out;
}

export interface GuidedOptions {
  /** Window radius in pixels. Larger reaches further for an edge to snap to. */
  readonly radius: number;
  /**
   * Edge sensitivity. Smaller preserves more edges (and more noise); larger
   * smooths across weak ones.
   */
  readonly epsilon: number;
  /** 0 leaves the mask alone, 1 is the fully refined result. */
  readonly strength: number;
}

export function guidedRefine(
  mask: GrayMask,
  guide: Float32Array,
  options: GuidedOptions,
): GrayMask {
  const { width, height } = mask;
  const count = width * height;

  if (guide.length !== count) {
    throw new Error('Guide does not match the mask it refines');
  }
  if (options.strength <= 0 || options.radius < 1) return mask;

  const radius = Math.round(options.radius);
  const p = mask.data;

  // Per-window means of the guide, the alpha and their products.
  const meanI = boxFilter(guide, width, height, radius);
  const meanP = boxFilter(p, width, height, radius);

  const ii = new Float32Array(count);
  const ip = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const g = guide[i] ?? 0;
    ii[i] = g * g;
    ip[i] = g * (p[i] ?? 0);
  }

  const meanII = boxFilter(ii, width, height, radius);
  const meanIP = boxFilter(ip, width, height, radius);

  // a is how strongly alpha should track the guide in this window; where the
  // guide is flat (low variance) a tends to 0 and the filter just smooths.
  const a = new Float32Array(count);
  const b = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const mI = meanI[i] ?? 0;
    const mP = meanP[i] ?? 0;
    const varI = (meanII[i] ?? 0) - mI * mI;
    const covIP = (meanIP[i] ?? 0) - mI * mP;
    const ai = covIP / (varI + options.epsilon);
    a[i] = ai;
    b[i] = mP - ai * mI;
  }

  const meanA = boxFilter(a, width, height, radius);
  const meanB = boxFilter(b, width, height, radius);

  const strength = Math.min(1, options.strength);
  const data = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const refined = (meanA[i] ?? 0) * (guide[i] ?? 0) + (meanB[i] ?? 0);
    const original = p[i] ?? 0;
    const blended = original + (refined - original) * strength;
    data[i] = blended < 0 ? 0 : blended > 1 ? 1 : blended;
  }

  return { data, width, height };
}

/**
 * Normalised box filter via a sliding window, so cost does not grow with
 * radius. Edges clamp, which keeps borders from darkening.
 */
function boxFilter(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  return blurVertical(
    blurHorizontal(source, width, height, radius),
    width,
    height,
    radius,
  );
}

function blurHorizontal(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const out = new Float32Array(source.length);
  const window = radius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) sum += source[row + clamp(x, width)] ?? 0;

    for (let x = 0; x < width; x += 1) {
      out[row + x] = sum / window;
      sum -= source[row + clamp(x - radius, width)] ?? 0;
      sum += source[row + clamp(x + radius + 1, width)] ?? 0;
    }
  }

  return out;
}

function blurVertical(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const out = new Float32Array(source.length);
  const window = radius * 2 + 1;

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) {
      sum += source[clamp(y, height) * width + x] ?? 0;
    }
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / window;
      sum -= source[clamp(y - radius, height) * width + x] ?? 0;
      sum += source[clamp(y + radius + 1, height) * width + x] ?? 0;
    }
  }

  return out;
}

function clamp(value: number, length: number): number {
  if (value < 0) return 0;
  if (value > length - 1) return length - 1;
  return value;
}
