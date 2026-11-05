import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Cross-origin isolation lets onnxruntime-web use SharedArrayBuffer for
 * multi-threaded WASM.
 *
 * `require-corp` rather than `credentialless`: model weights are fetched with
 * a CORS-mode `fetch()` and Hugging Face returns the right CORS headers, so
 * require-corp does not block them (verified against the live host). It also
 * works in Safari, which does not support credentialless at all.
 *
 * Any production host must send the same two headers or the WASM backend
 * drops to a single thread. Static hosts that cannot set headers — GitHub
 * Pages among them — get them from public/coi-serviceworker.js instead.
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/, so the base has to match.
  // Set BASE_PATH in CI; local builds stay at the root.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  optimizeDeps: {
    // onnxruntime-web points at its .wasm with `new URL(..., import.meta.url)`.
    // Pre-bundling rewrites that reference and the runtime then falls back to a
    // public CDN, so it has to stay out of the esbuild pass.
    exclude: ['onnxruntime-web'],
  },
  build: { target: 'es2022' },
  test: {
    // The unit suite covers pure pixel/registry logic; DOM behaviour is
    // covered by the Playwright suite against a real browser instead.
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/lib/**'] },
  },
});
