import { useEffect, useMemo, useRef, useState } from 'react';
import { Dropzone } from '../../components/Dropzone.tsx';
import { RangeField } from '../../components/RangeField.tsx';
import { useVectorize } from './useVectorize.ts';
import {
  DEFAULT_VECTORIZE_OPTIONS,
  type VectorizeOptions,
} from '../../lib/vector/options.ts';
import { formatBytes } from '../../lib/format.ts';

const RETRACE_DELAY_MS = 220;

export function Vectorize() {
  const [options, setOptions] = useState<VectorizeOptions>(DEFAULT_VECTORIZE_OPTIONS);
  const [file, setFile] = useState<File | null>(null);
  const { state, load, run, reset } = useVectorize();

  const settled = useRef(options);

  // Re-trace as settings change, debounced so dragging a slider does not
  // queue a trace per frame.
  useEffect(() => {
    if (!file || state.status === 'idle' || state.status === 'loading') return;
    if (settled.current === options) return;

    const timer = setTimeout(() => {
      settled.current = options;
      void run(options);
    }, RETRACE_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [options, run, file, state.status]);

  const svgUrl = useMemo(() => {
    if (!state.result) return null;
    return URL.createObjectURL(new Blob([state.result.svg], { type: 'image/svg+xml' }));
  }, [state.result]);

  useEffect(
    () => () => {
      if (svgUrl) URL.revokeObjectURL(svgUrl);
    },
    [svgUrl],
  );

  const inputUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (inputUrl) URL.revokeObjectURL(inputUrl);
    },
    [inputUrl],
  );

  const start = (next: File) => {
    setFile(next);
    settled.current = options;
    void load(next, options);
  };

  const busy = state.status === 'loading' || state.status === 'tracing';

  return (
    <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
      <section className="flex flex-col gap-3" aria-label="Artwork">
        {!file && <Dropzone onFile={start} disabled={busy} />}

        {file && (
          <div className="grid gap-3 sm:grid-cols-2">
            <figure className="m-0 flex flex-col gap-1.5">
              <figcaption className="text-xs text-ink-muted">Original</figcaption>
              <div className="alpha-grid overflow-hidden rounded-lg border border-border-subtle">
                {inputUrl && (
                  <img
                    src={inputUrl}
                    alt="The raster image you provided"
                    className="h-full w-full object-contain"
                  />
                )}
              </div>
            </figure>

            <figure className="m-0 flex flex-col gap-1.5">
              <figcaption className="text-xs text-ink-muted">
                Traced SVG{state.status === 'tracing' && ' — updating…'}
              </figcaption>
              <div className="alpha-grid overflow-hidden rounded-lg border border-border-subtle">
                {svgUrl && (
                  <img
                    src={svgUrl}
                    alt="Live preview of the traced vector result"
                    className="h-full w-full object-contain"
                  />
                )}
              </div>
            </figure>
          </div>
        )}

        {state.error && (
          <p role="alert" className="text-sm text-red-400">
            {state.error}
          </p>
        )}

        {state.result && (
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
            <div className="flex gap-1.5">
              <dt>Paths</dt>
              <dd className="font-mono text-ink">{state.result.pathCount}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Size</dt>
              <dd className="font-mono text-ink">{formatBytes(state.result.svgBytes)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Traced in</dt>
              <dd className="font-mono text-ink">
                {Math.round(state.result.traceMs)} ms
              </dd>
            </div>
          </dl>
        )}
      </section>

      <aside className="flex flex-col gap-5" aria-label="Vector settings">
        <RangeField
          label="Colours"
          value={options.colors}
          min={2}
          max={24}
          step={1}
          disabled={!file}
          format={(v) => String(v)}
          onChange={(colors) => {
            setOptions((prev) => ({ ...prev, colors }));
          }}
          hint="How many flat colours the artwork is reduced to before tracing."
        />

        <RangeField
          label="Remove speckles"
          value={options.filterSpeckle}
          min={0}
          max={32}
          step={1}
          disabled={!file}
          format={(v) => (v === 0 ? 'off' : `${String(v)} px`)}
          onChange={(filterSpeckle) => {
            setOptions((prev) => ({ ...prev, filterSpeckle }));
          }}
          hint="Discards shapes smaller than this, which clears up stray dots."
        />

        <RangeField
          label="Corner threshold"
          value={options.cornerThreshold}
          min={0}
          max={120}
          step={1}
          disabled={!file || !options.smooth}
          format={(v) => `${String(v)}°`}
          onChange={(cornerThreshold) => {
            setOptions((prev) => ({ ...prev, cornerThreshold }));
          }}
          hint="Higher rounds off more corners; lower keeps them sharp."
        />

        <RangeField
          label="Coordinate precision"
          value={options.pathPrecision}
          min={0}
          max={5}
          step={1}
          disabled={!file}
          format={(v) => `${String(v)} dp`}
          onChange={(pathPrecision) => {
            setOptions((prev) => ({ ...prev, pathPrecision }));
          }}
          hint="Fewer decimals make a smaller file."
        />

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.smooth}
              disabled={!file}
              onChange={(event) => {
                setOptions((prev) => ({ ...prev, smooth: event.target.checked }));
              }}
              className="size-4 accent-accent"
            />
            Smooth curves
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.method === 'k-means'}
              disabled={!file}
              onChange={(event) => {
                setOptions((prev) => ({
                  ...prev,
                  method: event.target.checked ? 'k-means' : 'median-cut',
                }));
              }}
              className="size-4 accent-accent"
            />
            Refine palette (k-means)
          </label>
        </div>

        {state.result && state.result.palette.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium" id="palette-heading">
              Palette
            </p>
            <ul aria-labelledby="palette-heading" className="flex flex-wrap gap-1">
              {state.result.palette.map((color) => (
                <li
                  key={color}
                  title={color}
                  className="size-5 rounded border border-border-subtle"
                  style={{ backgroundColor: color }}
                >
                  <span className="sr-only">{color}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <a
            href={svgUrl ?? '#'}
            download="traced.svg"
            aria-disabled={svgUrl ? undefined : 'true'}
            onClick={(event) => {
              if (!svgUrl) event.preventDefault();
            }}
            className="rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 aria-disabled:pointer-events-none aria-disabled:opacity-40"
          >
            Download SVG
          </a>

          {file && (
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setOptions(DEFAULT_VECTORIZE_OPTIONS);
                reset();
              }}
              className="rounded-md border border-border-subtle px-3 py-2 text-sm transition-colors hover:bg-surface-raised"
            >
              Start over
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
