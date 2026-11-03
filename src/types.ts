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
  /** Tachyon pool balance after the tip, when the node reports value pools. */
  tachyonPoolZat?: number | null;
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

/** The full verbose getblock response, including fields not displayed in the summary. */
export interface BlockDetails {
  hash: string;
  height: number;
  time: number;
  tx: Transaction[];
  confirmations?: number;
  size?: number;
  previousblockhash?: string;
  nextblockhash?: string;
  [key: string]: unknown;
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
    coverage?: string;
    tachygramSet?: string;
    proof?: string;
    /** Pointer stamps name the aggregate whose proof stamp covers them. */
    aggregateId?: string;
    [key: string]: unknown;
  };
}
