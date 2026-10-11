export function isTransactionId(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

export function transactionPath(txid: string): string {
  if (!isTransactionId(txid)) throw new Error('Expected a full 64-character transaction ID');
  return `/tx/${txid.toLowerCase()}`;
}

export function transactionIdFromPath(pathname: string): string | null {
  // Preserve malformed IDs so the detail view can explain the problem rather than show the stream.
  return pathname.startsWith('/tx/') ? pathname.slice(4).replace(/\/$/, '').toLowerCase() : null;
}
