import { describe, expect, it } from 'vitest';
import { challengeInput, hexToBytes, meetsTarget, solutions } from './equihash';
import vector from './fixtures/equihash.json';

describe('Equihash(96,5)', () => {
  it('reproduces an independent upstream librustzcash test vector', () => {
    // zcash/librustzcash components/equihash/src/test_vectors/valid.rs
    const nonce = new Uint8Array(32);
    nonce[0] = 1;
    expect(solutions(new TextEncoder().encode('block header'), nonce)).toEqual([[
      1911, 96020, 94086, 96830, 7895, 51522, 56142, 62444,
      15441, 100732, 48983, 64776, 27781, 85932, 101138, 114362,
      4497, 14199, 36249, 41817, 23995, 93888, 35798, 96337,
      5530, 82377, 66438, 85247, 39332, 78978, 83015, 123505,
    ]]);
  });

  it('matches the signed challenge, solution and target checked by the Python faucet', () => {
    const input = challengeInput(vector.challenge);
    const nonce = hexToBytes(vector.proof.nonce);
    expect(solutions(input, nonce)).toContainEqual(vector.proof.indices);
    expect(meetsTarget(input, nonce, vector.proof.indices, 3)).toBe(true);
    expect(meetsTarget(input, nonce, vector.proof.indices, 16)).toBe(false);
  });

  it('rejects unsupported parameters and inconsistent challenge inputs before allocating tables', () => {
    for (const change of [{ n: 200 }, { k: 9 }, { difficulty_bits: 17 }, { difficulty_bits: -1 },
      { difficulty_bits: 1.5 }, { input: 'ff'.repeat(32) }, { valid_for_ms: 0 }, { ticket: 'x'.repeat(1025) }]) {
      expect(() => challengeInput({ ...vector.challenge, ...change })).toThrow();
    }
  });
});
