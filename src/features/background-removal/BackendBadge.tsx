import type { SessionInfo } from '../../lib/models/session.ts';

export interface BackendBadgeProps {
  readonly session: SessionInfo;
}

/**
 * Says which backend is actually in use, and why WebGPU was skipped when it
 * was. Guessing from the spec is not good enough: adapters get blocklisted and
 * cross-origin isolation gets lost behind proxies.
 */
export function BackendBadge({ session }: BackendBadgeProps) {
  const { backend, webgpu, wasmThreads, crossOriginIsolated, fallbackReason } =
    session.backend;
  const onGpu = backend === 'webgpu';

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-sunken p-2.5">
      <p className="flex items-center gap-1.5 text-xs">
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${onGpu ? 'bg-emerald-400' : 'bg-amber-400'}`}
        />
        <span className="font-medium">
          {onGpu
            ? 'Running on WebGPU'
            : `Running on WASM (${wasmThreads} thread${wasmThreads === 1 ? '' : 's'})`}
        </span>
      </p>

      {fallbackReason !== undefined && (
        <p className="text-xs text-ink-muted">
          {fallbackReason} Switched to the CPU so it still works, which is slower.
        </p>
      )}

      {!onGpu && fallbackReason === undefined && !webgpu.available && (
        <p className="text-xs text-ink-muted">{webgpu.reason}</p>
      )}

      {!onGpu && !crossOriginIsolated && (
        <p className="text-xs text-ink-muted">
          The page is not cross-origin isolated, so WASM is limited to one thread.
        </p>
      )}
    </div>
  );
}
