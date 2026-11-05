import { formatBytes, formatPercent } from '../lib/format.ts';

export interface ProgressBarProps {
  readonly label: string;
  readonly loaded: number;
  readonly total: number;
  /** Render without a percentage when the total is not yet known. */
  readonly indeterminate?: boolean;
}

export function ProgressBar({
  label,
  loaded,
  total,
  indeterminate = false,
}: ProgressBarProps) {
  const percent = formatPercent(loaded, total);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="font-mono text-xs text-ink-muted">
          {indeterminate
            ? formatBytes(loaded)
            : `${formatBytes(loaded)} / ${formatBytes(total)}`}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label={label}
        {...(indeterminate
          ? {}
          : { 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100 })}
        className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-150"
          style={{ width: indeterminate ? '100%' : `${String(percent)}%` }}
        />
      </div>
    </div>
  );
}
