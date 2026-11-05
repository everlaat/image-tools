import { useId, useState } from 'react';

import type { PreviewBackground } from './BackgroundPicker.tsx';

export interface CompareSliderProps {
  readonly beforeUrl: string;
  readonly afterUrl: string;
  readonly beforeLabel?: string;
  readonly afterLabel?: string;
  readonly width: number;
  readonly height: number;
  /** What shows through the cutout: null is the checkerboard. */
  readonly background?: PreviewBackground;
}

/**
 * Before/after wipe.
 *
 * The handle is a real range input rather than a mouse-only drag target: that
 * gives keyboard operation, a sensible accessible name and value announcements
 * without reimplementing any of it.
 */
export function CompareSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = 'Original',
  afterLabel = 'Result',
  width,
  height,
  background = null,
}: CompareSliderProps) {
  const [position, setPosition] = useState(50);
  const labelId = useId();

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div
        className={`relative overflow-hidden rounded-lg border border-border-subtle ${
          background === null ? 'alpha-grid' : ''
        }`}
        style={{
          aspectRatio: `${width} / ${height}`,
          ...(background === null ? {} : { backgroundColor: background }),
        }}
      >
        <img
          src={afterUrl}
          alt={`${afterLabel}: background removed`}
          className="absolute inset-0 h-full w-full object-contain"
        />

        {/* The original is revealed from the left, up to the handle. */}
        <div
          className="absolute inset-0 overflow-hidden bg-surface-sunken"
          style={{ clipPath: `inset(0 ${String(100 - position)}% 0 0)` }}
        >
          <img
            src={beforeUrl}
            alt={`${beforeLabel}: unmodified input`}
            className="absolute inset-0 h-full w-full object-contain"
          />
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent"
          style={{ left: `${String(position)}%` }}
        />

        <input
          id={labelId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={position}
          aria-label={`Reveal ${beforeLabel} over ${afterLabel}`}
          onChange={(event) => {
            setPosition(event.target.valueAsNumber);
          }}
          className="absolute inset-0 h-full w-full cursor-ew-resize appearance-none bg-transparent focus-visible:outline-offset-4"
        />
      </div>

      <figcaption className="flex justify-between text-xs text-ink-muted">
        <span>{beforeLabel}</span>
        <span>{afterLabel}</span>
      </figcaption>
    </figure>
  );
}
