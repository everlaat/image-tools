/**
 * A plain RGBA raster, independent of canvas or DOM types.
 *
 * The buffer is pinned to ArrayBuffer rather than ArrayBufferLike so these
 * rasters can be handed straight to ImageData, which rejects SharedArrayBuffer
 * views.
 */
export interface Rgba {
  readonly data: Uint8ClampedArray<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

/** A single-channel mask with values in 0..1. */
export interface GrayMask {
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
}

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function pixelCount(size: { width: number; height: number }): number {
  return size.width * size.height;
}
