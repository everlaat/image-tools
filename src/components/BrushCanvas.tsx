import { useRef, useState } from 'react';
import type { BrushMode, BrushPoint, BrushStroke } from '../lib/image/brush.ts';
import type { PreviewBackground } from './BackgroundPicker.tsx';

export interface BrushCanvasProps {
  readonly imageUrl: string;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly hardness: number;
  readonly mode: BrushMode;
  /** When true a click sends a single point instead of painting a stroke. */
  readonly smartSelect: boolean;
  readonly background: PreviewBackground;
  readonly disabled: boolean;
  readonly onStroke: (stroke: BrushStroke) => void;
  readonly onPick: (point: BrushPoint) => void;
}

/**
 * The cutout with a paint surface over it.
 *
 * The stroke in progress is drawn locally on a canvas so the line follows the
 * pointer immediately; only on release is it handed to the worker, which owns
 * the authoritative mask. Round-tripping every pointermove would lag badly on
 * a large image.
 */
export function BrushCanvas({
  imageUrl,
  width,
  height,
  radius,
  hardness,
  mode,
  smartSelect,
  background,
  disabled,
  onStroke,
  onPick,
}: BrushCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<BrushPoint[]>([]);
  const [painting, setPainting] = useState(false);
  const [cursor, setCursor] = useState<BrushPoint | null>(null);

  /** Pointer position in the source image's own pixel coordinates. */
  const toImage = (clientX: number, clientY: number): BrushPoint | null => {
    const box = surfaceRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return {
      x: ((clientX - box.left) / box.width) * width,
      y: ((clientY - box.top) / box.height) * height,
    };
  };

  const drawPreview = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const points = pointsRef.current;
    if (points.length === 0) return;

    ctx.strokeStyle =
      mode === 'add' ? 'rgba(52, 211, 153, 0.55)' : 'rgba(248, 113, 113, 0.55)';
    ctx.lineWidth = radius * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  };

  const finish = () => {
    const points = pointsRef.current;
    pointsRef.current = [];
    setPainting(false);
    drawPreview();
    if (points.length > 0) onStroke({ points, radius, hardness, mode });
  };

  // The ring is sized and placed in percentages of the container, which has
  // the image's aspect ratio, so it tracks the displayed size without having
  // to measure the element during render.
  const ringSize = `${String(((radius * 2) / width) * 100)}%`;

  return (
    <div
      ref={surfaceRef}
      className={`relative touch-none overflow-hidden rounded-lg border border-border-subtle ${
        background === null ? 'alpha-grid' : ''
      }`}
      style={{
        aspectRatio: `${width} / ${height}`,
        ...(background === null ? {} : { backgroundColor: background }),
        cursor: disabled ? 'wait' : 'none',
      }}
      onPointerDown={(event) => {
        if (disabled) return;
        const point = toImage(event.clientX, event.clientY);
        if (!point) return;

        if (smartSelect) {
          onPick(point);
          return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        pointsRef.current = [point];
        setPainting(true);
        drawPreview();
      }}
      onPointerMove={(event) => {
        const point = toImage(event.clientX, event.clientY);
        setCursor(point);
        if (disabled || !painting || !point) return;
        pointsRef.current.push(point);
        drawPreview();
      }}
      onPointerUp={() => {
        if (painting) finish();
      }}
      onPointerLeave={() => {
        setCursor(null);
        if (painting) finish();
      }}
    >
      <img
        src={imageUrl}
        alt="Cutout being corrected"
        className="h-full w-full object-contain"
      />

      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {cursor && !disabled && !smartSelect && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute rounded-full border-2 ${
            mode === 'add' ? 'border-emerald-400' : 'border-red-400'
          }`}
          style={{
            width: ringSize,
            aspectRatio: '1',
            left: `${String((cursor.x / width) * 100)}%`,
            top: `${String((cursor.y / height) * 100)}%`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}
    </div>
  );
}
