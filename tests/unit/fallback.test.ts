import { describe, expect, it } from 'vitest';
import { describeFailure, shouldFallBackToWasm } from '../../src/lib/models/session.ts';

describe('shouldFallBackToWasm', () => {
  it('retries a WebGPU failure on the CPU', () => {
    expect(
      shouldFallBackToWasm({
        current: 'webgpu',
        supported: ['webgpu', 'wasm'],
        alreadyFellBack: false,
      }),
    ).toBe(true);
  });

  it('does not retry when already running on the CPU', () => {
    expect(
      shouldFallBackToWasm({
        current: 'wasm',
        supported: ['webgpu', 'wasm'],
        alreadyFellBack: false,
      }),
    ).toBe(false);
  });

  it('does not retry a model that has no CPU path', () => {
    // BiRefNet at 1024 exhausts WASM memory, so it declares webgpu only;
    // falling back would swap one failure for another.
    expect(
      shouldFallBackToWasm({
        current: 'webgpu',
        supported: ['webgpu'],
        alreadyFellBack: false,
      }),
    ).toBe(false);
  });

  it('only falls back once, so a persistent fault cannot loop', () => {
    expect(
      shouldFallBackToWasm({
        current: 'webgpu',
        supported: ['webgpu', 'wasm'],
        alreadyFellBack: true,
      }),
    ).toBe(false);
  });
});

describe('describeFailure', () => {
  it('explains the storage-buffer limit in plain words', () => {
    const message = describeFailure(
      new Error(
        'failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: shader_helper.cc:354 ' +
          'numbers_storage_buffers_ <= limits_.maxStorageBuffersPerShaderStage was false. ' +
          'Too many storage buffers in shader. Current: 11, Max is 10',
      ),
    );
    expect(message).toMatch(/too few storage buffers/i);
    expect(message).not.toMatch(/shader_helper\.cc/);
  });

  it('explains an out-of-memory failure', () => {
    expect(describeFailure(new Error('std::bad_alloc'))).toMatch(/out of memory/i);
  });

  it('falls back to a generic sentence for anything else', () => {
    expect(describeFailure(new Error('something odd'))).toMatch(
      /failed to run on the GPU/i,
    );
  });

  it('handles a non-Error being thrown', () => {
    expect(describeFailure('nope')).toMatch(/failed to run on the GPU/i);
  });
});
