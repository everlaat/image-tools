import type { Layer } from './useLayers.ts';

export interface LayerPanelProps {
  readonly layers: readonly Layer[];
  readonly onToggle: (id: string) => void;
  readonly onMove: (id: string, direction: -1 | 1) => void;
  readonly onRemove: (id: string) => void;
  readonly onExport: (id: string) => void;
  readonly busy: boolean;
}

/**
 * Reordering is buttons rather than drag-and-drop: drag needs a keyboard
 * equivalent anyway, and a pair of labelled buttons is that equivalent
 * without a second interaction model to maintain.
 */
export function LayerPanel({
  layers,
  onToggle,
  onMove,
  onRemove,
  onExport,
  busy,
}: LayerPanelProps) {
  if (layers.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No layers yet. Click the image to select something, or suggest layers from depth.
      </p>
    );
  }

  return (
    <ol aria-label="Layers" className="flex flex-col gap-2">
      {layers.map((layer, index) => (
        <li
          key={layer.id}
          className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-sunken p-2"
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={() => {
                onToggle(layer.id);
              }}
              className="size-4 accent-accent"
            />
            <span className="sr-only">Show {layer.name}</span>
          </label>

          {layer.thumbnailUrl ? (
            <img
              src={layer.thumbnailUrl}
              alt=""
              className="alpha-grid size-10 rounded border border-border-subtle object-contain"
            />
          ) : (
            <div className="size-10 rounded border border-border-subtle" />
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{layer.name}</p>
            <p className="text-xs text-ink-muted">
              {(layer.coverage * 100).toFixed(1)}% of the image
            </p>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={index === 0 || busy}
              onClick={() => {
                onMove(layer.id, -1);
              }}
              aria-label={`Move ${layer.name} up`}
              className="rounded border border-border-subtle px-1.5 py-0.5 text-xs enabled:hover:bg-surface-raised disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === layers.length - 1 || busy}
              onClick={() => {
                onMove(layer.id, 1);
              }}
              aria-label={`Move ${layer.name} down`}
              className="rounded border border-border-subtle px-1.5 py-0.5 text-xs enabled:hover:bg-surface-raised disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onExport(layer.id);
              }}
              aria-label={`Export ${layer.name} as PNG`}
              className="rounded border border-border-subtle px-1.5 py-0.5 text-xs enabled:hover:bg-surface-raised disabled:opacity-30"
            >
              PNG
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onRemove(layer.id);
              }}
              aria-label={`Remove ${layer.name}`}
              className="rounded border border-border-subtle px-1.5 py-0.5 text-xs enabled:hover:bg-surface-raised disabled:opacity-30"
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}
