import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Cross-origin isolation lets onnxruntime-web use SharedArrayBuffer for
 * multi-threaded WASM. `credentialless` is used rather than `require-corp` so
 * that cross-origin model downloads (Hugging Face) keep working without the
 * remote host having to send CORP headers.
 *
 * Any production host must send the same two headers or the WASM backend
 * silently drops to a single thread. See README "Deployment".
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  optimizeDeps: {
    // transformers.js ships prebuilt ESM + .wasm assets; pre-bundling it
    // rewrites the worker/wasm URLs and breaks the ORT backend.
    exclude: ['@huggingface/transformers'],
  },
  build: { target: 'es2022' },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/lib/**'] },
  },
});
