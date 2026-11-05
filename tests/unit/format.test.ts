import { describe, expect, it } from 'vitest';
import { formatBytes, formatPercent } from '../../src/lib/format.ts';
import { fitWithin } from '../../src/lib/image/canvas.ts';

describe('formatBytes', () => {
  it('uses decimal units, as model sizes are usually quoted', () => {
    expect(formatBytes(6_632_188)).toBe('6.6 MB');
    expect(formatBytes(114_538_221)).toBe('114.5 MB');
  });

  it('shows whole bytes without a decimal', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('handles zero and nonsense without throwing', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('formatPercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatPercent(1, 3)).toBe(33);
  });

  it('never exceeds 100 even if more arrives than expected', () => {
    expect(formatPercent(120, 100)).toBe(100);
  });

  it('returns 0 when the total is unknown', () => {
    expect(formatPercent(50, 0)).toBe(0);
  });
});

describe('fitWithin', () => {
  it('leaves images already within the bound alone', () => {
    expect(fitWithin({ width: 800, height: 600 }, 4096)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('scales the longest edge down to the bound', () => {
    expect(fitWithin({ width: 8000, height: 6000 }, 4096)).toEqual({
      width: 4096,
      height: 3072,
    });
  });

  it('works when height is the longest edge', () => {
    const size = fitWithin({ width: 1000, height: 5000 }, 1000);
    expect(size).toEqual({ width: 200, height: 1000 });
  });

  it('never returns a zero dimension', () => {
    const size = fitWithin({ width: 10_000, height: 1 }, 100);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});
