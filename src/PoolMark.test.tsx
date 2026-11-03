import { describe, expect, it } from 'vitest';
import { POOL_TYPES } from './lib';
import { poolMarkCells } from './PoolMark';

describe('pool marks', () => {
  it('draws a distinct 7×7 pictogram for every pool', () => {
    const seen = new Set<string>();
    for (const { key } of POOL_TYPES) {
      const rows = poolMarkCells(key);
      expect(rows).toHaveLength(7);
      for (const row of rows) expect(row).toMatch(/^[.#@]{7}$/);
      seen.add(rows.join('/'));
    }
    expect(seen.size).toBe(POOL_TYPES.length);
  });
});
