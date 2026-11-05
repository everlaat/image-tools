/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import * as ort from 'onnxruntime-web/webgpu';
import { zip } from 'fflate';
import { loadSession } from '../lib/models/runtime.ts';
import type { DownloadProgress } from '../lib/models/cache.ts';
import {
  DEPTH_MODEL,
  SEGMENTATION_MODEL,
  fileUrl,
  resolveInputSize,
} from '../lib/models/registry.ts';
import { decodeToRgba, resampleRgba, rgbaToPng } from '../lib/image/canvas.ts';
import { applyMask, refineMask, type EdgeRefinement } from '../lib/image/mask.ts';
import { toNchwFloat32 } from '../lib/image/tensor.ts';
import {
  bestMaskIndex,
  maskToSource,
  samTransform,
  toModelPoint,
  type ClickPoint,
  type SamTransform,
} from '../lib/image/sam.ts';
import { DEFAULT_BANDS, bandsToMasks, normaliseDepth } from '../lib/layers/depth.ts';
import type { GrayMask, Rgba } from '../lib/image/pixels.ts';

export interface LayerSummary {
  readonly id: string;
  readonly name: string;
  /** Share of the image this layer covers, for the panel. */
  readonly coverage: number;
}

export interface ImageInfo {
  readonly width: number;
  readonly height: number;
}

type ProgressFn = (progress: DownloadProgress) => void;

/**
 * Layer splitting: Segment Anything for click-to-select, Depth Anything for
 * an automatic foreground/midground/background guess.
 *
 * The SAM encoder is the expensive part (~3 s on WASM) but only depends on
 * the image, so it runs once and its embeddings are cached. Every subsequent
 * click only runs the decoder, which is a few hundred milliseconds — that is
 * what makes clicking feel interactive rather than a round trip per point.
 */
class LayersWorker {
  private source: Rgba | null = null;
  private transform: SamTransform | null = null;

  private encoder: ort.InferenceSession | null = null;
  private decoder: ort.InferenceSession | null = null;
  private depth: ort.InferenceSession | null = null;

  private embeddings: ort.Tensor | null = null;
  private positional: ort.Tensor | null = null;

  /** Masks stay here; only PNGs cross the worker boundary. */
  private readonly layers = new Map<string, GrayMask>();
  private nextLayerId = 1;

  async setImage(file: Blob): Promise<ImageInfo> {
    this.releaseImageState();
    const decoded = await decodeToRgba(file);
    this.source = decoded.image;
    this.transform = samTransform(decoded.image, SEGMENTATION_MODEL.longestEdge);
    return { width: decoded.image.width, height: decoded.image.height };
  }

  /** Loads SAM and computes the image embeddings every click will reuse. */
  async prepareSegmentation(onProgress?: ProgressFn): Promise<void> {
    const source = this.source;
    const transform = this.transform;
    if (!source || !transform) throw new Error('Load an image first');

    this.encoder ??= (
      await loadSession(
        fileUrl(SEGMENTATION_MODEL.repo, SEGMENTATION_MODEL.encoder.file),
        SEGMENTATION_MODEL.encoder.downloadBytes,
        {
          backends: SEGMENTATION_MODEL.backends,
          ...(onProgress ? { onProgress } : {}),
        },
      )
    ).session;

    this.decoder ??= (
      await loadSession(
        fileUrl(SEGMENTATION_MODEL.repo, SEGMENTATION_MODEL.decoder.file),
        SEGMENTATION_MODEL.decoder.downloadBytes,
        {
          backends: SEGMENTATION_MODEL.backends,
          ...(onProgress ? { onProgress } : {}),
        },
      )
    ).session;

    if (this.embeddings) return;

    // Resize so the longest edge matches, then pad into a square: that is
    // exactly what SAM's own processor does, and the point transform assumes
    // it.
    const resized = await resampleRgba(
      source,
      transform.resizedWidth,
      transform.resizedHeight,
    );
    const padded = padToSquare(resized, transform.paddedSize);
    const pixels = toNchwFloat32(padded, SEGMENTATION_MODEL.normalisation);

    const input = new ort.Tensor('float32', pixels, [
      1,
      3,
      transform.paddedSize,
      transform.paddedSize,
    ]);

    try {
      const out = await this.encoder.run({ pixel_values: input });
      const embeddings = out.image_embeddings;
      const positional = out.image_positional_embeddings;
      if (!embeddings || !positional)
        throw new Error('SAM encoder returned no embeddings');
      this.embeddings = embeddings;
      this.positional = positional;
    } finally {
      input.dispose();
    }
  }

  /** Runs the decoder for the current click set and stores the result. */
  async segment(points: readonly ClickPoint[], name: string): Promise<LayerSummary> {
    const decoder = this.decoder;
    const transform = this.transform;
    const embeddings = this.embeddings;
    const positional = this.positional;
    if (!decoder || !transform || !embeddings || !positional) {
      throw new Error('Prepare segmentation before selecting');
    }
    if (points.length === 0) throw new Error('Click the image to select something');

    const coords = new Float32Array(points.length * 2);
    const labels = new BigInt64Array(points.length);
    points.forEach((point, i) => {
      const [x, y] = toModelPoint(point, transform);
      coords[i * 2] = x;
      coords[i * 2 + 1] = y;
      labels[i] = point.positive ? 1n : 0n;
    });

    const pointTensor = new ort.Tensor('float32', coords, [1, 1, points.length, 2]);
    const labelTensor = new ort.Tensor('int64', labels, [1, 1, points.length]);

    try {
      const out = await decoder.run({
        input_points: pointTensor,
        input_labels: labelTensor,
        image_embeddings: embeddings,
        image_positional_embeddings: positional,
      });

      const predicted = out.pred_masks;
      const scores = out.iou_scores;
      if (!predicted || !scores) throw new Error('SAM decoder returned no masks');

      const masks = predicted.data as Float32Array;
      const side = SEGMENTATION_MODEL.maskSize;
      // Three proposals per click; keep the one SAM rates highest.
      const best = bestMaskIndex(scores.data as Float32Array);
      const offset = best * side * side;

      const square: GrayMask = {
        data: masks.slice(offset, offset + side * side),
        width: side,
        height: side,
      };

      const mask = maskToSource(square, transform, { sigmoid: true });
      predicted.dispose();
      scores.dispose();
      return this.store(mask, name);
    } finally {
      pointTensor.dispose();
      labelTensor.dispose();
    }
  }

  /** Runs depth estimation and turns it into three suggested layers. */
  async suggestLayers(onProgress?: ProgressFn): Promise<LayerSummary[]> {
    const source = this.source;
    if (!source) throw new Error('Load an image first');

    this.depth ??= (
      await loadSession(
        fileUrl(DEPTH_MODEL.repo, DEPTH_MODEL.file),
        DEPTH_MODEL.downloadBytes,
        {
          backends: DEPTH_MODEL.backends,
          ...(onProgress ? { onProgress } : {}),
        },
      )
    ).session;

    const size = resolveInputSize(DEPTH_MODEL.input, source);
    const resized = await resampleRgba(source, size.width, size.height);
    const input = new ort.Tensor(
      'float32',
      toNchwFloat32(resized, DEPTH_MODEL.normalisation),
      [1, 3, size.height, size.width],
    );

    let depthMask: GrayMask;
    try {
      const out = await this.depth.run({ [DEPTH_MODEL.io.input]: input });
      const predicted = out[DEPTH_MODEL.io.output];
      if (!predicted) throw new Error('Depth model returned nothing');

      // Output is [batch, height, width] with no channel axis.
      const [, height = size.height, width = size.width] = predicted.dims;
      depthMask = normaliseDepth(predicted.data as Float32Array, width, height);
      predicted.dispose();
    } finally {
      input.dispose();
    }

    const atSource = resizeTo(depthMask, source.width, source.height);
    return bandsToMasks(atSource, DEFAULT_BANDS).map((mask, i) =>
      this.store(mask, DEFAULT_BANDS[i]?.name ?? `Layer ${String(i + 1)}`),
    );
  }

  /** A layer on its own, as a transparent PNG. */
  async exportLayer(id: string, refinement: EdgeRefinement): Promise<Blob> {
    return rgbaToPng(this.composeLayer(id, refinement));
  }

  /** Every requested layer, zipped. */
  async exportZip(ids: readonly string[], refinement: EdgeRefinement): Promise<Blob> {
    const files: Record<string, Uint8Array> = {};

    for (const [index, id] of ids.entries()) {
      const png = await rgbaToPng(this.composeLayer(id, refinement));
      const bytes = new Uint8Array(await png.arrayBuffer());
      files[`${String(index + 1).padStart(2, '0')}-${safeName(id)}.png`] = bytes;
    }

    const archive = await new Promise<Uint8Array>((resolve, reject) => {
      // Already-compressed PNGs: level 0 avoids spending time re-deflating.
      zip(files, { level: 0 }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    return new Blob([archive as BlobPart], { type: 'application/zip' });
  }

  /** Small preview of a single layer for the panel. */
  async thumbnail(id: string, maxEdge: number): Promise<Blob> {
    const composed = this.composeLayer(id, { threshold: 0.5, hardness: 0, feather: 0 });
    const scale = maxEdge / Math.max(composed.width, composed.height);
    if (scale >= 1) return rgbaToPng(composed);

    const small = await resampleRgba(
      composed,
      Math.max(1, Math.round(composed.width * scale)),
      Math.max(1, Math.round(composed.height * scale)),
    );
    return rgbaToPng(small);
  }

  removeLayer(id: string): void {
    this.layers.delete(id);
  }

  dispose(): void {
    this.releaseImageState();
    void this.encoder?.release();
    void this.decoder?.release();
    void this.depth?.release();
    this.encoder = null;
    this.decoder = null;
    this.depth = null;
    this.source = null;
  }

  private store(mask: GrayMask, name: string): LayerSummary {
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${String(this.nextLayerId)}`;
    this.nextLayerId += 1;
    this.layers.set(id, mask);

    let covered = 0;
    for (const value of mask.data) if (value > 0.5) covered += 1;

    return { id, name, coverage: covered / Math.max(1, mask.data.length) };
  }

  private composeLayer(id: string, refinement: EdgeRefinement): Rgba {
    const source = this.source;
    const mask = this.layers.get(id);
    if (!source || !mask) throw new Error(`No such layer: ${id}`);
    return applyMask(source, refineMask(mask, refinement));
  }

  private releaseImageState(): void {
    this.embeddings?.dispose();
    this.positional?.dispose();
    this.embeddings = null;
    this.positional = null;
    this.layers.clear();
    this.transform = null;
  }
}

/** Pads an image into a top-left aligned square, as SAM's processor does. */
function padToSquare(image: Rgba, side: number): Rgba {
  if (image.width === side && image.height === side) return image;

  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < image.height; y += 1) {
    const from = y * image.width * 4;
    data.set(image.data.subarray(from, from + image.width * 4), y * side * 4);
  }
  return { data, width: side, height: side };
}

/** Nearest-neighbour lift of a depth map; it is smooth, so this is enough. */
function resizeTo(mask: GrayMask, width: number, height: number): GrayMask {
  if (mask.width === width && mask.height === height) return mask;

  const data = new Float32Array(width * height);
  const sx = mask.width / width;
  const sy = mask.height / height;

  for (let y = 0; y < height; y += 1) {
    const row = Math.min(mask.height - 1, Math.floor(y * sy)) * mask.width;
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] =
        mask.data[row + Math.min(mask.width - 1, Math.floor(x * sx))] ?? 0;
    }
  }

  return { data, width, height };
}

function safeName(id: string): string {
  return id.replace(/[^a-z0-9-]/gi, '-');
}

export type LayersWorkerApi = LayersWorker;

Comlink.expose(new LayersWorker());
