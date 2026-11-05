/**
 * Vectoriser settings, kept apart from the wasm bindings so the UI and the
 * tests can use them without pulling in a 170 KB wasm module.
 */
export interface VectorizeOptions {
  /** Colours to quantise to before tracing. */
  readonly colors: number;
  /** Median cut alone, or median cut refined by k-means. */
  readonly method: 'median-cut' | 'k-means';
  /** Drop shapes smaller than this many pixels. */
  readonly filterSpeckle: number;
  /** Fit smooth curves rather than emitting straight polygons. */
  readonly smooth: boolean;
  /** Corner angle threshold in degrees; higher rounds off more corners. */
  readonly cornerThreshold: number;
  /** Decimal places kept in path coordinates. */
  readonly pathPrecision: number;
}

export const DEFAULT_VECTORIZE_OPTIONS: VectorizeOptions = {
  colors: 8,
  method: 'k-means',
  filterSpeckle: 4,
  smooth: true,
  cornerThreshold: 60,
  pathPrecision: 2,
};

/** Largest edge fed to the tracer; bigger inputs are scaled down first. */
export const MAX_TRACE_EDGE = 1600;

export interface VectorizeResult {
  readonly svg: string;
  /** Hex colours the image was reduced to, for the palette strip. */
  readonly palette: readonly string[];
  readonly pathCount: number;
  readonly svgBytes: number;
  readonly traceMs: number;
  readonly width: number;
  readonly height: number;
}

export function toHex([r, g, b]: readonly [number, number, number]): string {
  const part = (n: number) => n.toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}
