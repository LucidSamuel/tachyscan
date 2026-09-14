import { describe, expect, it } from 'vitest';
import {
  formatZec,
  pruningDate,
  tachygramGradient,
  transactionForTachygram,
  transactionPools,
  transactionValueBalance,
} from './lib';

describe('transaction display', () => {
  it('orders pool emojis to match the explorer legend', () => {
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

  it('offsets adjacent brick colors across the requested gradient', () => {
    expect(tachygramGradient(0)).toBe('rgb(212 160 23)');
    expect(tachygramGradient(1)).toBe('rgb(127 159 108)');
    expect(tachygramGradient(2)).toBe('rgb(179 160 55)');
  });
});
