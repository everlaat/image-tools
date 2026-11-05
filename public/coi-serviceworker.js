/*
 * Cross-origin isolation for static hosts that cannot set response headers.
 *
 * onnxruntime-web needs SharedArrayBuffer for multi-threaded WASM, and the
 * browser only grants that to a cross-origin-isolated page — which normally
 * means the server sending COOP and COEP on the document. GitHub Pages cannot
 * send custom headers, so a service worker re-serves same-origin responses
 * with those headers attached.
 *
 * Only same-origin responses are rewritten. Cross-origin requests pass through
 * untouched: model weights are fetched CORS-mode and Hugging Face returns
 * proper CORS headers, which satisfies COEP: require-corp on its own. Faking
 * headers onto someone else's response would be both wrong and unnecessary.
 *
 * Without this the app still works; the WASM backend just runs single-threaded,
 * and the UI says so.
 */

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Leave range/cache probes alone; rebuilding them breaks media and
  // `only-if-cached` requests throw if touched from a service worker.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  const sameOrigin = new URL(request.url).origin === self.location.origin;
  if (!sameOrigin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // An opaque response has no readable headers to copy.
        if (response.status === 0) return response;

        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
      .catch(() => fetch(request)),
  );
});
