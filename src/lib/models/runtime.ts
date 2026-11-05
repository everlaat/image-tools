import * as ort from 'onnxruntime-web/webgpu';
import { executionProviders, selectBackend, type BackendReport } from './backend.ts';
import { fetchModelWeights, type ProgressListener } from './cache.ts';
import type { Backend } from './registry.ts';

export interface LoadSessionOptions {
  readonly backends: readonly Backend[];
  readonly requiredGpuFeatures?: readonly string[];
  readonly preferredBackend?: Backend;
  readonly onProgress?: ProgressListener;
  readonly signal?: AbortSignal;
}

export interface LoadedSession {
  readonly session: ort.InferenceSession;
  readonly backend: BackendReport;
}

/**
 * Downloads (or reads from cache) a model's weights and builds a session on
 * the best available backend. Shared by every tool so backend selection,
 * caching and progress reporting behave identically across them.
 */
export async function loadSession(
  url: string,
  expectedBytes: number,
  options: LoadSessionOptions,
): Promise<LoadedSession> {
  const backend = await selectBackend(
    options.backends,
    options.requiredGpuFeatures ?? [],
    options.preferredBackend,
  );

  const weights = await fetchModelWeights(
    url,
    expectedBytes,
    options.onProgress,
    options.signal,
  );

  const session = await ort.InferenceSession.create(weights, {
    executionProviders: [...executionProviders(backend.backend)],
    graphOptimizationLevel: 'all',
  });

  return { session, backend };
}
