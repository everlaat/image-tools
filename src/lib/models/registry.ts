/**
 * The single source of truth for every model the app can run.
 *
 * Everything needed to download, build a session for and feed a model lives
 * here, so swapping or adding a model is a change to this file alone. The I/O
 * tensor names and input shapes were read off the real ONNX graphs rather than
 * assumed — these exports do not follow the usual `pixel_values`/`logits`
 * convention, which is why the app drives onnxruntime-web directly.
 */

export type Backend = 'webgpu' | 'wasm';

export type ModelTask = 'matting' | 'segmentation' | 'depth';

export interface Licence {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  /**
   * Whether the licence permits commercial use without a separate agreement.
   * Models where this is false are surfaced as such in the UI and the README.
   */
  readonly allowsCommercialUse: boolean;
}

export const LICENCES = {
  mit: {
    id: 'mit',
    name: 'MIT',
    url: 'https://opensource.org/license/mit',
    allowsCommercialUse: true,
  },
  apache2: {
    id: 'apache-2.0',
    name: 'Apache 2.0',
    url: 'https://www.apache.org/licenses/LICENSE-2.0',
    allowsCommercialUse: true,
  },
} as const satisfies Record<string, Licence>;

/** Channel-wise normalisation applied after scaling pixels to 0..1. */
export interface Normalisation {
  readonly mean: readonly [number, number, number];
  readonly std: readonly [number, number, number];
}

const IMAGENET: Normalisation = {
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
};

const HALF: Normalisation = { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] };

/**
 * How the model wants its input sized. `fixed` graphs refuse anything else;
 * `dynamic` graphs accept any size, so the image is fitted to `target` on its
 * longest edge and rounded to `multipleOf` to keep the downsampling stack
 * aligned.
 */
export type InputSpec =
  | { readonly kind: 'fixed'; readonly width: number; readonly height: number }
  | { readonly kind: 'dynamic'; readonly target: number; readonly multipleOf: number };

export type MattingModelId = 'birefnet-lite-1024' | 'birefnet-lite-512' | 'modnet';

export interface MattingModel {
  readonly id: MattingModelId;
  readonly task: 'matting';
  readonly label: string;
  readonly summary: string;
  /** Hugging Face repo id, resolved against the configured model host. */
  readonly repo: string;
  /** Path of the ONNX file within the repo. */
  readonly file: string;
  /** Exact size of `file`, used for download progress before headers arrive. */
  readonly downloadBytes: number;
  readonly io: { readonly input: string; readonly output: string };
  readonly input: InputSpec;
  readonly normalisation: Normalisation;
  /**
   * Backends this export actually runs on, which is not the same as the
   * backends it theoretically supports. Measured, not assumed: see the
   * per-model notes below.
   */
  readonly backends: readonly Backend[];
  /**
   * WebGPU features the export needs. An fp16 graph fails at session creation
   * on an adapter without `shader-f16`, with an error from deep inside the
   * shader compiler, so this is checked up front.
   */
  readonly requiresGpuFeatures?: readonly string[];
  readonly licence: Licence;
  /** Shown next to the model in the picker when it has a real limitation. */
  readonly caveat?: string;
}

export const MATTING_MODELS: readonly [MattingModel, ...MattingModel[]] = [
  {
    id: 'birefnet-lite-512',
    task: 'matting',
    label: 'BiRefNet lite',
    summary:
      'Good edges on any subject, and the only general model that also runs without a GPU.',
    repo: 'studioludens/birefnet-lite-512',
    file: 'onnx/model_fp16.onnx',
    downloadBytes: 98_484_532,
    io: { input: 'input_image', output: 'output_image' },
    input: { kind: 'fixed', width: 512, height: 512 },
    normalisation: IMAGENET,
    // Measured: works on both. WASM takes ~14s to build the session and ~9s
    // per run, which is slow but sound.
    backends: ['webgpu', 'wasm'],
    requiresGpuFeatures: ['shader-f16'],
    licence: LICENCES.mit,
  },
  {
    id: 'birefnet-lite-1024',
    task: 'matting',
    label: 'BiRefNet lite (1024)',
    summary:
      'Finest detail on hair and thin edges. Needs a GPU with half-precision support.',
    repo: 'onnx-community/BiRefNet_lite-ONNX',
    file: 'onnx/model_fp16.onnx',
    downloadBytes: 114_538_221,
    io: { input: 'input_image', output: 'output_image' },
    input: { kind: 'fixed', width: 1024, height: 1024 },
    normalisation: IMAGENET,
    // Measured: WASM dies with std::bad_alloc partway through the run at this
    // resolution, so WASM is deliberately not offered as a fallback.
    backends: ['webgpu'],
    requiresGpuFeatures: ['shader-f16'],
    licence: LICENCES.mit,
    caveat: 'WebGPU only — too memory-hungry for the CPU fallback.',
  },
  {
    id: 'modnet',
    task: 'matting',
    label: 'MODNet',
    summary: 'Downloads in a few seconds. Good for photos of people.',
    repo: 'Xenova/modnet',
    file: 'onnx/model_quantized.onnx',
    downloadBytes: 6_632_188,
    io: { input: 'input', output: 'output' },
    input: { kind: 'dynamic', target: 512, multipleOf: 32 },
    normalisation: HALF,
    backends: ['webgpu', 'wasm'],
    licence: LICENCES.apache2,
    caveat: 'Trained on people — unreliable on objects, animals and products.',
  },
];

/**
 * The 512 BiRefNet rather than the 1024 one: it is the best general-purpose
 * model that still runs on the WASM fallback, and a default that fails on
 * every machine without WebGPU is not a default.
 */
export const DEFAULT_MATTING_MODEL_ID: MattingModelId = 'birefnet-lite-512';

/**
 * Where weights are fetched from. Override with VITE_MODEL_HOST to use a
 * mirror, a self-hosted copy or an offline bundle.
 */
const configuredHost: unknown = import.meta.env.VITE_MODEL_HOST;

export const MODEL_HOST: string =
  typeof configuredHost === 'string' && configuredHost.length > 0
    ? configuredHost
    : 'https://huggingface.co';

export function getMattingModel(id: MattingModelId): MattingModel {
  const model = MATTING_MODELS.find((m) => m.id === id);
  if (!model) throw new Error(`Unknown matting model: ${id}`);
  return model;
}

/** Resolves the absolute URL of a model's weights. */
export function modelUrl(model: MattingModel, host: string = MODEL_HOST): string {
  const base = host.endsWith('/') ? host.slice(0, -1) : host;
  return `${base}/${model.repo}/resolve/main/${model.file}`;
}

/** Target pixel dimensions for a given model and source image. */
export function resolveInputSize(
  spec: InputSpec,
  source: { width: number; height: number },
): { width: number; height: number } {
  if (spec.kind === 'fixed') return { width: spec.width, height: spec.height };

  const longest = Math.max(source.width, source.height);
  const scale = longest > 0 ? spec.target / longest : 1;
  const round = (n: number) =>
    Math.max(spec.multipleOf, Math.round(n / spec.multipleOf) * spec.multipleOf);

  return {
    width: round(source.width * scale),
    height: round(source.height * scale),
  };
}

/* -------------------------------------------------------------------------
 * Phase 3: segmentation and depth
 *
 * Variants were chosen by measuring each export in a browser on the WASM
 * backend at its real input size, warm (second run):
 *
 *   SAM encoder  fp16       12.2 MB  4.3 s     quantised  8.9 MB  3.1 s
 *   SAM decoder  fp16        8.6 MB  0.37 s    quantised  4.9 MB  0.70 s
 *   Depth        quantised  27.3 MB  1.46 s    q4f16     19.1 MB  1.9 s
 *                fp16       49.6 MB  2.1 s
 *
 * So: quantised encoder (smaller and faster), fp16 decoder (quantising it
 * makes it slower, and the decoder is the one that runs on every click), and
 * quantised depth.
 * ---------------------------------------------------------------------- */

/**
 * Segment Anything runs in two stages. The encoder is slow but runs once per
 * image; the decoder runs on every click, so its latency is what the
 * interaction actually feels like.
 */
export interface SegmentationModel {
  readonly id: 'slimsam';
  readonly task: 'segmentation';
  readonly label: string;
  readonly repo: string;
  readonly encoder: { readonly file: string; readonly downloadBytes: number };
  readonly decoder: { readonly file: string; readonly downloadBytes: number };
  /** Longest edge the image is resized to before padding to a square. */
  readonly longestEdge: number;
  /** Side of the square mask the decoder emits. */
  readonly maskSize: number;
  readonly normalisation: Normalisation;
  readonly backends: readonly Backend[];
  readonly licence: Licence;
}

export const SEGMENTATION_MODEL: SegmentationModel = {
  id: 'slimsam',
  task: 'segmentation',
  label: 'SlimSAM',
  repo: 'Xenova/slimsam-77-uniform',
  encoder: { file: 'onnx/vision_encoder_quantized.onnx', downloadBytes: 8_922_031 },
  decoder: {
    file: 'onnx/prompt_encoder_mask_decoder_fp16.onnx',
    downloadBytes: 8_566_431,
  },
  longestEdge: 1024,
  maskSize: 256,
  normalisation: IMAGENET,
  backends: ['webgpu', 'wasm'],
  licence: LICENCES.apache2,
};

export interface DepthModel {
  readonly id: 'depth-anything-v2-small';
  readonly task: 'depth';
  readonly label: string;
  readonly repo: string;
  readonly file: string;
  readonly downloadBytes: number;
  readonly io: { readonly input: string; readonly output: string };
  readonly input: InputSpec;
  readonly normalisation: Normalisation;
  readonly backends: readonly Backend[];
  readonly licence: Licence;
}

export const DEPTH_MODEL: DepthModel = {
  id: 'depth-anything-v2-small',
  task: 'depth',
  label: 'Depth Anything V2 Small',
  repo: 'onnx-community/depth-anything-v2-small',
  file: 'onnx/model_quantized.onnx',
  downloadBytes: 27_277_217,
  io: { input: 'pixel_values', output: 'predicted_depth' },
  // Patch size 14, so both edges must be a multiple of it or the graph
  // silently crops. Only the Small variant is Apache-2.0; Base and larger
  // are CC-BY-NC and are deliberately not offered.
  input: { kind: 'dynamic', target: 518, multipleOf: 14 },
  normalisation: IMAGENET,
  backends: ['webgpu', 'wasm'],
  licence: LICENCES.apache2,
};

/** Absolute URL for any repo-relative model file. */
export function fileUrl(repo: string, file: string, host: string = MODEL_HOST): string {
  const base = host.endsWith('/') ? host.slice(0, -1) : host;
  return `${base}/${repo}/resolve/main/${file}`;
}
