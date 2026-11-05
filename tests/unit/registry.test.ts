import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATTING_MODEL_ID,
  MATTING_MODELS,
  getMattingModel,
  modelUrl,
  resolveInputSize,
} from '../../src/lib/models/registry.ts';

describe('matting registry', () => {
  it('has a unique id per model', () => {
    const ids = MATTING_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves the default model', () => {
    expect(getMattingModel(DEFAULT_MATTING_MODEL_ID).id).toBe(DEFAULT_MATTING_MODEL_ID);
  });

  it('defaults to a model that allows commercial use', () => {
    // The brief rules out non-commercial models unless clearly flagged, so the
    // default must never be one of them.
    const model = getMattingModel(DEFAULT_MATTING_MODEL_ID);
    expect(model.licence.allowsCommercialUse).toBe(true);
  });

  it('declares a licence and a non-zero size for every model', () => {
    for (const model of MATTING_MODELS) {
      expect(model.licence.name).toBeTruthy();
      expect(model.licence.url).toMatch(/^https:\/\//);
      expect(model.downloadBytes).toBeGreaterThan(0);
    }
  });

  it('names both I/O tensors for every model', () => {
    for (const model of MATTING_MODELS) {
      expect(model.io.input).toBeTruthy();
      expect(model.io.output).toBeTruthy();
    }
  });

  it('throws on an unknown id rather than silently falling back', () => {
    // @ts-expect-error -- deliberately outside the union
    expect(() => getMattingModel('nope')).toThrow(/Unknown matting model/);
  });
});

describe('modelUrl', () => {
  const model = getMattingModel('modnet');

  it('builds a resolve URL from the repo and file', () => {
    expect(modelUrl(model, 'https://huggingface.co')).toBe(
      'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model_quantized.onnx',
    );
  });

  it('tolerates a trailing slash on the host', () => {
    expect(modelUrl(model, 'https://mirror.example/')).toBe(
      'https://mirror.example/Xenova/modnet/resolve/main/onnx/model_quantized.onnx',
    );
  });
});

describe('resolveInputSize', () => {
  it('returns the fixed size regardless of the source', () => {
    const size = resolveInputSize(
      { kind: 'fixed', width: 1024, height: 1024 },
      { width: 300, height: 4000 },
    );
    expect(size).toEqual({ width: 1024, height: 1024 });
  });

  it('fits the longest edge to the target for dynamic models', () => {
    const size = resolveInputSize(
      { kind: 'dynamic', target: 512, multipleOf: 32 },
      { width: 1000, height: 500 },
    );
    expect(size.width).toBe(512);
    expect(size.height).toBe(256);
  });

  it('rounds both edges to the required multiple', () => {
    const size = resolveInputSize(
      { kind: 'dynamic', target: 512, multipleOf: 32 },
      { width: 813, height: 611 },
    );
    expect(size.width % 32).toBe(0);
    expect(size.height % 32).toBe(0);
  });

  it('never rounds an edge down to zero', () => {
    const size = resolveInputSize(
      { kind: 'dynamic', target: 512, multipleOf: 32 },
      { width: 4000, height: 3 },
    );
    expect(size.height).toBe(32);
  });

  it('keeps aspect ratio roughly intact', () => {
    const source = { width: 1600, height: 900 };
    const size = resolveInputSize(
      { kind: 'dynamic', target: 512, multipleOf: 32 },
      source,
    );
    const sourceRatio = source.width / source.height;
    expect(size.width / size.height).toBeCloseTo(sourceRatio, 1);
  });
});
