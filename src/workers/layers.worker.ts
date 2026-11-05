/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import * as ort from 'onnxruntime-web/webgpu';
import { zip } from 'fflate';
import { loadSession } from '../lib/models/runtime.ts';
import { SamEngine } from '../lib/models/sam-engine.ts';
import type { DownloadProgress } from '../lib/models/cache.ts';
import { DEPTH_MODEL, fileUrl, resolveInputSize } from '../lib/models/registry.ts';
import { decodeToRgba, resampleRgba, rgbaToPng } from '../lib/image/canvas.ts';
import { applyMask, refineMask, type EdgeRefinement } from '../lib/image/mask.ts';
import { toNchwFloat32 } from '../lib/image/tensor.ts';
import type { ClickPoint } from '../lib/image/sam.ts';
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
  private depth: ort.InferenceSession | null = null;
  private readonly sam = new SamEngine();

  /** Masks stay here; only PNGs cross the worker boundary. */
  private readonly layers = new Map<string, GrayMask>();
  private nextLayerId = 1;

  async setImage(file: Blob): Promise<ImageInfo> {
    this.releaseImageState();
    const decoded = await decodeToRgba(file);
    this.source = decoded.image;
    return { width: decoded.image.width, height: decoded.image.height };
  }

  /** Loads SAM and computes the image embeddings every click will reuse. */
  async prepareSegmentation(onProgress?: ProgressFn): Promise<void> {
    const source = this.source;
    if (!source) throw new Error('Load an image first');

    await this.sam.load(onProgress);
    if (!this.sam.ready) await this.sam.encode(source);
  }

  /** Runs the decoder for the current click set and stores the result. */
  async segment(points: readonly ClickPoint[], name: string): Promise<LayerSummary> {
    if (!this.sam.ready) throw new Error('Prepare segmentation before selecting');
    if (points.length === 0) throw new Error('Click the image to select something');

    return this.store(await this.sam.decode(points), name);
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
    this.sam.dispose();
    void this.depth?.release();
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
    this.sam.releaseEmbeddings();
    this.layers.clear();
  }
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
