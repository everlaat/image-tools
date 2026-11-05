/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import {
  clearModelCache,
  modelCacheUsage,
  type CacheUsage,
  type DownloadProgress,
} from '../lib/models/cache.ts';
import {
  getMattingModel,
  type Backend,
  type MattingModelId,
} from '../lib/models/registry.ts';
import { MattingSession, type SessionInfo } from '../lib/models/session.ts';
import { decodeToRgba, resampleRgba, rgbaToPng } from '../lib/image/canvas.ts';
import {
  applyEdits,
  createEditBuffer,
  hasEdits,
  stampStroke,
  type BrushStroke,
} from '../lib/image/brush.ts';
import { SamEngine } from '../lib/models/sam-engine.ts';
import type { ClickPoint } from '../lib/image/sam.ts';
import {
  applyMask,
  refineMask,
  resizeMask,
  type EdgeRefinement,
} from '../lib/image/mask.ts';
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

  /**
   * Manual corrections, kept separate from the model's mask so the
   * refinement sliders stay live after painting and strokes can be undone.
   * The stroke list is the source of truth; the buffer is rebuilt from it.
   */
  private edits: Float32Array | null = null;
  private strokes: BrushStroke[] = [];

  /** Only constructed if the brush's smart-select mode is actually used. */
  private readonly sam = new SamEngine();

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
    // A new image invalidates every correction and the cached embeddings.
    this.edits = createEditBuffer(decoded.image.width, decoded.image.height);
    this.strokes = [];
    this.sam.releaseEmbeddings();

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
    return rgbaToPng(this.composed(refinement));
  }

  /**
   * Paints one brush stroke into the correction buffer and returns the
   * updated cutout. Strokes are kept so undo can rebuild the buffer.
   */
  async paint(stroke: BrushStroke, refinement: EdgeRefinement): Promise<Blob> {
    const source = this.source;
    const edits = this.edits;
    if (!source || !edits) throw new Error('Segment an image before painting');

    this.strokes.push(stroke);
    stampStroke(edits, source.width, source.height, stroke);
    return rgbaToPng(this.composed(refinement));
  }

  /** Drops the most recent stroke and rebuilds the buffer from the rest. */
  async undo(refinement: EdgeRefinement): Promise<Blob> {
    this.strokes.pop();
    this.rebuildEdits();
    return rgbaToPng(this.composed(refinement));
  }

  async clearEdits(refinement: EdgeRefinement): Promise<Blob> {
    this.strokes = [];
    this.rebuildEdits();
    return rgbaToPng(this.composed(refinement));
  }

  strokeCount(): number {
    return this.strokes.length;
  }

  /**
   * Smart select: one click picks out a whole object with SlimSAM and folds
   * it into the corrections, rather than requiring it to be painted by hand.
   * The model is downloaded only when this is first used.
   */
  async smartSelect(
    point: ClickPoint,
    refinement: EdgeRefinement,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<Blob> {
    const source = this.source;
    const edits = this.edits;
    if (!source || !edits) throw new Error('Segment an image before selecting');

    await this.sam.load(onProgress);
    if (!this.sam.ready) await this.sam.encode(source);

    const region = await this.sam.decode([point]);

    // Fold the region in as a correction at the strength SAM is confident
    // of, so a soft SAM edge stays soft rather than becoming a hard cut.
    const sign = point.positive ? 1 : -1;
    for (let i = 0; i < edits.length; i += 1) {
      const weight = region.data[i] ?? 0;
      if (weight < 0.5) continue;
      const value = sign * weight;
      edits[i] =
        sign > 0 ? Math.max(edits[i] ?? 0, value) : Math.min(edits[i] ?? 0, value);
    }

    return rgbaToPng(this.composed(refinement));
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
    this.sam.dispose();
    this.session = null;
    this.source = null;
    this.mask = null;
    this.edits = null;
    this.strokes = [];
  }

  /** Model mask, lifted and refined, with manual corrections on top. */
  private composed(refinement: EdgeRefinement): Rgba {
    const source = this.source;
    const mask = this.mask;
    if (!source || !mask) throw new Error('Segment an image before composing');

    // Lift to full resolution first so a feather radius means output pixels.
    const full = resizeMask(mask, source.width, source.height);
    const refined = refineMask(full, refinement);

    // Corrections go on last: a deliberate fix should not then be blurred or
    // thresholded away by the sliders.
    const edits = this.edits;
    const final = edits && hasEdits(edits) ? applyEdits(refined, edits) : refined;
    return applyMask(source, final);
  }

  private rebuildEdits(): void {
    const source = this.source;
    if (!source) return;
    const edits = createEditBuffer(source.width, source.height);
    for (const stroke of this.strokes) {
      stampStroke(edits, source.width, source.height, stroke);
    }
    this.edits = edits;
  }
}

export type MattingWorkerApi = MattingWorker;

Comlink.expose(new MattingWorker());
