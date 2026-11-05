import * as Comlink from 'comlink';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DownloadProgress } from '../../lib/models/cache.ts';
import type { EdgeRefinement } from '../../lib/image/mask.ts';
import type { ClickPoint } from '../../lib/image/sam.ts';
import type {
  ImageInfo,
  LayerSummary,
  LayersWorkerApi,
} from '../../workers/layers.worker.ts';

export type LayersStatus =
  | 'idle'
  | 'loading-image'
  | 'preparing'
  | 'segmenting'
  | 'estimating-depth'
  | 'ready'
  | 'error';

/** A layer as the panel sees it: worker-side mask plus UI-side state. */
export interface Layer extends LayerSummary {
  visible: boolean;
  thumbnailUrl: string | null;
}

export interface LayersState {
  readonly status: LayersStatus;
  readonly image: ImageInfo | null;
  readonly layers: readonly Layer[];
  readonly progress: DownloadProgress | null;
  readonly error: string | null;
}

const INITIAL: LayersState = {
  status: 'idle',
  image: null,
  layers: [],
  progress: null,
  error: null,
};

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function useLayers() {
  const [state, setState] = useState<LayersState>(INITIAL);

  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Comlink.Remote<LayersWorkerApi> | null>(null);
  const urlsRef = useRef<string[]>([]);

  const api = useCallback((): Comlink.Remote<LayersWorkerApi> => {
    if (!apiRef.current) {
      const worker = new Worker(
        new URL('../../workers/layers.worker.ts', import.meta.url),
        {
          type: 'module',
        },
      );
      workerRef.current = worker;
      apiRef.current = Comlink.wrap<LayersWorkerApi>(worker);
    }
    return apiRef.current;
  }, []);

  const track = useCallback((url: string) => {
    urlsRef.current.push(url);
    return url;
  }, []);

  const release = useCallback(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = [];

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

  const onProgress = useCallback((progress: DownloadProgress) => {
    setState((prev) => ({ ...prev, progress }));
  }, []);

  const addLayer = useCallback(
    async (summary: LayerSummary) => {
      let thumbnailUrl: string | null = null;
      try {
        thumbnailUrl = track(URL.createObjectURL(await api().thumbnail(summary.id, 96)));
      } catch {
        // A missing thumbnail is cosmetic; the layer still works.
      }
      setState((prev) => ({
        ...prev,
        layers: [...prev.layers, { ...summary, visible: true, thumbnailUrl }],
      }));
    },
    [api, track],
  );

  const loadImage = useCallback(
    async (file: Blob) => {
      setState({ ...INITIAL, status: 'loading-image' });
      try {
        const image = await api().setImage(file);
        setState((prev) => ({ ...prev, image, status: 'preparing' }));
        await api().prepareSegmentation(Comlink.proxy(onProgress));
        setState((prev) => ({ ...prev, status: 'ready', progress: null }));
      } catch (cause) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: message(cause, 'Could not prepare that image.'),
        }));
      }
    },
    [api, onProgress],
  );

  const selectAt = useCallback(
    async (points: readonly ClickPoint[], name: string) => {
      setState((prev) => ({ ...prev, status: 'segmenting', error: null }));
      try {
        const summary = await api().segment(points, name);
        await addLayer(summary);
        setState((prev) => ({ ...prev, status: 'ready' }));
      } catch (cause) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: message(cause, 'Could not select that.'),
        }));
      }
    },
    [addLayer, api],
  );

  const suggestLayers = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'estimating-depth', error: null }));
    try {
      const summaries = await api().suggestLayers(Comlink.proxy(onProgress));
      for (const summary of summaries) await addLayer(summary);
      setState((prev) => ({ ...prev, status: 'ready', progress: null }));
    } catch (cause) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: message(cause, 'Could not estimate depth.'),
      }));
    }
  }, [addLayer, api, onProgress]);

  const toggleLayer = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    }));
  }, []);

  const moveLayer = useCallback((id: string, direction: -1 | 1) => {
    setState((prev) => {
      const index = prev.layers.findIndex((l) => l.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.layers.length) return prev;

      const layers = [...prev.layers];
      const [moved] = layers.splice(index, 1);
      if (moved) layers.splice(target, 0, moved);
      return { ...prev, layers };
    });
  }, []);

  const removeLayer = useCallback(
    (id: string) => {
      void api().removeLayer(id);
      setState((prev) => ({ ...prev, layers: prev.layers.filter((l) => l.id !== id) }));
    },
    [api],
  );

  const exportLayer = useCallback(
    async (id: string, refinement: EdgeRefinement) =>
      track(URL.createObjectURL(await api().exportLayer(id, refinement))),
    [api, track],
  );

  const exportZip = useCallback(
    async (ids: readonly string[], refinement: EdgeRefinement) =>
      track(URL.createObjectURL(await api().exportZip(ids, refinement))),
    [api, track],
  );

  const reset = useCallback(() => {
    release();
    setState(INITIAL);
  }, [release]);

  return {
    state,
    loadImage,
    selectAt,
    suggestLayers,
    toggleLayer,
    moveLayer,
    removeLayer,
    exportLayer,
    exportZip,
    reset,
  };
}
