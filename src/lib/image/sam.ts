import type { GrayMask } from './pixels.ts';

/**
 * Segment Anything resizes an image so its longest edge is 1024, then pads
 * the bottom and right to a 1024x1024 square. Every coordinate that crosses
 * the model boundary has to go through that same transform, in both
 * directions, or clicks land in the wrong place and masks come back offset.
 */
export interface SamTransform {
  /** Source pixels multiplied by this give model pixels. */
  readonly scale: number;
  /** Size of the image content inside the padded square. */
  readonly resizedWidth: number;
  readonly resizedHeight: number;
  /** Side of the padded square fed to the encoder. */
  readonly paddedSize: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

export function samTransform(
  source: { width: number; height: number },
  longestEdge: number,
): SamTransform {
  const longest = Math.max(source.width, source.height);
  const scale = longest > 0 ? longestEdge / longest : 1;

  return {
    scale,
    resizedWidth: Math.round(source.width * scale),
    resizedHeight: Math.round(source.height * scale),
    paddedSize: longestEdge,
    sourceWidth: source.width,
    sourceHeight: source.height,
  };
}

/** A click, in the source image's own pixel coordinates. */
export interface ClickPoint {
  readonly x: number;
  readonly y: number;
  /** Positive clicks add to the selection, negative ones carve out of it. */
  readonly positive: boolean;
}

/** Maps a source-space click into the padded square the encoder saw. */
export function toModelPoint(
  point: ClickPoint,
  transform: SamTransform,
): [number, number] {
  return [point.x * transform.scale, point.y * transform.scale];
}

/**
 * Lifts the decoder's square mask back to source resolution.
 *
 * The mask covers the whole padded square, so the padding has to be skipped
 * rather than scaled: destination pixels are mapped straight into mask space
 * in one bilinear pass, which avoids a separate crop and its rounding.
 */
export function maskToSource(
  mask: GrayMask,
  transform: SamTransform,
  options: { readonly sigmoid?: boolean } = {},
): GrayMask {
  const { sourceWidth: width, sourceHeight: height } = transform;
  const out = new Float32Array(width * height);

  // Source pixel -> padded-square pixel -> mask pixel.
  const toMask = (mask.width / transform.paddedSize) * transform.scale;

  for (let y = 0; y < height; y += 1) {
    const my = (y + 0.5) * toMask - 0.5;
    const y0 = Math.floor(my);
    const dy = my - y0;
    const row0 = clamp(y0, mask.height) * mask.width;
    const row1 = clamp(y0 + 1, mask.height) * mask.width;

    for (let x = 0; x < width; x += 1) {
      const mx = (x + 0.5) * toMask - 0.5;
      const x0 = Math.floor(mx);
      const dx = mx - x0;
      const xa = clamp(x0, mask.width);
      const xb = clamp(x0 + 1, mask.width);

      const top = lerp(mask.data[row0 + xa] ?? 0, mask.data[row0 + xb] ?? 0, dx);
      const bottom = lerp(mask.data[row1 + xa] ?? 0, mask.data[row1 + xb] ?? 0, dx);
      const value = lerp(top, bottom, dy);

      // SAM emits logits, so a sigmoid turns them into the 0..1 range the
      // rest of the pipeline (refinement, compositing) expects.
      out[y * width + x] = options.sigmoid === true ? 1 / (1 + Math.exp(-value)) : value;
    }
  }

  return { data: out, width, height };
}

/**
 * SAM proposes three masks per click. The highest IoU score is the one to
 * keep; the others are coarser or finer interpretations of the same point.
 */
export function bestMaskIndex(iouScores: Float32Array): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < iouScores.length; i += 1) {
    const score = iouScores[i] ?? -Infinity;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function clamp(value: number, length: number): number {
  if (value < 0) return 0;
  if (value > length - 1) return length - 1;
  return value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
