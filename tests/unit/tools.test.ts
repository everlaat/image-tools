import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../src/app/tools.ts';

describe('tool registry', () => {
  it('exposes a unique id per tool', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships at least one available tool so the shell always renders', () => {
    expect(TOOLS.some((t) => t.available)).toBe(true);
  });
});
