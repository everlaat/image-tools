import * as Comlink from 'comlink';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DownloadProgress } from '../../lib/models/cache.ts';
import type { Backend, MattingModelId } from '../../lib/models/registry.ts';
import type { SessionInfo } from '../../lib/models/session.ts';
import type { EdgeRefinement } from '../../lib/image/mask.ts';
import type { MattingWorkerApi, SegmentResult } from '../../workers/matting.worker.ts';

export type MattingStatus =
  | 'idle'
  | 'loading-model'
  | 'segmenting'
  | 'composing'
  | 'ready'
  | 'error';

export interface MattingState {
  readonly status: MattingStatus;
  readonly progress: DownloadProgress | null;
  readonly session: SessionInfo | null;
  readonly result: SegmentResult | null;
  readonly outputUrl: string | null;
  readonly error: string | null;
}

const INITIAL: MattingState = {
  status: 'idle',
  progress: null,
  session: null,
  result: null,
  outputUrl: null,
  error: null,
};

function message(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return 'Something went wrong while processing the image.';
}

/**
 * Owns the worker and the state machine around it.
 *
 * The worker — and therefore the model download — is created on first use
 * rather than on mount, so simply having the tool on screen costs nothing.
 */
export function useMatting(modelId: MattingModelId, preferredBackend?: Backend) {
  const [state, setState] = useState<MattingState>(INITIAL);

  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Comlink.Remote<MattingWorkerApi> | null>(null);
  const outputUrlRef = useRef<string | null>(null);
  // Guards against a slow run finishing after a newer one started.
  const runIdRef = useRef(0);

  const api = useCallback((): Comlink.Remote<MattingWorkerApi> => {
    if (!apiRef.current) {
      const worker = new Worker(
        new URL('../../workers/matting.worker.ts', import.meta.url),
        { type: 'module' },
      );
      workerRef.current = worker;
      apiRef.current = Comlink.wrap<MattingWorkerApi>(worker);
    }
    return apiRef.current;
  }, []);

  const publish = useCallback((blob: Blob) => {
    if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    const url = URL.createObjectURL(blob);
    outputUrlRef.current = url;
    return url;
  }, []);

  /** Releases the worker, its session and any object URL we still hold. */
  const release = useCallback(() => {
    if (outputUrlRef.current) {
      URL.revokeObjectURL(outputUrlRef.current);
      outputUrlRef.current = null;
    }
    const current = apiRef.current;
    apiRef.current = null;
    const worker = workerRef.current;
    workerRef.current = null;

    void (async () => {
      try {
        await current?.dispose();
      } finally {
        worker?.terminate();
      }
    })();
  }, []);

  useEffect(() => release, [release]);

  const process = useCallback(
    async (file: Blob, refinement: EdgeRefinement) => {
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;

      setState((prev) => ({
        ...prev,
        status: 'loading-model',
        error: null,
        progress: null,
      }));

      try {
        const worker = api();

        const session = await worker.loadModel(
          modelId,
          preferredBackend,
          Comlink.proxy((progress: DownloadProgress) => {
            if (runId === runIdRef.current) {
              setState((prev) => ({ ...prev, progress }));
            }
          }),
        );
        if (runId !== runIdRef.current) return;
        setState((prev) => ({ ...prev, session, status: 'segmenting' }));

        const result = await worker.segment(file);
        if (runId !== runIdRef.current) return;
        setState((prev) => ({ ...prev, result, status: 'composing' }));

        const blob = await worker.compose(refinement);
        if (runId !== runIdRef.current) return;

        setState((prev) => ({
          ...prev,
          status: 'ready',
          outputUrl: publish(blob),
        }));
      } catch (cause) {
        if (runId !== runIdRef.current) return;
        setState((prev) => ({ ...prev, status: 'error', error: message(cause) }));
      }
    },
    [api, modelId, preferredBackend, publish],
  );

  /** Re-composites with new edge settings; no inference, so it is quick. */
  const recompose = useCallback(
    async (refinement: EdgeRefinement) => {
      if (!apiRef.current) return;
      const runId = runIdRef.current;
      setState((prev) => ({ ...prev, status: 'composing' }));
      try {
        const blob = await apiRef.current.compose(refinement);
        if (runId !== runIdRef.current) return;
        setState((prev) => ({ ...prev, status: 'ready', outputUrl: publish(blob) }));
      } catch (cause) {
        setState((prev) => ({ ...prev, status: 'error', error: message(cause) }));
      }
    },
    [publish],
  );

  const reset = useCallback(() => {
    runIdRef.current += 1;
    if (outputUrlRef.current) {
      URL.revokeObjectURL(outputUrlRef.current);
      outputUrlRef.current = null;
    }
    setState(INITIAL);
  }, []);

  return { state, process, recompose, reset, release };
}
