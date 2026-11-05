# Image Tools

Background removal, logo vectorising and layer splitting that run **entirely in the
browser**. Images are decoded, segmented and encoded on your own device; nothing is
uploaded and there is no inference server.

> **Status:** Phase 1 (background removal) and Phase 2 (logo → SVG) are implemented.
> Phase 3 is described in [Roadmap](#roadmap).

## Setup

```bash
pnpm install
pnpm build:wasm   # compiles the Rust vectoriser; needed once before dev/build
pnpm dev          # http://localhost:5173
```

`pnpm build:wasm` needs a Rust toolchain with the `wasm32-unknown-unknown` target
(`rustup target add wasm32-unknown-unknown`). Its output lands in
`crates/vtracer-wasm/pkg`, which is generated rather than committed — if typecheck
cannot resolve `@vtracer`, that build has not been run.

| Script                              | What it does                                   |
| ----------------------------------- | ---------------------------------------------- |
| `pnpm dev`                          | Dev server with cross-origin isolation headers |
| `pnpm build`                        | Typecheck (`tsc -b`) then production build     |
| `pnpm typecheck`                    | Types only                                     |
| `pnpm lint` / `pnpm lint:fix`       | ESLint, type-aware                             |
| `pnpm format` / `pnpm format:check` | Prettier                                       |
| `pnpm test`                         | Vitest unit suite                              |
| `pnpm test:e2e`                     | Playwright, builds and previews first          |
| `pnpm check`                        | Everything above except e2e                    |

The Playwright suite downloads a real model (~6.6 MB) from Hugging Face on first run,
so it needs network access. Browsers come from `pnpm exec playwright install chromium`.

## Architecture

```
src/
  app/                    shell, tool registry
  components/             Dropzone, CompareSlider, RangeField, ProgressBar, cache settings
  features/
    background-removal/   Phase 1: hook, model picker, backend badge
    vectorize/            Phase 2: hook, live SVG preview, trace settings
  lib/
    models/
      registry.ts         ← every model lives here: id, URL, size, I/O names, licence
      backend.ts          WebGPU probe, execution-provider choice, thread sizing
      cache.ts            Cache API storage, streaming progress, clear
      session.ts          owns one ORT session; load / run / dispose
    image/                decode, resample, tensor conversion, mask maths, PNG encode
    color/quantise.ts     median cut + k-means palette reduction
    vector/options.ts     tracing settings, kept free of the wasm import
  workers/
    matting.worker.ts     inference and pixel work, exposed over Comlink
    vectorize.worker.ts   quantise + trace, exposed over Comlink
crates/
  vtracer-wasm/           Rust bindings around vtracer, built to WebAssembly
```

**Everything heavy happens in a Web Worker.** The UI thread never decodes, never runs a
model and never encodes a PNG, so it stays responsive even on a large image.

**The worker keeps the source raster and the raw mask between calls.** Moving the
feather or threshold slider re-composites from the mask already in hand rather than
re-running the model, which is the difference between milliseconds and seconds.

**Masks come back at inference resolution and are lifted to full resolution** with a
bilinear resample that maps destination pixel _centres_ into source space, so the result
is not shifted half a pixel. Edge refinement is applied after that lift, so a feather
radius means output pixels rather than model pixels.

**Images larger than 4096 px on the longest edge are scaled down** before processing and
the UI says so. An 8000×6000 photo is 192 MB as RGBA, which is enough to get a mobile tab
killed.

### Backends

The app prefers **WebGPU** and falls back to **WASM** automatically. It also reports which
one is actually in use, and why WebGPU was skipped when it was — adapters get
blocklisted and cross-origin isolation gets lost behind proxies, so guessing from the
spec sheet is not good enough. Before accepting WebGPU it checks
`maxStorageBufferBindingSize`, because an adapter that advertises WebGPU but caps storage
buffers too low will fail partway through a run rather than at startup.

Multi-threaded WASM needs `SharedArrayBuffer`, which needs cross-origin isolation. The dev
and preview servers send:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`require-corp` rather than `credentialless`: model weights are fetched with a CORS-mode
`fetch()` and Hugging Face returns the right CORS headers, so require-corp does not block
them — verified against the live host. It also works in Safari, which does not support
`credentialless` at all.

**Any host must send these two headers**, or the WASM backend drops to a single thread.
Hosts that cannot set headers are covered below.

### Model storage

Weights are fetched once and kept in the Cache API under `image-tools-models-v1`, with
real byte-level progress during download. "Clear cached models" in the footer empties
that cache and reports what was freed. The browser may evict it under storage pressure; a
miss just re-downloads.

The ONNX runtime's own `.wasm` (28 MB, ~7.3 MB gzipped) is served from this origin, not a
public CDN. onnxruntime-web defaults to fetching it from jsDelivr, which would mean a
privacy-focused app phoning a third party on every cold load.

### Swapping models

`src/lib/models/registry.ts` is the only file to touch. Each entry carries its id, repo,
file, exact download size, ONNX input/output tensor names, input sizing rule,
normalisation constants, supported backends and licence. Point `VITE_MODEL_HOST` at a
mirror or a self-hosted copy to move weights off Hugging Face entirely.

## Models and licences

| Model                                                                      | Role                  | Licence        | Download        |
| -------------------------------------------------------------------------- | --------------------- | -------------- | --------------- |
| [BiRefNet lite](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX)  | Default matting       | **MIT**        | 114.5 MB (fp16) |
| [BiRefNet lite 512](https://huggingface.co/studioludens/birefnet-lite-512) | Faster matting        | **MIT**        | 98.5 MB (fp16)  |
| [MODNet](https://huggingface.co/Xenova/modnet)                             | Fast / mobile matting | **Apache-2.0** | 6.6 MB (int8)   |

All three permit commercial use. If a non-commercial model is ever added, the registry
marks it `allowsCommercialUse: false` and the picker says so in the UI.

### Why these, and what was rejected

**BiRefNet lite is the default** because it is the only modern matting model with genuinely
good edge quality on arbitrary subjects _and_ a permissive licence. It costs 114.5 MB,
which is a lot, but it is cached after the first run.

**MODNet earns its place on size.** At 6.6 MB quantised it is usable on a phone and over a
slow connection, and it is Apache-2.0. It is trained on people, so it is unreliable on
objects, animals and products — the picker says this rather than letting you discover it.

**BRIA RMBG-1.4 / 2.0 were rejected on licence.** They are the default in most in-browser
tutorials, and RMBG-1.4 is appealing at 44.4 MB quantised, but both ship under BRIA's
[own agreement](https://bria.ai/bria-huggingface-model-license-agreement/), which is free
for non-commercial use only. (A secondary quirk, since it is often reported as a blocker:
RMBG-1.4's `config.json` declares `model_type: "SegformerForSemanticSegmentation"`, which
is an architecture name rather than a model type. It still loads via `AutoModel` with a
base-class fallback warning; it is the `pipeline()` helper that rejects it.)

**ISNet was rejected on licence.** The main ONNX export,
[`onnx-community/ISNet-ONNX`](https://huggingface.co/onnx-community/ISNet-ONNX), is
**AGPL-3.0**, which is untenable for a hosted web app. Permissive repackagings exist but
are low-traffic and harder to vouch for.

**`naddy24/birefnet-512-webgpu` was rejected on size** — a 473 MB fp16 export, four times
the model it re-exports.

### Why onnxruntime-web rather than transformers.js

These matting exports do not follow the `pixel_values` → `logits` convention
transformers.js expects. Read off the real graphs: BiRefNet uses
`input_image` → `output_image` at a fixed 1024×1024, and MODNet uses `input` → `output`
with fully dynamic dimensions. `AutoModel` loads BiRefNet as a bare `SwinModel` backbone
and would not feed it correctly. Driving onnxruntime-web directly is about forty lines of
preprocessing, keeps the pre/post-processing unit-testable, and gives precise control over
execution providers. transformers.js remains the right tool for Phase 3, where SlimSAM and
Depth Anything are exported conventionally and ship real processors.

## Vectorising (Phase 2)

Almost none of this is machine learning. The pipeline is **quantise, then trace**:

1. **Colour reduction** to a count the user picks. Median cut builds the palette and
   k-means optionally refines it. This is deliberately ours rather than vtracer's own
   `color_precision`, because the brief asks for an exact colour count, not an
   approximate precision knob — so vtracer's internal quantisation is turned down to
   its most faithful setting and does not quantise a second time.
2. **Tracing** with [vtracer](https://crates.io/crates/vtracer), compiled from source.

Flat artwork keeps its exact colours. If an image has four colours and you ask for
eight, you get those four back untouched rather than eight blended averages — median cut
splits at medians, which would otherwise turn exact brand colours into approximations of
themselves.

Cleanliness comes from vtracer's own speckle filter (exposed as **Remove speckles**),
stacked layers so adjacent colours share edges instead of leaving seams, and an
adjustable coordinate precision that trims file size. The 512×512 fixture in the test
suite traces to 5 paths and 3.1 kB in about 56 ms.

### Why vtracer compiled from source

The npm `vtracer-wasm` package **declares no licence at all**, which makes it unusable.
`potrace` and `esm-potrace-wasm` are **GPL-2.0**, which would force the whole
application to GPL. The vtracer crate itself is **MIT OR Apache-2.0** and compiles
cleanly to `wasm32-unknown-unknown`, so the project builds it rather than depending on
either. The result is 172 kB of wasm (59 kB gzipped).

`wasm-opt` is disabled: it downloads a binaryen release at build time, which makes the
build depend on network access and differ between machines. rustc already applies
`opt-level = 3` and fat LTO.

## Accessibility

Keyboard operable throughout, with a visible focus ring on every interactive element. The
before/after comparison is an `<input type="range">` rather than a mouse-only drag target,
so it works with a keyboard and announces its value. Controls are labelled and the
progress bar exposes `role="progressbar"`. `prefers-reduced-motion` is respected.

## Browser support

Current Chrome, Edge, Safari and Firefox. WebGPU is used where available — today that is
mainly Chrome and Edge — and WASM is used everywhere else, so Firefox and Safari work,
just more slowly. `OffscreenCanvas`, Web Workers with ES modules, and the Cache API are
required; all four target browsers have them.

## Deployment

### GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to `master`.

**One manual step is required first:** go to **Settings → Pages** and set **Source** to
**GitHub Actions**. This cannot be automated — creating a Pages site is not permitted to
the default `GITHUB_TOKEN`, which fails with _Resource not accessible by integration_.
After that the workflow needs no secrets and no further setup.

Two things make this work on a host that cannot set response headers:

- **Base path.** Project sites are served from `/<repo>/`, so the build sets Vite's `base`
  from `BASE_PATH`, which the workflow derives from the repository name.
- **`public/coi-serviceworker.js`.** GitHub Pages cannot send COOP/COEP, and without them
  there is no `SharedArrayBuffer` and the WASM backend is stuck on one thread. A small
  service worker re-serves same-origin responses with those headers; the first visit
  registers it and reloads once. Cross-origin requests pass through untouched — model
  weights come over CORS, which satisfies `require-corp` by itself, so there is no reason
  to rewrite someone else's response.

Verified against a plain static server with no headers at all: the page reports
`crossOriginIsolated: true`, gets 3 WASM threads, downloads the model from Hugging Face
and produces a correct full-resolution cutout.

If the service worker is unavailable — blocked, or storage denied — the app still works;
the WASM backend just runs single-threaded and the badge says so.

### Anywhere else

Any static host works. Set the two headers above directly if you can, in which case the
service worker detects the page is already isolated and does nothing.

## Known limitations

- **The default model's first run costs 98.5 MB.** Cached afterwards, but a real wait on a
  slow connection. MODNet (6.6 MB) is offered as the fast alternative.
- **BiRefNet on WASM is slow** — roughly 14 s to build the session and 9 s per image on
  the CI container. Usable, but WebGPU is the happy path, and the badge says which you
  are on.
- **The 1024 model needs WebGPU with `shader-f16`.** It is offered but clearly marked, and
  the app explains the specific reason when it cannot be used.
- **MODNet is human-matting only.** Flagged in the picker.
- **Images are capped at 4096 px** on the longest edge for memory safety.
- **WebGPU is not exercised by the automated suite.** The default headless browser exposes
  no adapter; it can be forced on with `--enable-unsafe-webgpu --use-angle=swiftshader`,
  but that software adapter lacks `shader-f16`, so it cannot run the fp16 models either.
  The WebGPU path needs a manual check on real hardware.
- **No cancel button yet** for an in-flight model download.
- **Vectorising ignores transparency.** Alpha is not currently used to exclude regions,
  so a logo on a transparent background traces that background as a shape. Compositing
  onto a chosen colour, or dropping the background path, is the obvious next step.
- **Vector input is capped at 1600 px** on the longest edge; tracing cost scales with
  area and logos gain nothing above it.
- **No upscale/denoise pre-step** for low-resolution input, which the brief lists as
  optional for this phase.

## Roadmap

- **Phase 3 — Layer splitting.** SlimSAM (Apache-2.0, 20.8 MB fp16) with click-to-select
  points, and Depth Anything V2 Small (Apache-2.0) to suggest foreground/midground/
  background. Note only the _Small_ Depth Anything is Apache; Base and larger are
  CC-BY-NC. Inpainting is a flagged stretch goal: `Xenova/lama` 404s behind auth and the
  one MI-GAN ONNX export found declares no licence, so it would need re-exporting from
  upstream.

## Licence

Application code is MIT. Model weights are governed by their own licences, listed above.
