import * as ort from 'onnxruntime-web/webgpu';
import { loadSession } from './runtime.ts';
import type { ProgressListener } from './cache.ts';
import { SEGMENTATION_MODEL, fileUrl } from './registry.ts';
import { resampleRgba } from '../image/canvas.ts';
import { toNchwFloat32 } from '../image/tensor.ts';
import {
  bestMaskIndex,
  maskToSource,
  samTransform,
  toModelPoint,
  type ClickPoint,
  type SamTransform,
} from '../image/sam.ts';
import type { GrayMask, Rgba } from '../image/pixels.ts';

/**
 * Segment Anything, shared by the layer splitter and the background-removal
 * brush.
 *
 * The encoder is the expensive half and depends only on the image, so it runs
 * once per image and its embeddings are held here. Every click after that
 * only runs the decoder.
 */
export class SamEngine {
  private encoder: ort.InferenceSession | null = null;
  private decoder: ort.InferenceSession | null = null;
  private embeddings: ort.Tensor | null = null;
  private positional: ort.Tensor | null = null;
  private transform: SamTransform | null = null;

  /** True once embeddings for the current image are available. */
  get ready(): boolean {
    return this.embeddings !== null && this.transform !== null;
  }

  /** Loads both halves of the model, downloading them only on first use. */
  async load(onProgress?: ProgressListener): Promise<void> {
    this.encoder ??= (
      await loadSession(
        fileUrl(SEGMENTATION_MODEL.repo, SEGMENTATION_MODEL.encoder.file),
        SEGMENTATION_MODEL.encoder.downloadBytes,
        { backends: SEGMENTATION_MODEL.backends, ...(onProgress ? { onProgress } : {}) },
      )
    ).session;

    this.decoder ??= (
      await loadSession(
        fileUrl(SEGMENTATION_MODEL.repo, SEGMENTATION_MODEL.decoder.file),
        SEGMENTATION_MODEL.decoder.downloadBytes,
        { backends: SEGMENTATION_MODEL.backends, ...(onProgress ? { onProgress } : {}) },
      )
    ).session;
  }

  /** Computes and caches the embeddings every later click reuses. */
  async encode(source: Rgba): Promise<void> {
    const encoder = this.encoder;
    if (!encoder) throw new Error('Load the segmentation model first');

    const transform = samTransform(source, SEGMENTATION_MODEL.longestEdge);
    const resized = await resampleRgba(
      source,
      transform.resizedWidth,
      transform.resizedHeight,
    );
    const padded = padToSquare(resized, transform.paddedSize);

    const input = new ort.Tensor(
      'float32',
      toNchwFloat32(padded, SEGMENTATION_MODEL.normalisation),
      [1, 3, transform.paddedSize, transform.paddedSize],
    );

    try {
      const out = await encoder.run({ pixel_values: input });
      const embeddings = out.image_embeddings;
      const positional = out.image_positional_embeddings;
      if (!embeddings || !positional)
        throw new Error('SAM encoder returned no embeddings');

      this.releaseEmbeddings();
      this.embeddings = embeddings;
      this.positional = positional;
      this.transform = transform;
    } finally {
      input.dispose();
    }
  }

  /** Runs the decoder for a set of clicks and returns a source-sized mask. */
  async decode(points: readonly ClickPoint[]): Promise<GrayMask> {
    const decoder = this.decoder;
    const { transform, embeddings, positional } = this;
    if (!decoder || !transform || !embeddings || !positional) {
      throw new Error('Encode an image before decoding');
    }
    if (points.length === 0) throw new Error('No points to decode');

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

      const side = SEGMENTATION_MODEL.maskSize;
      const best = bestMaskIndex(scores.data as Float32Array);
      const offset = best * side * side;
      const square: GrayMask = {
        data: (predicted.data as Float32Array).slice(offset, offset + side * side),
        width: side,
        height: side,
      };

      predicted.dispose();
      scores.dispose();
      return maskToSource(square, transform, { sigmoid: true });
    } finally {
      pointTensor.dispose();
      labelTensor.dispose();
    }
  }

  /** Drops the cached embeddings; call when the image changes. */
  releaseEmbeddings(): void {
    this.embeddings?.dispose();
    this.positional?.dispose();
    this.embeddings = null;
    this.positional = null;
    this.transform = null;
  }

  dispose(): void {
    this.releaseEmbeddings();
    void this.encoder?.release();
    void this.decoder?.release();
    this.encoder = null;
    this.decoder = null;
  }
}

/** Pads an image into a top-left aligned square, as SAM's processor does. */
export function padToSquare(image: Rgba, side: number): Rgba {
  if (image.width === side && image.height === side) return image;

  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < image.height; y += 1) {
    const from = y * image.width * 4;
    data.set(image.data.subarray(from, from + image.width * 4), y * side * 4);
  }
  return { data, width: side, height: side };
}
