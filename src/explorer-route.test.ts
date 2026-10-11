import { describe, expect, it } from 'vitest';
import { blockIdFromPath, blockPath, isBlockId } from './explorer-route';

describe('block permalinks', () => {
  const hash = 'ab'.repeat(32);

  it('preserves the full hash and normalizes uppercase and trailing slashes', () => {
    expect(blockPath(hash.toUpperCase())).toBe(`/block/${hash}`);
    expect(blockIdFromPath(`/block/${hash.toUpperCase()}/`)).toBe(hash);
  });

  it.each([0, 3794, 4294967295])('also accepts height %s', (height) => {
    expect(blockPath(height)).toBe(`/block/${height}`);
    expect(blockIdFromPath(blockPath(height))).toBe(String(height));
  });

  it.each(['', '-1', '01', '+1', '1.5', '4294967296', 'g'.repeat(64), 'a'.repeat(63), `${hash}/extra`, '1?x=2'])('rejects %s without losing the error route', (id) => {
    expect(isBlockId(id)).toBe(false);
    expect(() => blockPath(id)).toThrow();
    expect(blockIdFromPath(`/block/${id}`)).not.toBeNull();
  });

  it('does not confuse transactions or the stream with blocks', () => {
    expect(blockIdFromPath('/')).toBeNull();
    expect(blockIdFromPath(`/tx/${hash}`)).toBeNull();
  });
});
