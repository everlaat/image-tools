import * as ort from 'onnxruntime-web/webgpu';
import type { Backend } from './registry.ts';

/**
 * Picked up by the UI so the user can see what is actually running, rather
 * than what we hoped would run.
 */
export interface BackendReport {
  readonly backend: Backend;
  /**
   * Set when WebGPU was chosen, failed during inference and the work was
   * moved to WASM. The UI says so rather than silently running slower.
   */
  readonly fallbackReason?: string;
  readonly webgpu: WebGpuProbe;
  /** WASM threads in use. 1 means the page is not cross-origin isolated. */
  readonly wasmThreads: number;
  readonly crossOriginIsolated: boolean;
}

export type WebGpuProbe =
  | {
      readonly available: true;
      readonly limits: AdapterLimits;
      readonly features: ReadonlySet<string>;
    }
  | { readonly available: false; readonly reason: string };

export interface AdapterLimits {
  readonly maxStorageBufferBindingSize: number;
  readonly maxBufferSize: number;
  readonly maxComputeWorkgroupStorageSize: number;
  /**
   * How many storage buffers one shader stage may bind. Distinct from the
   * size limit above, and the one that actually bites: a graph needing 11 on
   * a device allowing 10 builds a session fine and then fails inside
   * OrtRun. There is no way to know a model's requirement up front, so this
   * is reported for diagnosis while the real safety net is the runtime
   * fallback in MattingSession.
   */
  readonly maxStorageBuffersPerShaderStage: number;
}

/**
 * Largest intermediate buffer we expect a matting graph to allocate. BiRefNet
 * at 1024x1024 has been reported to exceed smaller adapter limits and fall
 * back; checking up front means we can say so instead of failing mid-run.
 */
const MIN_USEFUL_STORAGE_BUFFER = 128 * 1024 * 1024;

let configured = false;

/**
 * Points onnxruntime-web at the locally served WASM binary and sizes its
 * thread pool. Safe to call repeatedly; only the first call has any effect.
 */
export function configureRuntime(): void {
  if (configured) return;
  configured = true;

  // wasmPaths is deliberately left alone. onnxruntime-web/webgpu references its
  // .wasm via `new URL(..., import.meta.url)`, which the bundler rewrites to a
  // content-hashed asset on our own origin. Setting wasmPaths here would
  // override that with a path we would then have to maintain by hand.
  ort.env.wasm.numThreads = resolveThreadCount();
  // Warnings only: ORT is extremely chatty at the default level.
  ort.env.logLevel = 'warning';
}

function resolveThreadCount(): number {
  // SharedArrayBuffer-backed threads need cross-origin isolation. Without it
  // ORT throws on worker spawn, so ask for a single thread instead.
  if (!self.crossOriginIsolated) return 1;
  const cores = self.navigator.hardwareConcurrency;
  if (!cores || Number.isNaN(cores)) return 1;
  // More than four threads buys very little here and hurts on small devices.
  return Math.max(1, Math.min(4, cores - 1));
}

export async function probeWebGpu(): Promise<WebGpuProbe> {
  // Typed as non-optional in lib.dom, but genuinely absent in Firefox and
  // older Safari, so read it through a shape that admits that.
  const gpu: GPU | undefined = (self.navigator as { gpu?: GPU }).gpu;
  if (!gpu) {
    return {
      available: false,
      reason: 'This browser does not expose WebGPU.',
    };
  }

  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (cause) {
    return {
      available: false,
      reason: `Requesting a WebGPU adapter failed: ${describe(cause)}`,
    };
  }

  if (!adapter) {
    return {
      available: false,
      reason: 'No WebGPU adapter is available — the GPU may be blocklisted.',
    };
  }

  const limits: AdapterLimits = {
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
    maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
    maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
  };

  if (limits.maxStorageBufferBindingSize < MIN_USEFUL_STORAGE_BUFFER) {
    return {
      available: false,
      reason:
        `The GPU allows only ${formatMiB(limits.maxStorageBufferBindingSize)} per ` +
        `storage buffer, below the ${formatMiB(MIN_USEFUL_STORAGE_BUFFER)} these ` +
        'models need.',
    };
  }

  return { available: true, limits, features: new Set(adapter.features) };
}

/**
 * Decides which execution provider to use.
 *
 * Throws rather than guessing when a model cannot run anywhere available: a
 * clear sentence here is far better than the error ONNX Runtime produces deep
 * in the shader compiler or allocator several seconds later.
 */
export async function selectBackend(
  supported: readonly Backend[],
  requiredGpuFeatures: readonly string[] = [],
  preference?: Backend,
): Promise<BackendReport> {
  configureRuntime();

  // Held in a const so the narrowing survives into the closure below.
  const probed: WebGpuProbe = supported.includes('webgpu')
    ? await probeWebGpu()
    : { available: false, reason: 'This model does not run on WebGPU.' };

  const missing = probed.available
    ? requiredGpuFeatures.filter((feature) => !probed.features.has(feature))
    : [];

  const webgpu: WebGpuProbe =
    probed.available && missing.length > 0
      ? {
          available: false,
          reason:
            `This GPU is missing ${missing.join(', ')}, which this model's ` +
            'half-precision weights require.',
        }
      : probed;

  const canUseWasm = supported.includes('wasm');
  const preferWasm = preference === 'wasm';

  let backend: Backend;
  if (preferWasm && canUseWasm) {
    backend = 'wasm';
  } else if (webgpu.available) {
    backend = 'webgpu';
  } else if (canUseWasm) {
    backend = 'wasm';
  } else {
    // Narrowed: every branch above failed, so webgpu is the unavailable shape.
    throw new Error(
      `This model needs WebGPU and it is not usable here. ${webgpu.reason}`,
    );
  }

  return {
    backend,
    webgpu,
    wasmThreads: ort.env.wasm.numThreads ?? 1,
    crossOriginIsolated: self.crossOriginIsolated,
  };
}

/** Execution provider list for an ORT session, most preferred first. */
export function executionProviders(backend: Backend): readonly string[] {
  return backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
}

function formatMiB(bytes: number): string {
  return `${Math.round(bytes / 1048576)} MiB`;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
