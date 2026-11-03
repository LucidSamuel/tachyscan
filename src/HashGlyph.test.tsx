import { describe, expect, it } from 'vitest';
import { glyphCells } from './HashGlyph';

describe('hash glyphs', () => {
  it('are deterministic and mirror-symmetric', () => {
    const hash = 'faa6cacde8d7f8f9edc355be1ed01fd7406f9e29c6f903879005a8a245a7503a';
    const cells = glyphCells(hash);
    expect(cells).toHaveLength(25);
    expect(glyphCells(hash)).toEqual(cells);
    for (let row = 0; row < 5; row += 1) {
      expect(cells[row * 5]).toBe(cells[row * 5 + 4]);
      expect(cells[row * 5 + 1]).toBe(cells[row * 5 + 3]);
    }
  });

  it('differ between hashes', () => {
    expect(glyphCells('00'.repeat(32))).not.toEqual(glyphCells('ff'.repeat(32)));
  });
});
