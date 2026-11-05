import * as Comlink from 'comlink';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VectorizeOptions, VectorizeResult } from '../../lib/vector/options.ts';
import type { VectorizeWorkerApi } from '../../workers/vectorize.worker.ts';

export type VectorizeStatus = 'idle' | 'loading' | 'tracing' | 'ready' | 'error';

export interface VectorizeState {
  readonly status: VectorizeStatus;
  readonly result: VectorizeResult | null;
  readonly error: string | null;
}

const INITIAL: VectorizeState = { status: 'idle', result: null, error: null };

export function useVectorize() {
  const [state, setState] = useState<VectorizeState>(INITIAL);

  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Comlink.Remote<VectorizeWorkerApi> | null>(null);
  const runIdRef = useRef(0);

  const api = useCallback((): Comlink.Remote<VectorizeWorkerApi> => {
    if (!apiRef.current) {
      const worker = new Worker(
        new URL('../../workers/vectorize.worker.ts', import.meta.url),
        { type: 'module' },
      );
      workerRef.current = worker;
      apiRef.current = Comlink.wrap<VectorizeWorkerApi>(worker);
    }
    return apiRef.current;
  }, []);

  const release = useCallback(() => {
    const current = apiRef.current;
    const worker = workerRef.current;
    apiRef.current = null;
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

  const run = useCallback(
    async (options: VectorizeOptions) => {
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      setState((prev) => ({ ...prev, status: 'tracing', error: null }));

      try {
        const result = await api().vectorize(options);
        if (runId !== runIdRef.current) return;
        setState({ status: 'ready', result, error: null });
      } catch (cause) {
        if (runId !== runIdRef.current) return;
        setState((prev) => ({
          ...prev,
          status: 'error',
          error:
            cause instanceof Error ? cause.message : 'Could not vectorise that image.',
        }));
      }
    },
    [api],
  );

  const load = useCallback(
    async (file: Blob, options: VectorizeOptions) => {
      setState({ status: 'loading', result: null, error: null });
      try {
        await api().setImage(file);
      } catch (cause) {
        setState({
          status: 'error',
          result: null,
          error: cause instanceof Error ? cause.message : 'Could not read that image.',
        });
        return;
      }
      await run(options);
    },
    [api, run],
  );

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setState(INITIAL);
  }, []);

  return { state, load, run, reset };
}
