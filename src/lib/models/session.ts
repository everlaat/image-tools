import * as ort from 'onnxruntime-web/webgpu';
import { executionProviders, selectBackend, type BackendReport } from './backend.ts';
import { fetchModelWeights, type ProgressListener } from './cache.ts';
import { modelUrl, resolveInputSize, type Backend, type MattingModel } from './registry.ts';
import { fromModelOutput } from '../image/tensor.ts';
import type { GrayMask, Rgba } from '../image/pixels.ts';
import { toNchwFloat32 } from '../image/tensor.ts';

export interface SessionInfo {
  readonly modelId: string;
  readonly backend: BackendReport;
}

/**
 * Owns one loaded matting model. Held by the worker for as long as the tool is
 * open and released on `dispose`, because an idle WebGPU session keeps real
 * GPU memory reserved — which matters a lot on phones.
 */
export class MattingSession {
  private session: ort.InferenceSession | null;
  private readonly model: MattingModel;
  readonly backend: BackendReport;

  private constructor(
    model: MattingModel,
    session: ort.InferenceSession,
    backend: BackendReport,
  ) {
    this.model = model;
    this.session = session;
    this.backend = backend;
  }

  static async load(
    model: MattingModel,
    options: {
      readonly preferredBackend?: Backend;
      readonly onProgress?: ProgressListener;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<MattingSession> {
    const backend = await selectBackend(model.backends, options.preferredBackend);

    const weights = await fetchModelWeights(
      modelUrl(model),
      model.downloadBytes,
      options.onProgress,
      options.signal,
    );

    const session = await ort.InferenceSession.create(weights, {
      executionProviders: [...executionProviders(backend.backend)],
      graphOptimizationLevel: 'all',
    });

    return new MattingSession(model, session, backend);
  }

  get info(): SessionInfo {
    return { modelId: this.model.id, backend: this.backend };
  }

  /** Inference resolution this session will use for a given source size. */
  inputSizeFor(source: { width: number; height: number }): {
    width: number;
    height: number;
  } {
    return resolveInputSize(this.model.input, source);
  }

  /**
   * Runs the model on an already-resized raster and returns the raw mask at
   * inference resolution. Lifting it back to full size is the caller's job,
   * so this stays free of canvas dependencies.
   */
  async run(resized: Rgba): Promise<GrayMask> {
    const session = this.session;
    if (!session) throw new Error('This matting session has already been released');

    const input = toNchwFloat32(resized, this.model.normalisation);
    const tensor = new ort.Tensor('float32', input, [
      1,
      3,
      resized.height,
      resized.width,
    ]);

    let output: ort.Tensor | undefined;
    try {
      const results = await session.run({ [this.model.io.input]: tensor });
      output = results[this.model.io.output];

      if (!output) {
        throw new Error(
          `Model ${this.model.id} produced no "${this.model.io.output}" output`,
        );
      }

      const values = output.data;
      if (!(values instanceof Float32Array)) {
        throw new Error(
          `Expected a float32 mask from ${this.model.id}, got ${output.type}`,
        );
      }

      // Trust the graph's own output size: a dynamic model may round.
      const [, , height = resized.height, width = resized.width] = output.dims;
      return fromModelOutput(values, width, height, { normalise: true });
    } finally {
      // Free the GPU/WASM buffers rather than waiting for GC.
      tensor.dispose();
      output?.dispose();
    }
  }

  dispose(): void {
    const session = this.session;
    this.session = null;
    void session?.release();
  }
}
