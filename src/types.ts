export interface Dashboard {
  network: string;
  height: number;
  bestBlockHash: string;
  activationHeight: number;
  epochLength: number;
  blockTargetSeconds: number;
  nextBlockEstimate: number | null;
  accumulator: string | null;
  retainedTachygramCount: number;
  tachygrams: Tachygram[];
  footprintBytes: number;
  footprintHistory: FootprintPoint[];
  index: IndexStatus;
  blocks: ExplorerBlock[];
  page: number;
  pageCount: number;
}

export interface Tachygram {
  value: string;
  revealedHeight: number;
}

export interface TransactionSelection {
  transaction: Transaction;
  blockHeight: number | null;
  coinbase: boolean;
}

export interface FootprintPoint {
  height: number;
  bytes: number;
}

export interface IndexStatus {
  phase: 'idle' | 'syncing' | 'ready' | 'error';
  scannedHeight: number | null;
  targetHeight: number;
  message?: string;
}

export interface ExplorerBlock {
  hash: string;
  height: number;
  time: number;
  transactions: Transaction[];
}

export interface Transaction {
  txid: string;
  version?: number;
  size?: number;
  vin?: unknown[];
  vout?: unknown[];
  vShieldedSpend?: unknown[];
  vShieldedOutput?: unknown[];
  vjoinsplit?: unknown[];
  valueBalanceZat?: number;
  orchard?: ShieldedBundle;
  ironwood?: ShieldedBundle;
  tachyon?: TachyonBundle;
  [key: string]: unknown;
}

export interface ShieldedBundle {
  actions?: unknown[];
  valueBalanceZat?: number;
  [key: string]: unknown;
}

export interface TachyonBundle extends ShieldedBundle {
  stamp?: {
    type?: 'proof' | 'pointer';
    anchor?: string;
    tachygrams?: string[];
    [key: string]: unknown;
  };
}
