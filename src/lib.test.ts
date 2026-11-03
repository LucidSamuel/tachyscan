import { describe, expect, it } from 'vitest';
import {
  epochProgress,
  formatZec,
  indexLag,
  pruningDate,
  stampSummary,
  tachygramActivity,
  transactionForTachygram,
  transactionPools,
  transactionValueBalance,
} from './lib';

describe('transaction display', () => {
  it('orders pools to match the explorer type column', () => {
    expect(transactionPools({
      txid: 'abc',
      vin: [{}],
      ironwood: { actions: [{}] },
      tachyon: { actions: [], valueBalanceZat: 3 },
    })).toEqual(['ironwood', 'transparent', 'tachyon']);
  });
  it('totals the public shielded-pool value balances', () => {
    expect(transactionValueBalance({
      txid: 'abc',
      valueBalanceZat: 5,
      orchard: { valueBalanceZat: -2 },
      tachyon: { valueBalanceZat: 10 },
    })).toBe(13);
    expect(formatZec(13)).toBe('+0.00000013 ZEC');
  });
});

describe('epoch timing', () => {
  it('targets the first block of the next epoch', () => {
    const before = Date.now();
    const result = pruningDate(106, 100, 8, 10);
    expect(new Date(result!).getTime()).toBeGreaterThanOrEqual(before + 19_900);
    expect(new Date(result!).getTime()).toBeLessThanOrEqual(before + 20_100);
  });
});

describe('tachygram interactions', () => {
  it('locates the transaction that revealed a tachygram', () => {
    const selection = transactionForTachygram([{
      hash: 'block',
      height: 12,
      time: 0,
      transactions: [
        { txid: 'coinbase' },
        { txid: 'proof', tachyon: { stamp: { type: 'proof', tachygrams: ['abcd'] } } },
      ],
    }], 'abcd');

    expect(selection?.transaction.txid).toBe('proof');
    expect(selection?.blockHeight).toBe(12);
    expect(selection?.coinbase).toBe(false);
  });

});

describe('epoch instrument', () => {
  it('reports the epoch and one-based position of the tip', () => {
    expect(epochProgress(7, 8, 4096)).toBeNull();
    expect(epochProgress(8, 8, 4096)).toEqual({ epoch: 0, index: 1, length: 4096, fraction: 1 / 4096 });
    expect(epochProgress(8 + 4096 * 2 + 10, 8, 4096)).toMatchObject({ epoch: 2, index: 11 });
    expect(epochProgress(8 + 4095, 8, 4096)).toMatchObject({ epoch: 0, index: 4096, fraction: 1 });
  });
  it('counts tachygrams per block over the trailing window, oldest first', () => {
    const tachygrams = [
      { value: 'a', revealedHeight: 100 },
      { value: 'b', revealedHeight: 100 },
      { value: 'c', revealedHeight: 98 },
      { value: 'd', revealedHeight: 50 },
    ];
    expect(tachygramActivity(tachygrams, 100, 3)).toEqual([
      { height: 98, count: 1 },
      { height: 99, count: 0 },
      { height: 100, count: 2 },
    ]);
    expect(tachygramActivity([], 1, 5)).toHaveLength(2);
  });
});

describe('stamp summary', () => {
  it('separates proof stamps from pointers grouped by aggregate', () => {
    const summary = stampSummary([
      { txid: 'a', tachyon: { actions: [{}, {}], stamp: { type: 'proof', tachygrams: ['x', 'y', 'z'] } } },
      { txid: 'b', tachyon: { actions: [{}], stamp: { type: 'pointer', aggregateId: 'agg' } } },
      { txid: 'c', tachyon: { actions: [{}], stamp: { type: 'pointer', aggregateId: 'agg' } } },
      { txid: 'd', tachyon: { actions: [] } },
      { txid: 'e' },
    ]);
    expect(summary.proofs).toEqual([{ txid: 'a', tachygrams: 3, actions: 2, proofBytes: 0 }]);
    expect(summary.aggregates).toEqual([{ id: 'agg', txids: ['b', 'c'] }]);
    expect(summary.unstamped).toBe(1);
  });
});

describe('index lag', () => {
  it('reports how far a ready index trails the tip, and nothing while syncing', () => {
    expect(indexLag({ phase: 'ready', scannedHeight: 8202 }, 8203)).toBe(1);
    expect(indexLag({ phase: 'ready', scannedHeight: 8203 }, 8203)).toBe(0);
    expect(indexLag({ phase: 'syncing', scannedHeight: 100 }, 8203)).toBe(0);
    expect(indexLag({ phase: 'ready', scannedHeight: null }, 8203)).toBe(0);
  });
});
