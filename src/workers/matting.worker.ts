/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import {
  clearModelCache,
  modelCacheUsage,
  type CacheUsage,
  type DownloadProgress,
} from '../lib/models/cache.ts';
import { getMattingModel, type Backend, type MattingModelId } from '../lib/models/registry.ts';
import { MattingSession, type SessionInfo } from '../lib/models/session.ts';
import { decodeToRgba, resampleRgba, rgbaToPng } from '../lib/image/canvas.ts';
import { applyMask, refineMask, resizeMask, type EdgeRefinement } from '../lib/image/mask.ts';
import type { GrayMask, Rgba } from '../lib/image/pixels.ts';

export interface SegmentResult {
  readonly width: number;
  readonly height: number;
  /** Set when the source exceeded the working size cap and was scaled down. */
  readonly downscaledFrom?: { readonly width: number; readonly height: number };
}

/**
 * All inference and pixel work happens here so the UI thread stays responsive.
 *
 * The worker deliberately keeps the source raster and the raw model mask
 * between calls: changing feather or threshold then only re-composites, which
 * is milliseconds, instead of re-running the model.
 */
class MattingWorker {
  private session: MattingSession | null = null;
  private source: Rgba | null = null;
  private mask: GrayMask | null = null;

  async loadModel(
    modelId: MattingModelId,
    preferredBackend?: Backend,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<SessionInfo> {
    const model = getMattingModel(modelId);

    // Switching models must not leave the old session holding GPU memory.
    if (this.session?.info.modelId !== modelId) {
      this.session?.dispose();
      this.session = null;
      this.mask = null;

      this.session = await MattingSession.load(model, {
        ...(preferredBackend ? { preferredBackend } : {}),
        ...(onProgress ? { onProgress } : {}),
      });
    }

    return this.session.info;
  }

  async segment(file: Blob): Promise<SegmentResult> {
    const session = this.session;
    if (!session) throw new Error('Load a model before segmenting');

    const decoded = await decodeToRgba(file);
    this.source = decoded.image;

    const inputSize = session.inputSizeFor(decoded.image);
    const resized = await resampleRgba(decoded.image, inputSize.width, inputSize.height);
    this.mask = await session.run(resized);

    return {
      width: decoded.image.width,
      height: decoded.image.height,
      ...(decoded.downscaled
        ? {
            downscaledFrom: {
              width: decoded.sourceWidth,
              height: decoded.sourceHeight,
            },
          }
        : {}),
    };
  }

  /** Re-applies edge settings to the mask already in hand and encodes a PNG. */
  async compose(refinement: EdgeRefinement): Promise<Blob> {
    const source = this.source;
    const mask = this.mask;
    if (!source || !mask) throw new Error('Segment an image before composing');

    // Lift to full resolution first so a feather radius means output pixels.
    const full = resizeMask(mask, source.width, source.height);
    return rgbaToPng(applyMask(source, refineMask(full, refinement)));
  }

  cacheUsage(): Promise<CacheUsage> {
    return modelCacheUsage();
  }

  async clearCache(): Promise<number> {
    return clearModelCache();
  }

  /** Releases the session and buffers when the tool is closed. */
  dispose(): void {
    this.session?.dispose();
    this.session = null;
    this.source = null;
    this.mask = null;
  }
}

export type MattingWorkerApi = MattingWorker;

Comlink.expose(new MattingWorker());
