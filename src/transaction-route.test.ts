import { describe, expect, it } from 'vitest';
import { isTransactionId, transactionIdFromPath, transactionPath } from './transaction-route';

const txid = 'd9f7ca850a41a1821d' + '0'.repeat(36) + 'e38e5a3631';

describe('transaction permalinks', () => {
  it('includes all 64 characters and restores the selection from a direct URL', () => {
    expect(txid).toHaveLength(64);
    expect(transactionPath(txid)).toBe(`/tx/${txid}`);
    expect(transactionIdFromPath(transactionPath(txid))).toBe(txid);
  });

  it('normalizes uppercase IDs and accepts a trailing slash', () => {
    expect(transactionPath(txid.toUpperCase())).toBe(`/tx/${txid}`);
    expect(transactionIdFromPath(`/tx/${txid.toUpperCase()}/`)).toBe(txid);
  });

  it('restores the stream when navigating home', () => {
    expect(transactionIdFromPath('/')).toBeNull();
  });

  it.each(['', 'd9f7ca850a41a1821d…e38e5a3631', 'f'.repeat(63), 'f'.repeat(65), 'g'.repeat(64), `${txid}/extra`])(
    'rejects invalid IDs without silently showing the stream: %s', (invalid) => {
      expect(isTransactionId(invalid)).toBe(false);
      expect(() => transactionPath(invalid)).toThrow('64-character');
      expect(transactionIdFromPath(`/tx/${invalid}`)).not.toBeNull();
    },
  );
});
