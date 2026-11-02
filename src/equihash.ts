import { blake2b } from '@noble/hashes/blake2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export interface Challenge {
  ticket: string;
  input: string;
  n: number;
  k: number;
  difficulty_bits: number;
  expires_ms: number;
  valid_for_ms: number;
}
export interface Proof { ticket: string; nonce: string; indices: number[] }
export interface WorkProgress { attempts: number; phase: 'hashing' | 'matching'; round: number }

// Equihash(96,5): six 16-bit collision words and 17-bit leaf indices.
// The personalization and leaf encoding match Zcash's Equihash verifier.
const PERSONAL = concatBytes(utf8ToBytes('ZcashPoW'), new Uint8Array([96, 0, 0, 0, 5, 0, 0, 0]));
const LEAVES = 1 << 17;
const MAX_ROWS = 1 << 18;
const TARGET_DOMAIN = utf8ToBytes('TachyonFaucet/Target/v1\0');

export function challengeInput(challenge: Challenge): Uint8Array {
  if (challenge.n !== 96 || challenge.k !== 5 || !Number.isInteger(challenge.difficulty_bits)
    || challenge.difficulty_bits < 0 || challenge.difficulty_bits > 16
    || typeof challenge.ticket !== 'string' || challenge.ticket.length > 1024
    || !/^[0-9a-f]{64}$/.test(challenge.input)
    || !Number.isInteger(challenge.valid_for_ms) || challenge.valid_for_ms < 1000 || challenge.valid_for_ms > 3600000) {
    throw new Error('The faucet returned an unsupported puzzle. Refresh and try again.');
  }
  const input = sha256(concatBytes(utf8ToBytes('TachyonFaucet/Equihash/v1\0'), utf8ToBytes(challenge.ticket)));
  if (bytesToHex(input) !== challenge.input) throw new Error('The faucet returned an inconsistent puzzle.');
  return input;
}

export function meetsTarget(input: Uint8Array, nonce: Uint8Array, indices: number[], bits: number): boolean {
  const encoded = new Uint8Array(indices.length * 4);
  const view = new DataView(encoded.buffer);
  indices.forEach((index, i) => view.setUint32(i * 4, index));
  const digest = sha256(concatBytes(TARGET_DOMAIN, input, nonce, encoded));
  for (let i = 0; i < bits; i++) if (digest[i >> 3] & (0x80 >> (i & 7))) return false;
  return true;
}

/** Wagner's collision search, with bounded typed-array tables, run only in a Worker.
 * A nonce can yield zero or several solutions. Table overflow discards this nonce
 * instead of letting an unlucky bucket distribution grow browser memory forever.
 */
export function solutions(input: Uint8Array, nonce: Uint8Array, progress: (round: number) => void = () => {}): number[][] {
  let width = 6;
  let stride = 1;
  let count = LEAVES;
  let hashes = new Uint16Array(count * width);
  let indices = new Uint32Array(count);
  const state = blake2b.create({ dkLen: 60, personalization: PERSONAL }).update(input).update(nonce);
  const group = new Uint8Array(4);
  const groupView = new DataView(group.buffer);
  for (let start = 0; start < LEAVES; start += 5) {
    groupView.setUint32(0, start / 5, true);
    const digest = state.clone().update(group).digest();
    for (let leaf = 0; leaf < 5 && start + leaf < LEAVES; leaf++) {
      indices[start + leaf] = start + leaf;
      for (let word = 0; word < 6; word++) {
        const offset = leaf * 12 + word * 2;
        hashes[(start + leaf) * 6 + word] = (digest[offset] << 8) | digest[offset + 1];
      }
    }
  }
  state.destroy();
  const heads = new Int32Array(1 << 16);
  const links = new Int32Array(MAX_ROWS);
  const found: number[][] = [];
  for (let round = 1; round <= 5; round++) {
    progress(round);
    heads.fill(-1);
    for (let row = 0; row < count; row++) {
      const bucket = hashes[row * width];
      links[row] = heads[bucket];
      heads[bucket] = row;
    }
    const final = round === 5;
    const nextHashes = new Uint16Array(final ? 0 : MAX_ROWS * (width - 1));
    const nextIndices = new Uint32Array(final ? 0 : MAX_ROWS * stride * 2);
    let nextCount = 0;
    for (let bucket = 0; bucket < heads.length; bucket++) {
      for (let a = heads[bucket]; a !== -1; a = links[a]) {
        for (let b = links[a]; b !== -1; b = links[b]) {
          if (final && hashes[a * width + 1] !== hashes[b * width + 1]) continue;
          let left = a * stride;
          let right = b * stride;
          if (indices[left] > indices[right]) [left, right] = [right, left];
          let distinct = true;
          for (let i = 0; distinct && i < stride; i++) {
            for (let j = 0; j < stride; j++) {
              if (indices[left + i] === indices[right + j]) { distinct = false; break; }
            }
          }
          if (!distinct) continue;
          if (final) {
            found.push([...indices.subarray(left, left + stride), ...indices.subarray(right, right + stride)]);
          } else {
            if (nextCount === MAX_ROWS) return [];
            for (let word = 1; word < width; word++) {
              nextHashes[nextCount * (width - 1) + word - 1] = hashes[a * width + word] ^ hashes[b * width + word];
            }
            nextIndices.set(indices.subarray(left, left + stride), nextCount * stride * 2);
            nextIndices.set(indices.subarray(right, right + stride), nextCount * stride * 2 + stride);
            nextCount++;
          }
        }
      }
    }
    hashes = nextHashes;
    indices = nextIndices;
    count = nextCount;
    stride *= 2;
    width--;
  }
  return found;
}

export function solveChallenge(challenge: Challenge, report: (progress: WorkProgress) => void): Proof {
  const input = challengeInput(challenge);
  const deadline = performance.now() + challenge.valid_for_ms - 1000;
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const counter = new DataView(nonce.buffer);
  for (let attempts = 1; attempts <= 100000; attempts++) {
    if (performance.now() >= deadline) throw new Error('The puzzle expired. Please try again.');
    report({ attempts, phase: 'hashing', round: 0 });
    counter.setUint32(0, attempts, true);
    for (const indices of solutions(input, nonce, (round) => report({ attempts, phase: 'matching', round }))) {
      if (meetsTarget(input, nonce, indices, challenge.difficulty_bits)) {
        return { ticket: challenge.ticket, nonce: bytesToHex(nonce), indices };
      }
    }
  }
  throw new Error('The puzzle took too long. Please try again.');
}

// Exported for interoperability fixtures and local benchmarks.
export { hexToBytes };
