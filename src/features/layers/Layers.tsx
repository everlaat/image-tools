import { useEffect, useMemo, useState } from 'react';
import { Dropzone } from '../../components/Dropzone.tsx';
import { ProgressBar } from '../../components/ProgressBar.tsx';
import { LayerPanel } from './LayerPanel.tsx';
import { SelectionCanvas } from './SelectionCanvas.tsx';
import { useLayers } from './useLayers.ts';
import { DEFAULT_REFINEMENT } from '../../lib/image/mask.ts';
import type { ClickPoint } from '../../lib/image/sam.ts';
import { DEPTH_MODEL, SEGMENTATION_MODEL } from '../../lib/models/registry.ts';
import { formatBytes } from '../../lib/format.ts';

/** Triggers a download without leaving the page. */
function save(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}

export function Layers() {
  const [file, setFile] = useState<File | null>(null);
  const [points, setPoints] = useState<ClickPoint[]>([]);

  const {
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
  } = useLayers();

  const imageUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl],
  );

  const busy =
    state.status === 'loading-image' ||
    state.status === 'preparing' ||
    state.status === 'segmenting' ||
    state.status === 'estimating-depth';

  const visibleIds = state.layers.filter((l) => l.visible).map((l) => l.id);

  const start = (next: File) => {
    setFile(next);
    setPoints([]);
    void loadImage(next);
  };

  const commitSelection = () => {
    if (points.length === 0) return;
    void selectAt(points, `Selection ${String(state.layers.length + 1)}`).then(() => {
      setPoints([]);
    });
  };

  const encoderBytes =
    SEGMENTATION_MODEL.encoder.downloadBytes + SEGMENTATION_MODEL.decoder.downloadBytes;

  return (
    <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
      <section className="flex flex-col gap-3" aria-label="Image">
        {!file && <Dropzone onFile={start} disabled={busy} />}

        {file && imageUrl && state.image && (
          <SelectionCanvas
            imageUrl={imageUrl}
            width={state.image.width}
            height={state.image.height}
            points={points}
            disabled={busy}
            onAddPoint={(point) => {
              setPoints((prev) => [...prev, point]);
            }}
          />
        )}

        {file && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || points.length === 0}
              onClick={commitSelection}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-40"
            >
              Make layer from {points.length} point{points.length === 1 ? '' : 's'}
            </button>

            <button
              type="button"
              disabled={busy || points.length === 0}
              onClick={() => {
                setPoints([]);
              }}
              className="rounded-md border border-border-subtle px-3 py-1.5 text-sm enabled:hover:bg-surface-raised disabled:opacity-40"
            >
              Clear points
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => void suggestLayers()}
              className="rounded-md border border-border-subtle px-3 py-1.5 text-sm enabled:hover:bg-surface-raised disabled:opacity-40"
            >
              Suggest layers from depth
            </button>
          </div>
        )}

        {file && (
          <p className="text-xs text-ink-muted" role="status">
            {state.status === 'preparing' && 'Preparing the image for selection…'}
            {state.status === 'segmenting' && 'Working out the selection…'}
            {state.status === 'estimating-depth' && 'Estimating depth…'}
            {state.status === 'ready' &&
              'Click to add a point. Alt-click (or right click) to exclude an area.'}
          </p>
        )}

        {state.progress && state.progress.phase !== 'ready' && (
          <ProgressBar
            label={
              state.progress.fromCache ? 'Loading model from cache' : 'Downloading model'
            }
            loaded={state.progress.loaded}
            total={state.progress.total}
            indeterminate={state.progress.phase === 'checking'}
          />
        )}

        {state.error && (
          <p role="alert" className="text-sm text-red-400">
            {state.error}
          </p>
        )}
      </section>

      <aside className="flex flex-col gap-4" aria-label="Layers">
        <LayerPanel
          layers={state.layers}
          busy={busy}
          onToggle={toggleLayer}
          onMove={moveLayer}
          onRemove={removeLayer}
          onExport={(id) => {
            void exportLayer(id, DEFAULT_REFINEMENT).then((url) => {
              save(url, `${id}.png`);
            });
          }}
        />

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy || visibleIds.length === 0}
            onClick={() => {
              void exportZip(visibleIds, DEFAULT_REFINEMENT).then((url) => {
                save(url, 'layers.zip');
              });
            }}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-40"
          >
            Export {visibleIds.length} layer{visibleIds.length === 1 ? '' : 's'} as ZIP
          </button>

          {file && (
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setPoints([]);
                reset();
              }}
              className="rounded-md border border-border-subtle px-3 py-2 text-sm hover:bg-surface-raised"
            >
              Start over
            </button>
          )}
        </div>

        <p className="text-xs text-ink-muted">
          {SEGMENTATION_MODEL.label} · {formatBytes(encoderBytes)} ·{' '}
          <a
            href={SEGMENTATION_MODEL.licence.url}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-ink"
          >
            {SEGMENTATION_MODEL.licence.name}
          </a>
          <br />
          {DEPTH_MODEL.label} · {formatBytes(DEPTH_MODEL.downloadBytes)} ·{' '}
          <a
            href={DEPTH_MODEL.licence.url}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-ink"
          >
            {DEPTH_MODEL.licence.name}
          </a>
        </p>
      </aside>
    </div>
  );
}
