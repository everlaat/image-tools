/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import init, { trace, TraceOptions } from '@vtracer';
import { decodeToRgba, fitWithin, resampleRgba } from '../lib/image/canvas.ts';
import { quantise, type Rgb } from '../lib/color/quantise.ts';
import {
  MAX_TRACE_EDGE,
  toHex,
  type VectorizeOptions,
  type VectorizeResult,
} from '../lib/vector/options.ts';

/**
 * Quantise-then-trace, off the UI thread.
 *
 * Tracing is vtracer compiled from source (MIT). The quantisation step is
 * ours rather than vtracer's own `color_precision`, because the brief wants
 * an exact colour count the user picks, not an approximate precision knob.
 */
class VectorizeWorker {
  private ready: Promise<void> | null = null;
  /** Kept so re-tracing with new settings does not re-decode the file. */
  private source: Awaited<ReturnType<typeof decodeToRgba>>['image'] | null = null;

  private load(): Promise<void> {
    // The wasm is only fetched the first time this tool is actually used.
    const existing = this.ready;
    if (existing) return existing;

    const started = init().then(() => undefined);
    this.ready = started;
    return started;
  }

  async setImage(file: Blob): Promise<{ width: number; height: number }> {
    const decoded = await decodeToRgba(file);
    // Tracing cost scales with area, and a logo gains nothing above this.
    const target = fitWithin(decoded.image, MAX_TRACE_EDGE);
    this.source = await resampleRgba(decoded.image, target.width, target.height);
    return { width: this.source.width, height: this.source.height };
  }

  async vectorize(options: VectorizeOptions): Promise<VectorizeResult> {
    const source = this.source;
    if (!source) throw new Error('Load an image before vectorising');

    await this.load();

    const { image, palette } = quantise(source, {
      colors: options.colors,
      method: options.method,
    });

    const traceOptions = new TraceOptions();
    traceOptions.filter_speckle = options.filterSpeckle;
    traceOptions.spline = options.smooth;
    traceOptions.corner_threshold = options.cornerThreshold;
    traceOptions.path_precision = options.pathPrecision;
    // Colours are already reduced to exactly what the user asked for, so the
    // tracer's own quantisation is turned up to its most faithful setting
    // rather than quantising a second time.
    traceOptions.color_precision = 8;

    // A view over the same buffer, not a copy: this is several megabytes.
    const bytes = new Uint8Array(
      image.data.buffer,
      image.data.byteOffset,
      image.data.byteLength,
    );

    const started = performance.now();
    let svg: string;
    try {
      svg = trace(bytes, image.width, image.height, traceOptions);
    } finally {
      traceOptions.free();
    }
    const traceMs = performance.now() - started;

    return {
      svg,
      palette: palette.map((c: Rgb) => toHex(c)),
      pathCount: (svg.match(/<path/g) ?? []).length,
      svgBytes: new Blob([svg]).size,
      traceMs,
      width: image.width,
      height: image.height,
    };
  }

  dispose(): void {
    this.source = null;
  }
}

export type VectorizeWorkerApi = VectorizeWorker;

Comlink.expose(new VectorizeWorker());
