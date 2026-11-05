import * as ort from 'onnxruntime-web/webgpu';
import type { BackendReport } from './backend.ts';
import type { ProgressListener } from './cache.ts';
import { loadSession } from './runtime.ts';
import {
  modelUrl,
  resolveInputSize,
  type Backend,
  type MattingModel,
} from './registry.ts';
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
  private currentBackend: BackendReport;
  /** Only one fallback attempt per session, so a failure cannot loop. */
  private fellBack = false;

  private constructor(
    model: MattingModel,
    session: ort.InferenceSession,
    backend: BackendReport,
  ) {
    this.model = model;
    this.session = session;
    this.currentBackend = backend;
  }

  get backend(): BackendReport {
    return this.currentBackend;
  }

  static async load(
    model: MattingModel,
    options: {
      readonly preferredBackend?: Backend;
      readonly onProgress?: ProgressListener;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<MattingSession> {
    const { session, backend } = await loadSession(modelUrl(model), model.downloadBytes, {
      backends: model.backends,
      requiredGpuFeatures: model.requiresGpuFeatures ?? [],
      ...(options.preferredBackend ? { preferredBackend: options.preferredBackend } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    return new MattingSession(model, session, backend);
  }

  get info(): SessionInfo {
    return { modelId: this.model.id, backend: this.currentBackend };
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
  /**
   * Runs the model, moving to WASM if WebGPU fails part-way through.
   *
   * A graph can exceed a device limit that is only discovered when shaders
   * are compiled during the run — `maxStorageBuffersPerShaderStage` is the
   * common one, and the session builds without complaint beforehand. There is
   * no way to test for it up front, so the failure is caught and the work is
   * redone on the CPU rather than handed to the user as a shader-compiler
   * stack trace.
   */
  async run(resized: Rgba): Promise<GrayMask> {
    try {
      return await this.runOnce(resized);
    } catch (cause) {
      if (!this.canFallBackToWasm()) throw cause;

      await this.moveToWasm(describeFailure(cause));
      return this.runOnce(resized);
    }
  }

  private canFallBackToWasm(): boolean {
    return shouldFallBackToWasm({
      current: this.currentBackend.backend,
      supported: this.model.backends,
      alreadyFellBack: this.fellBack,
    });
  }

  /** Rebuilds the session on the CPU backend. Weights come from the cache. */
  private async moveToWasm(reason: string): Promise<void> {
    this.fellBack = true;
    const previous = this.session;
    this.session = null;
    void previous?.release();

    const { session, backend } = await loadSession(
      modelUrl(this.model),
      this.model.downloadBytes,
      { backends: ['wasm'], preferredBackend: 'wasm' },
    );

    this.session = session;
    this.currentBackend = { ...backend, fallbackReason: reason };
  }

  private async runOnce(resized: Rgba): Promise<GrayMask> {
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
      return fromModelOutput(values, width, height, this.model.output);
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

/**
 * Whether a failed run should be retried on the CPU.
 *
 * Any WebGPU failure is worth retrying, not just the known device-limit
 * ones: the worst case is a slow but correct result instead of none. Only
 * once per session, so a persistent fault cannot loop.
 */
export function shouldFallBackToWasm(state: {
  readonly current: Backend;
  readonly supported: readonly Backend[];
  readonly alreadyFellBack: boolean;
}): boolean {
  return (
    !state.alreadyFellBack &&
    state.current === 'webgpu' &&
    state.supported.includes('wasm')
  );
}

/** A short, human-readable reason for the UI, not a stack trace. */
export function describeFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);

  if (/maxStorageBuffersPerShaderStage|Too many storage buffers/i.test(message)) {
    return 'This GPU allows too few storage buffers per shader for this model.';
  }
  if (/bad_alloc|out of memory|OOM/i.test(message)) {
    return 'The GPU ran out of memory for this model.';
  }
  return 'This model failed to run on the GPU.';
}
