import { useId } from 'react';

/**
 * What sits behind a cutout in the preview. `null` means the transparency
 * checkerboard; anything else is a CSS colour.
 */
export type PreviewBackground = string | null;

export interface BackgroundPickerProps {
  readonly value: PreviewBackground;
  readonly onChange: (value: PreviewBackground) => void;
}

const PRESETS: readonly { readonly label: string; readonly value: PreviewBackground }[] =
  [
    { label: 'Transparent', value: null },
    { label: 'White', value: '#ffffff' },
    { label: 'Light grey', value: '#d4d4d8' },
    { label: 'Dark grey', value: '#3f3f46' },
    { label: 'Black', value: '#000000' },
  ];

/**
 * A cutout looks very different on white than on black — haloes and leftover
 * fringing only show up against some backgrounds. This previews the result
 * against a few; the exported PNG stays transparent either way.
 */
export function BackgroundPicker({ value, onChange }: BackgroundPickerProps) {
  const customId = useId();
  const isPreset = PRESETS.some((preset) => preset.value === value);

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium" id={`${customId}-label`}>
        Preview background
      </p>

      <div
        role="radiogroup"
        aria-labelledby={`${customId}-label`}
        className="flex flex-wrap items-center gap-1.5"
      >
        {PRESETS.map((preset) => {
          const selected = preset.value === value;
          return (
            <button
              key={preset.label}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={preset.label}
              title={preset.label}
              onClick={() => {
                onChange(preset.value);
              }}
              style={preset.value ? { backgroundColor: preset.value } : undefined}
              className={`size-7 rounded border transition-[outline] ${
                preset.value === null ? 'alpha-grid' : ''
              } ${
                selected
                  ? 'border-accent outline-2 outline-offset-1 outline-accent'
                  : 'border-border-subtle'
              }`}
            />
          );
        })}

        <label
          className={`flex size-7 cursor-pointer items-center justify-center rounded border ${
            isPreset
              ? 'border-border-subtle'
              : 'border-accent outline-2 outline-offset-1 outline-accent'
          }`}
          title="Custom colour"
          style={!isPreset && value ? { backgroundColor: value } : undefined}
        >
          <span className="sr-only">Custom background colour</span>
          <input
            type="color"
            value={value ?? '#3b82f6'}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            className="size-0 opacity-0"
          />
          {isPreset && (
            <span aria-hidden="true" className="text-xs text-ink-muted">
              +
            </span>
          )}
        </label>
      </div>
    </div>
  );
}
