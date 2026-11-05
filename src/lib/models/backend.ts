import * as ort from 'onnxruntime-web/webgpu';
import type { Backend } from './registry.ts';

/**
 * Picked up by the UI so the user can see what is actually running, rather
 * than what we hoped would run.
 */
export interface BackendReport {
  readonly backend: Backend;
  readonly webgpu: WebGpuProbe;
  /** WASM threads in use. 1 means the page is not cross-origin isolated. */
  readonly wasmThreads: number;
  readonly crossOriginIsolated: boolean;
}

export type WebGpuProbe =
  | { readonly available: true; readonly limits: AdapterLimits }
  | { readonly available: false; readonly reason: string };

export interface AdapterLimits {
  readonly maxStorageBufferBindingSize: number;
  readonly maxBufferSize: number;
  readonly maxComputeWorkgroupStorageSize: number;
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

  return { available: true, limits };
}

/**
 * Decides which execution provider to use, honouring the model's own list of
 * supported backends and an optional user override.
 */
export async function selectBackend(
  supported: readonly Backend[],
  preference?: Backend,
): Promise<BackendReport> {
  configureRuntime();

  const webgpu = supported.includes('webgpu')
    ? await probeWebGpu()
    : ({ available: false, reason: 'This model is not run on WebGPU.' } as const);

  const wantsWasm = preference === 'wasm' || !webgpu.available;
  const backend: Backend = wantsWasm && supported.includes('wasm') ? 'wasm' : 'webgpu';

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
