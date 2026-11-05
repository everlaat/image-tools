import { useCallback, useEffect, useState } from 'react';
import { clearModelCache, modelCacheUsage, type CacheUsage } from '../lib/models/cache.ts';
import { formatBytes } from '../lib/format.ts';

/**
 * Model weights are large and cached indefinitely, so there has to be a way to
 * get the space back. Runs on the main thread: it is only Cache API bookkeeping.
 */
export function ModelCacheSettings() {
  const [usage, setUsage] = useState<CacheUsage | null>(null);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(() => {
    void modelCacheUsage().then(setUsage);
  }, []);

  useEffect(refresh, [refresh]);

  const clear = () => {
    setClearing(true);
    void clearModelCache()
      .then(refresh)
      .finally(() => {
        setClearing(false);
      });
  };

  if (!usage?.available) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
      <span>
        Cached models: {usage.entries === 0 ? 'none' : formatBytes(usage.bytes)}
      </span>

      <button
        type="button"
        onClick={clear}
        disabled={clearing || usage.entries === 0}
        className="rounded border border-border-subtle px-2 py-1 transition-colors enabled:hover:bg-surface-raised disabled:opacity-40"
      >
        {clearing ? 'Clearing…' : 'Clear cached models'}
      </button>
    </div>
  );
}
