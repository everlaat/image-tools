/**
 * Model weights are fetched once and kept in the Cache API, so opening a tool
 * a second time costs nothing. The browser evicts this under storage pressure,
 * which is fine — a miss just re-downloads.
 */

export const MODEL_CACHE_NAME = 'image-tools-models-v1';

/**
 * Caches this app has used, including ones written by libraries we may add
 * later. "Clear cached models" should empty all of them, not just the current
 * one, or stale weights linger with no way to remove them from the UI.
 */
const OWNED_CACHES: readonly string[] = [
  MODEL_CACHE_NAME,
  // Written by @huggingface/transformers if/when a tool uses it.
  'transformers-cache',
  'experimental_transformers-hash-cache',
];

export type DownloadPhase = 'checking' | 'downloading' | 'ready';

export interface DownloadProgress {
  readonly phase: DownloadPhase;
  readonly loaded: number;
  readonly total: number;
  /** True when the weights came from cache and nothing was downloaded. */
  readonly fromCache: boolean;
}

export type ProgressListener = (progress: DownloadProgress) => void;

/** Cache API is unavailable in some private-browsing modes; degrade quietly. */
async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(MODEL_CACHE_NAME);
  } catch {
    return null;
  }
}

/**
 * Returns the model weights, downloading them only on a cache miss.
 *
 * `expectedBytes` comes from the registry and is used for the progress bar
 * until the response declares its own length, so the UI can show a real
 * percentage and size from the first frame rather than an indeterminate
 * spinner.
 */
export async function fetchModelWeights(
  url: string,
  expectedBytes: number,
  onProgress?: ProgressListener,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  onProgress?.({ phase: 'checking', loaded: 0, total: expectedBytes, fromCache: false });

  const cache = await openCache();
  const hit = await cache?.match(url);
  if (hit) {
    const buffer = await hit.arrayBuffer();
    onProgress?.({
      phase: 'ready',
      loaded: buffer.byteLength,
      total: buffer.byteLength,
      fromCache: true,
    });
    return buffer;
  }

  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) {
    throw new Error(
      `Could not download model weights (HTTP ${String(response.status)}) from ${url}`,
    );
  }

  const declared = Number(response.headers.get('content-length') ?? '0');
  const total = declared > 0 ? declared : expectedBytes;
  const buffer = await readWithProgress(response, total, onProgress, signal);

  // Store a copy so the response body we just consumed is not needed again.
  try {
    await cache?.put(url, new Response(buffer.slice(0), { headers: response.headers }));
  } catch {
    // Over quota or storage denied — the model still works this session.
  }

  onProgress?.({
    phase: 'ready',
    loaded: buffer.byteLength,
    total: buffer.byteLength,
    fromCache: false,
  });
  return buffer;
}

async function readWithProgress(
  response: Response,
  total: number,
  onProgress?: ProgressListener,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const body = response.body;
  if (!body) return response.arrayBuffer();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({
        phase: 'downloading',
        loaded,
        total: Math.max(total, loaded),
        fromCache: false,
      });
      if (signal?.aborted)
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error('Model download cancelled');
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

export interface CacheUsage {
  readonly entries: number;
  readonly bytes: number;
  /** False when the browser gives us no usable Cache API. */
  readonly available: boolean;
}

/** Size of everything we have cached, for the settings panel. */
export async function modelCacheUsage(): Promise<CacheUsage> {
  if (typeof caches === 'undefined') return { entries: 0, bytes: 0, available: false };

  let entries = 0;
  let bytes = 0;

  for (const name of OWNED_CACHES) {
    try {
      if (!(await caches.has(name))) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (!response) continue;
        entries += 1;
        const declared = Number(response.headers.get('content-length') ?? '0');
        bytes += declared > 0 ? declared : (await response.blob()).size;
      }
    } catch {
      // Skip caches we cannot read.
    }
  }

  return { entries, bytes, available: true };
}

/** Removes every cached model. Returns the number of caches actually deleted. */
export async function clearModelCache(): Promise<number> {
  if (typeof caches === 'undefined') return 0;
  let deleted = 0;
  for (const name of OWNED_CACHES) {
    try {
      if (await caches.delete(name)) deleted += 1;
    } catch {
      // Ignore and continue; a partial clear is better than none.
    }
  }
  return deleted;
}
