import type { ExplorerBlock, Tachygram, Transaction, TransactionSelection } from './types';

export const POOL_TYPES = [
  { key: 'ironwood', label: 'Ironwood' },
  { key: 'transparent', label: 'Transparent' },
  { key: 'orchard', label: 'Orchard' },
  { key: 'sapling', label: 'Sapling' },
  { key: 'sprout', label: 'Sprout' },
  { key: 'tachyon', label: 'Tachyon' },
] as const;

export function transactionPools(tx: Transaction): string[] {
  const has = {
    transparent: Boolean(tx.vin?.length || tx.vout?.length),
    sapling: Boolean(tx.vShieldedSpend?.length || tx.vShieldedOutput?.length),
    sprout: Boolean(tx.vjoinsplit?.length),
    orchard: Boolean(tx.orchard?.actions?.length),
    ironwood: Boolean(tx.ironwood?.actions?.length),
    tachyon: Boolean(tx.tachyon),
  };

  return POOL_TYPES.filter(({ key }) => has[key]).map(({ key }) => key);
}

export function transactionValueBalance(tx: Transaction): number | null {
  const values = [
    tx.valueBalanceZat,
    tx.orchard?.valueBalanceZat,
    tx.ironwood?.valueBalanceZat,
    tx.tachyon?.valueBalanceZat,
  ].filter((value): value is number => typeof value === 'number');

  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

export function transactionForTachygram(
  blocks: ExplorerBlock[],
  tachygram: string,
): TransactionSelection | null {
  for (const block of blocks) {
    const transactionIndex = block.transactions.findIndex((transaction) =>
      transaction.tachyon?.stamp?.tachygrams?.includes(tachygram),
    );
    if (transactionIndex >= 0) {
      return {
        transaction: block.transactions[transactionIndex],
        blockHeight: block.height,
        coinbase: transactionIndex === 0,
      };
    }
  }
  return null;
}

export function formatZec(zatoshis: number | null): string {
  if (zatoshis === null) return '—';
  const zec = zatoshis / 100_000_000;
  const sign = zec > 0 ? '+' : '';
  return `${sign}${zec.toLocaleString(undefined, { maximumFractionDigits: 8 })} ZEC`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

export function shortHash(hash: string, leading = 9, trailing = 6): string {
  if (hash.length <= leading + trailing + 1) return hash;
  return `${hash.slice(0, leading)}…${hash.slice(-trailing)}`;
}

export function durationUntil(date: string | number | null, now = Date.now()): string {
  if (!date) return 'estimating…';
  let seconds = Math.max(0, Math.round((new Date(date).getTime() - now) / 1000));
  const days = Math.floor(seconds / 86_400);
  seconds %= 86_400;
  const hours = Math.floor(seconds / 3_600);
  seconds %= 3_600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  return [days && `${days}d`, (days || hours) && `${hours}h`, (days || hours || minutes) && `${minutes}m`, `${seconds}s`]
    .filter(Boolean)
    .join(' ');
}

export function pruningDate(
  height: number,
  activationHeight: number,
  epochLength: number,
  blockSeconds: number,
): string | null {
  if (height < activationHeight || blockSeconds <= 0) return null;
  const poolHeight = height - activationHeight;
  const blocksRemaining = epochLength - (poolHeight % epochLength);
  return new Date(Date.now() + blocksRemaining * blockSeconds * 1000).toISOString();
}

/** Blocks shown in the per-block tachygram activity strip. */
export const ACTIVITY_WINDOW = 96;

export interface EpochProgress {
  /** Zero-based epoch index since activation. */
  epoch: number;
  /** One-based position of the tip inside its epoch. */
  index: number;
  length: number;
  fraction: number;
}

export function epochProgress(height: number, activationHeight: number, epochLength: number): EpochProgress | null {
  if (height < activationHeight || epochLength <= 0) return null;
  const poolHeight = height - activationHeight;
  const index = (poolHeight % epochLength) + 1;
  return { epoch: Math.floor(poolHeight / epochLength), index, length: epochLength, fraction: index / epochLength };
}

/** Tachygrams revealed per block over the `window` blocks ending at `tip`, oldest first. */
export function tachygramActivity(tachygrams: Tachygram[], tip: number, window: number): { height: number; count: number }[] {
  const from = Math.max(0, tip - window + 1);
  const counts = new Map<number, number>();
  for (const { revealedHeight } of tachygrams) {
    if (revealedHeight >= from && revealedHeight <= tip) counts.set(revealedHeight, (counts.get(revealedHeight) ?? 0) + 1);
  }
  return Array.from({ length: tip - from + 1 }, (_, offset) => ({ height: from + offset, count: counts.get(from + offset) ?? 0 }));
}

/** A colour between the gold and ivory accents chosen by the hash's last byte. */
export function hashTint(hash: string): string {
  const byte = parseInt(hash.slice(-2), 16);
  const position = Number.isNaN(byte) ? 0 : byte / 255;
  const start = [0xe5, 0xb9, 0x1a];
  const end = [0xf1, 0xe3, 0xbd];
  const channel = (from: number, to: number) => Math.round(from + (to - from) * position);
  return `rgb(${channel(start[0], end[0])} ${channel(start[1], end[1])} ${channel(start[2], end[2])})`;
}

export interface ProofStampRef {
  txid: string;
  tachygrams: number;
  actions: number;
  /** Serialized proof size, when the node includes the proof bytes. */
  proofBytes: number;
}

export interface AggregateRef {
  id: string;
  txids: string[];
}

export interface StampSummary {
  proofs: ProofStampRef[];
  aggregates: AggregateRef[];
  /** Tachyon transactions carrying neither stamp kind (unexpected, shown for honesty). */
  unstamped: number;
}

/** How a block's Tachyon transactions are stamped: proof stamps carry the tachygrams and the
 *  proof; pointer stamps defer to an aggregate the node built from several transactions. */
export function stampSummary(transactions: Transaction[]): StampSummary {
  const proofs: ProofStampRef[] = [];
  const aggregates = new Map<string, string[]>();
  let unstamped = 0;
  for (const transaction of transactions) {
    const bundle = transaction.tachyon;
    if (!bundle) continue;
    const stamp = bundle.stamp;
    if (stamp?.type === 'proof') {
      proofs.push({
        txid: transaction.txid,
        tachygrams: stamp.tachygrams?.length ?? 0,
        actions: bundle.actions?.length ?? 0,
        proofBytes: typeof stamp.proof === 'string' ? stamp.proof.length / 2 : 0,
      });
    } else if (stamp?.type === 'pointer' && typeof stamp.aggregateId === 'string') {
      aggregates.set(stamp.aggregateId, [...(aggregates.get(stamp.aggregateId) ?? []), transaction.txid]);
    } else {
      unstamped += 1;
    }
  }
  return { proofs, aggregates: [...aggregates].map(([id, txids]) => ({ id, txids })), unstamped };
}

/** Blocks the explorer's tachygram index trails the chain tip by while it still reports ready. */
export function indexLag(status: { phase: string; scannedHeight: number | null }, height: number): number {
  if (status.phase !== 'ready' || status.scannedHeight === null) return 0;
  return Math.max(0, height - status.scannedHeight);
}
