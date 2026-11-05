import { useRef } from 'react';
import type { ClickPoint } from '../../lib/image/sam.ts';

export interface SelectionCanvasProps {
  readonly imageUrl: string;
  readonly width: number;
  readonly height: number;
  readonly points: readonly ClickPoint[];
  readonly onAddPoint: (point: ClickPoint) => void;
  readonly disabled: boolean;
}

/**
 * The image, with click-to-select points drawn over it.
 *
 * A left click (or Enter/Space) adds a positive point; alt-click or right
 * click adds a negative one, which is how SAM is normally driven. Keyboard
 * users get the same two actions through the buttons beneath.
 */
export function SelectionCanvas({
  imageUrl,
  width,
  height,
  points,
  onAddPoint,
  disabled,
}: SelectionCanvasProps) {
  const ref = useRef<HTMLDivElement>(null);

  const addFromEvent = (clientX: number, clientY: number, positive: boolean) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;

    // Translate from displayed pixels back to the image's own coordinates.
    const x = ((clientX - box.left) / box.width) * width;
    const y = ((clientY - box.top) / box.height) * height;
    if (x < 0 || y < 0 || x > width || y > height) return;

    onAddPoint({ x, y, positive });
  };

  return (
    <div
      ref={ref}
      className="alpha-grid relative overflow-hidden rounded-lg border border-border-subtle"
      style={{ aspectRatio: `${width} / ${height}` }}
      onContextMenu={(event) => {
        if (disabled) return;
        event.preventDefault();
        addFromEvent(event.clientX, event.clientY, false);
      }}
    >
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        className="pointer-events-none h-full w-full object-contain select-none"
      />

      <button
        type="button"
        disabled={disabled}
        aria-label="Select an object: click to add a point, alt-click to exclude one"
        onClick={(event) => {
          addFromEvent(event.clientX, event.clientY, !event.altKey);
        }}
        className="absolute inset-0 h-full w-full cursor-crosshair disabled:cursor-wait"
      />

      {points.map((point, i) => (
        <span
          key={`${String(point.x)}-${String(point.y)}-${String(i)}`}
          aria-hidden="true"
          className={`pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${
            point.positive ? 'bg-emerald-400' : 'bg-red-400'
          }`}
          style={{
            left: `${String((point.x / width) * 100)}%`,
            top: `${String((point.y / height) * 100)}%`,
          }}
        />
      ))}
    </div>
  );
}
