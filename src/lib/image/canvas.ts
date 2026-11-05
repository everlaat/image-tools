import type { Rgba } from './pixels.ts';

/**
 * Longest edge we will hold as a full-resolution RGBA buffer.
 *
 * A 8000x6000 photo is 192 MB as RGBA, which is enough to have the tab killed
 * on a phone. Anything larger is scaled down to this before processing and the
 * UI says so, rather than silently failing.
 */
export const MAX_WORKING_EDGE = 4096;

export interface Decoded {
  readonly image: Rgba;
  /** True when the source was larger than MAX_WORKING_EDGE and was scaled. */
  readonly downscaled: boolean;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

/** Fits a size inside a square bound, preserving aspect ratio. */
export function fitWithin(
  size: { width: number; height: number },
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(size.width, size.height);
  if (longest <= maxEdge) return { width: size.width, height: size.height };

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

function context(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser could not provide a 2D canvas context');
  return ctx;
}

/** Decodes an image file into a full-resolution RGBA buffer. */
export async function decodeToRgba(source: Blob): Promise<Decoded> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    throw new Error('That file could not be read as an image.');
  }

  try {
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const target = fitWithin(bitmap, MAX_WORKING_EDGE);

    const ctx = context(target.width, target.height);
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    const { data } = ctx.getImageData(0, 0, target.width, target.height);

    return {
      image: { data, width: target.width, height: target.height },
      downscaled: target.width !== sourceWidth || target.height !== sourceHeight,
      sourceWidth,
      sourceHeight,
    };
  } finally {
    bitmap.close();
  }
}

/** Resamples an RGBA buffer to exact dimensions, for model input. */
export async function resampleRgba(
  image: Rgba,
  width: number,
  height: number,
): Promise<Rgba> {
  if (image.width === width && image.height === height) return image;

  const source = new OffscreenCanvas(image.width, image.height);
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) throw new Error('This browser could not provide a 2D canvas context');
  sourceCtx.putImageData(
    new ImageData(image.data, image.width, image.height),
    0,
    0,
  );

  const bitmap = await createImageBitmap(source);
  try {
    const ctx = context(width, height);
    // Canvas downscaling is box-filtered by the browser, which is what we want
    // going into the model; a naive nearest-neighbour drop aliases badly.
    ctx.drawImage(bitmap, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    return { data, width, height };
  } finally {
    bitmap.close();
  }
}

/** Encodes an RGBA buffer as a PNG, preserving the alpha channel. */
export async function rgbaToPng(image: Rgba): Promise<Blob> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not provide a 2D canvas context');
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
