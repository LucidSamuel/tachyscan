import type { ExplorerBlock, Transaction, TransactionSelection } from './types';

export const POOL_TYPES = [
  { key: 'ironwood', emoji: '🍎', label: 'Ironwood' },
  { key: 'transparent', emoji: '👀', label: 'Transparent' },
  { key: 'orchard', emoji: '🍏', label: 'Orchard' },
  { key: 'sapling', emoji: '🌲', label: 'Sapling' },
  { key: 'sprout', emoji: '🌱', label: 'Sprout' },
  { key: 'tachyon', emoji: '💫', label: 'Tachyon' },
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

export function tachygramGradient(index: number): string {
  const start = [0xd4, 0xa0, 0x17];
  const end = [0x4a, 0x9e, 0xa0];
  const position = (index * 0.618_033_988_75) % 1;
  const channel = (from: number, to: number) => Math.round(from + (to - from) * position);
  return `rgb(${channel(start[0], end[0])} ${channel(start[1], end[1])} ${channel(start[2], end[2])})`;
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
