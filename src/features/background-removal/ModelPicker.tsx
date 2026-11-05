import { useId } from 'react';
import { MATTING_MODELS, type MattingModelId } from '../../lib/models/registry.ts';
import { formatBytes } from '../../lib/format.ts';

export interface ModelPickerProps {
  readonly value: MattingModelId;
  readonly onChange: (value: MattingModelId) => void;
  readonly disabled?: boolean;
}

export function ModelPicker({ value, onChange, disabled = false }: ModelPickerProps) {
  const id = useId();
  const selected = MATTING_MODELS.find((m) => m.id === value);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Model
      </label>

      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value as MattingModelId);
        }}
        className="rounded-md border border-border-subtle bg-surface-sunken px-2 py-1.5 text-sm disabled:opacity-50"
      >
        {MATTING_MODELS.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label} — {formatBytes(model.downloadBytes)}
          </option>
        ))}
      </select>

      {selected && (
        <p className="text-xs text-ink-muted">
          {selected.summary}
          {selected.caveat && (
            <>
              {' '}
              <span className="text-amber-400">{selected.caveat}</span>
            </>
          )}
          {!selected.licence.allowsCommercialUse && (
            <>
              {' '}
              <span className="text-amber-400">
                Licensed for non-commercial use only.
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
