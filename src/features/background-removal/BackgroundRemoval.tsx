import { useEffect, useMemo, useRef, useState } from 'react';
import { Dropzone } from '../../components/Dropzone.tsx';
import { CompareSlider } from '../../components/CompareSlider.tsx';
import {
  BackgroundPicker,
  type PreviewBackground,
} from '../../components/BackgroundPicker.tsx';
import { ProgressBar } from '../../components/ProgressBar.tsx';
import { RangeField } from '../../components/RangeField.tsx';
import { BrushCanvas } from '../../components/BrushCanvas.tsx';
import type { BrushMode } from '../../lib/image/brush.ts';
import { BackendBadge } from './BackendBadge.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { useMatting } from './useMatting.ts';
import { DEFAULT_REFINEMENT, type EdgeRefinement } from '../../lib/image/mask.ts';
import {
  DEFAULT_MATTING_MODEL_ID,
  getMattingModel,
  type MattingModelId,
} from '../../lib/models/registry.ts';
import { formatBytes } from '../../lib/format.ts';

const RECOMPOSE_DELAY_MS = 150;

export function BackgroundRemoval() {
  const [modelId, setModelId] = useState<MattingModelId>(DEFAULT_MATTING_MODEL_ID);
  const [refinement, setRefinement] = useState<EdgeRefinement>(DEFAULT_REFINEMENT);
  const [file, setFile] = useState<File | null>(null);
  const [background, setBackground] = useState<PreviewBackground>(null);
  const [view, setView] = useState<'compare' | 'brush'>('compare');
  const [brushMode, setBrushMode] = useState<BrushMode>('add');
  const [brushRadius, setBrushRadius] = useState(32);
  const [smartSelect, setSmartSelect] = useState(false);

  const {
    state,
    process,
    recompose,
    paint,
    undoStroke,
    clearEdits,
    smartSelect: pickObject,
    reset,
  } = useMatting(modelId);
  const model = getMattingModel(modelId);

  const inputUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (inputUrl) URL.revokeObjectURL(inputUrl);
    },
    [inputUrl],
  );

  // Dragging a slider should not queue a composite per frame.
  const settled = useRef(refinement);
  useEffect(() => {
    if (state.status === 'idle' || !state.result) return;
    if (settled.current === refinement) return;

    const timer = setTimeout(() => {
      settled.current = refinement;
      void recompose(refinement);
    }, RECOMPOSE_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [refinement, recompose, state.result, state.status]);

  const start = (next: File) => {
    setFile(next);
    settled.current = refinement;
    void process(next, refinement);
  };

  const busy =
    state.status === 'loading-model' ||
    state.status === 'segmenting' ||
    state.status === 'composing';

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <section className="flex flex-col gap-3" aria-label="Image">
          {!file && <Dropzone onFile={start} disabled={busy} />}

          {file && inputUrl && state.outputUrl && state.result && view === 'compare' && (
            <CompareSlider
              beforeUrl={inputUrl}
              afterUrl={state.outputUrl}
              width={state.result.width}
              height={state.result.height}
              background={background}
            />
          )}

          {file && state.outputUrl && state.result && view === 'brush' && (
            <BrushCanvas
              imageUrl={state.outputUrl}
              width={state.result.width}
              height={state.result.height}
              radius={brushRadius}
              hardness={0.5}
              mode={brushMode}
              smartSelect={smartSelect}
              background={background}
              disabled={busy}
              onStroke={(stroke) => {
                void paint(stroke, refinement);
              }}
              onPick={(point) => {
                void pickObject({ ...point, positive: brushMode === 'add' }, refinement);
              }}
            />
          )}

          {state.result && (
            <div role="group" aria-label="View" className="flex gap-2">
              {(['compare', 'brush'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => {
                    setView(mode);
                  }}
                  className="rounded-md border border-border-subtle px-3 py-1.5 text-sm transition-colors hover:bg-surface-raised aria-pressed:border-accent aria-pressed:bg-surface-raised"
                >
                  {mode === 'compare' ? 'Compare' : 'Fix with brush'}
                </button>
              ))}
            </div>
          )}

          {file && !state.outputUrl && (
            <div className="flex min-h-48 items-center justify-center rounded-lg border border-border-subtle bg-surface-sunken p-6">
              <p className="text-sm text-ink-muted" role="status">
                {state.status === 'loading-model' && 'Preparing the model…'}
                {state.status === 'segmenting' && 'Finding the subject…'}
                {state.status === 'composing' && 'Building the cutout…'}
                {state.status === 'error' && 'Could not process that image.'}
              </p>
            </div>
          )}

          {state.progress && state.progress.phase !== 'ready' && (
            <ProgressBar
              label={
                state.progress.fromCache
                  ? 'Loading model from cache'
                  : `Downloading ${model.label}`
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

          {state.result?.downscaledFrom && (
            <p className="text-xs text-ink-muted">
              Scaled down from {state.result.downscaledFrom.width}×
              {state.result.downscaledFrom.height} to keep memory in check.
            </p>
          )}
        </section>

        <aside className="flex flex-col gap-5" aria-label="Settings">
          <ModelPicker
            value={modelId}
            disabled={busy}
            onChange={(next) => {
              setModelId(next);
              if (file) {
                settled.current = refinement;
                void process(file, refinement);
              }
            }}
          />

          <fieldset className="flex flex-col gap-4 border-0 p-0">
            <legend className="mb-1 text-sm font-medium">Edge refinement</legend>

            <RangeField
              label="Threshold"
              value={refinement.threshold}
              min={0}
              max={1}
              step={0.01}
              disabled={!state.result}
              onChange={(threshold) => {
                setRefinement((prev) => ({ ...prev, threshold }));
              }}
              hint="Raise to trim a halo, lower to keep more of the edge."
            />

            <RangeField
              label="Hardness"
              value={refinement.hardness}
              min={0}
              max={1}
              step={0.01}
              disabled={!state.result}
              onChange={(hardness) => {
                setRefinement((prev) => ({ ...prev, hardness }));
              }}
              hint="0 keeps the soft ramp; 1 cuts hard at the threshold."
            />

            <RangeField
              label="Feather"
              value={refinement.feather}
              min={0}
              max={8}
              step={1}
              disabled={!state.result}
              format={(v) => (v === 0 ? 'off' : `${String(v)} px`)}
              onChange={(feather) => {
                setRefinement((prev) => ({ ...prev, feather }));
              }}
              hint="Softens the cutout edge."
            />
          </fieldset>

          {view === 'brush' && state.result && (
            <fieldset className="flex flex-col gap-3 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">Brush</legend>

              <div role="group" aria-label="Brush mode" className="flex gap-2">
                {(['add', 'erase'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={brushMode === mode}
                    onClick={() => {
                      setBrushMode(mode);
                    }}
                    className="flex-1 rounded-md border border-border-subtle px-2 py-1.5 text-sm transition-colors hover:bg-surface-raised aria-pressed:border-accent aria-pressed:bg-surface-raised"
                  >
                    {mode === 'add' ? 'Add subject' : 'Remove'}
                  </button>
                ))}
              </div>

              <RangeField
                label="Brush size"
                value={brushRadius}
                min={4}
                max={160}
                step={2}
                format={(v) => `${String(v)} px`}
                onChange={setBrushRadius}
              />

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={smartSelect}
                  onChange={(event) => {
                    setSmartSelect(event.target.checked);
                  }}
                  className="mt-0.5 size-4 accent-accent"
                />
                <span>
                  Smart select
                  <span className="block text-xs text-ink-muted">
                    Click an object and SlimSAM selects all of it. Downloads 17.5 MB the
                    first time.
                  </span>
                </span>
              </label>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || state.strokeCount === 0}
                  onClick={() => {
                    void undoStroke(refinement);
                  }}
                  className="flex-1 rounded-md border border-border-subtle px-2 py-1.5 text-sm enabled:hover:bg-surface-raised disabled:opacity-40"
                >
                  Undo
                </button>
                <button
                  type="button"
                  disabled={busy || state.strokeCount === 0}
                  onClick={() => {
                    void clearEdits(refinement);
                  }}
                  className="flex-1 rounded-md border border-border-subtle px-2 py-1.5 text-sm enabled:hover:bg-surface-raised disabled:opacity-40"
                >
                  Clear edits
                </button>
              </div>
            </fieldset>
          )}

          <BackgroundPicker value={background} onChange={setBackground} />

          <div className="flex flex-col gap-2">
            <a
              href={state.outputUrl ?? '#'}
              download="cutout.png"
              aria-disabled={state.outputUrl ? undefined : 'true'}
              onClick={(event) => {
                if (!state.outputUrl) event.preventDefault();
              }}
              className="rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 aria-disabled:pointer-events-none aria-disabled:opacity-40"
            >
              Download PNG
            </a>

            {file && (
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setRefinement(DEFAULT_REFINEMENT);
                  setView('compare');
                  setSmartSelect(false);
                  reset();
                }}
                className="rounded-md border border-border-subtle px-3 py-2 text-sm transition-colors hover:bg-surface-raised"
              >
                Start over
              </button>
            )}
          </div>

          {state.session && <BackendBadge session={state.session} />}

          <p className="text-xs text-ink-muted">
            {model.label} · {formatBytes(model.downloadBytes)} ·{' '}
            <a
              href={model.licence.url}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-ink"
            >
              {model.licence.name}
            </a>
          </p>
        </aside>
      </div>
    </div>
  );
}
