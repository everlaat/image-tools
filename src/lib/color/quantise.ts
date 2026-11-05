import type { Rgba } from '../image/pixels.ts';

export type Rgb = readonly [number, number, number];

export type QuantiseMethod = 'median-cut' | 'k-means';

export interface QuantiseOptions {
  /** How many colours to reduce to. */
  readonly colors: number;
  /** Median cut alone is fast and deterministic; k-means refines it. */
  readonly method: QuantiseMethod;
}

export interface QuantiseResult {
  readonly image: Rgba;
  readonly palette: readonly Rgb[];
}

/**
 * Palette building looks at a sample rather than every pixel. A few tens of
 * thousands of pixels pin down a palette just as well as sixteen million, and
 * it keeps the slider responsive on large images.
 */
const MAX_SAMPLES = 32_768;

/** k-means stops here even if it has not settled; it converges well before. */
const MAX_KMEANS_ITERATIONS = 12;

/**
 * Pixels are mapped to the palette through a 15-bit (5 bits per channel)
 * lookup, so the nearest-colour search runs at most 32768 times instead of
 * once per pixel.
 */
const CACHE_BITS = 5;
const CACHE_SIZE = 1 << (CACHE_BITS * 3);

function sample(image: Rgba): Rgb[] {
  const total = image.width * image.height;
  const stride = Math.max(1, Math.floor(total / MAX_SAMPLES));
  const out: Rgb[] = [];

  for (let i = 0; i < total; i += stride) {
    const p = i * 4;
    // Skip near-transparent pixels: they carry no meaningful colour and
    // would drag palette entries towards whatever is underneath.
    if ((image.data[p + 3] ?? 0) < 8) continue;
    out.push([image.data[p] ?? 0, image.data[p + 1] ?? 0, image.data[p + 2] ?? 0]);
  }

  return out;
}

interface Box {
  readonly pixels: Rgb[];
  readonly channel: 0 | 1 | 2;
  readonly range: number;
}

function describe(pixels: Rgb[]): Box {
  let minR = 255,
    maxR = 0,
    minG = 255,
    maxG = 0,
    minB = 255,
    maxB = 0;

  for (const [r, g, b] of pixels) {
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }

  const ranges: [number, number, number] = [maxR - minR, maxG - minG, maxB - minB];
  let channel: 0 | 1 | 2 = 0;
  if (ranges[1] >= ranges[0] && ranges[1] >= ranges[2]) channel = 1;
  else if (ranges[2] >= ranges[0] && ranges[2] >= ranges[1]) channel = 2;

  return { pixels, channel, range: ranges[channel] };
}

function average(pixels: readonly Rgb[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of pixels) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = Math.max(1, pixels.length);
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/**
 * Median cut: repeatedly split the box with the widest colour spread at its
 * median along that channel. Deterministic, and a good starting palette.
 */
export function medianCut(pixels: readonly Rgb[], colors: number): Rgb[] {
  if (pixels.length === 0) return [];
  const wanted = Math.max(1, Math.min(colors, pixels.length));

  // Flat artwork — the main thing this tool vectorises — already has fewer
  // colours than asked for. Splitting at medians would hand back blended
  // averages of colours that were exact to begin with, so take them as they
  // are instead.
  const distinct = exactColors(pixels, wanted);
  if (distinct) return distinct;

  let boxes: Box[] = [describe([...pixels])];

  while (boxes.length < wanted) {
    // Split the widest box; if every box is a single colour, stop early.
    let index = -1;
    let widest = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (box && box.range > widest && box.pixels.length > 1) {
        widest = box.range;
        index = i;
      }
    }
    if (index < 0) break;

    const box = boxes[index];
    if (!box) break;

    const sorted = [...box.pixels].sort((a, b) => a[box.channel] - b[box.channel]);
    const mid = sorted.length >> 1;
    const left = sorted.slice(0, mid);
    const right = sorted.slice(mid);
    if (left.length === 0 || right.length === 0) break;

    boxes = [
      ...boxes.slice(0, index),
      describe(left),
      describe(right),
      ...boxes.slice(index + 1),
    ];
  }

  return boxes.map((box) => average(box.pixels));
}

/**
 * The image's own colours, if there are no more than `limit` of them.
 * Returns undefined as soon as that is exceeded, so this stays cheap on
 * photographic input where it will never apply.
 */
function exactColors(pixels: readonly Rgb[], limit: number): Rgb[] | undefined {
  const seen = new Map<number, Rgb>();

  for (const pixel of pixels) {
    const key = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
    if (!seen.has(key)) {
      if (seen.size === limit) return undefined;
      seen.set(key, pixel);
    }
  }

  return [...seen.values()];
}

function nearest(palette: readonly Rgb[], r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Infinity;

  for (let i = 0; i < palette.length; i += 1) {
    const entry = palette[i];
    if (!entry) continue;
    const dr = r - entry[0];
    const dg = g - entry[1];
    const db = b - entry[2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }

  return best;
}

/** Lloyd's algorithm, seeded from an existing palette. */
export function refineKMeans(pixels: readonly Rgb[], seed: readonly Rgb[]): Rgb[] {
  if (seed.length === 0 || pixels.length === 0) return [...seed];
  let palette = [...seed];

  for (let iteration = 0; iteration < MAX_KMEANS_ITERATIONS; iteration += 1) {
    // Named fields rather than a tuple: an array index is possibly-undefined
    // under noUncheckedIndexedAccess and this is the hot loop.
    const sums = palette.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));

    for (const [r, g, b] of pixels) {
      const bucket = sums[nearest(palette, r, g, b)];
      if (!bucket) continue;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
    }

    const next = palette.map((entry, i) => {
      const bucket = sums[i];
      // An empty cluster keeps its previous centre rather than collapsing.
      if (!bucket || bucket.count === 0) return entry;
      return [
        Math.round(bucket.r / bucket.count),
        Math.round(bucket.g / bucket.count),
        Math.round(bucket.b / bucket.count),
      ] satisfies Rgb;
    });

    // Compared afterwards rather than flagged inside the map: a flag assigned
    // from a closure is invisible to control-flow analysis.
    const settled = next.every((entry, i) => {
      const previous = palette[i];
      return (
        previous?.[0] === entry[0] && previous[1] === entry[1] && previous[2] === entry[2]
      );
    });

    palette = next;
    if (settled) break;
  }

  return palette;
}

/** Reduces an image to at most `colors` distinct colours. */
export function quantise(image: Rgba, options: QuantiseOptions): QuantiseResult {
  const samples = sample(image);
  const seed = medianCut(samples, options.colors);
  const palette = options.method === 'k-means' ? refineKMeans(samples, seed) : seed;

  if (palette.length === 0) {
    return { image, palette: [] };
  }

  const out = new Uint8ClampedArray(image.data);
  const cache = new Int16Array(CACHE_SIZE).fill(-1);
  const shift = 8 - CACHE_BITS;
  const pixels = image.width * image.height;

  for (let i = 0; i < pixels; i += 1) {
    const p = i * 4;
    const r = image.data[p] ?? 0;
    const g = image.data[p + 1] ?? 0;
    const b = image.data[p + 2] ?? 0;

    const key =
      ((r >> shift) << (CACHE_BITS * 2)) | ((g >> shift) << CACHE_BITS) | (b >> shift);

    let index = cache[key] ?? -1;
    if (index < 0) {
      index = nearest(palette, r, g, b);
      cache[key] = index;
    }

    const entry = palette[index];
    if (!entry) continue;
    out[p] = entry[0];
    out[p + 1] = entry[1];
    out[p + 2] = entry[2];
  }

  return {
    image: { data: out, width: image.width, height: image.height },
    palette,
  };
}
