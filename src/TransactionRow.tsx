import type { Transaction } from './types';
import { transactionPath } from './transaction-route';
import { ExplorerLink } from './ExplorerLink';
import { HashGlyph } from './HashGlyph';
import { PoolMark } from './PoolMark';
import { POOL_TYPES, formatZec, shortHash, transactionPools, transactionValueBalance } from './lib';

export function TransactionRow({ transaction, coinbase, onSelect }: {
  transaction: Transaction;
  coinbase: boolean;
  onSelect: () => void;
}) {
  return (
    <div class="transaction">
      <ExplorerLink class="transaction-row" href={transactionPath(transaction.txid)} onNavigate={onSelect}>
        <TransactionSummary transaction={transaction} coinbase={coinbase} marker="+" />
      </ExplorerLink>
    </div>
  );
}

export function TransactionSummary({ transaction, coinbase, marker }: {
  transaction: Transaction;
  coinbase: boolean;
  marker: string;
}) {
  const pools = transactionPools(transaction);
  const balance = transactionValueBalance(transaction);
  return (
    <>
      <span class="txid"><i class={marker === '−' ? 'open' : ''}><HashGlyph hash={transaction.txid} size={14} /></i><b title={transaction.txid}>{shortHash(transaction.txid, 12, 7)}</b>{coinbase && <em>COINBASE</em>}</span>
      <span class={balance && balance < 0 ? 'negative' : ''}>{formatZec(balance)}</span>
      <span class="pool-chips">
        {pools.map((key) => {
          const pool = POOL_TYPES.find((item) => item.key === key)!;
          return <i key={key} class={`pool-chip ${key}`} title={pool.label}><PoolMark pool={key} /><span>{pool.label}</span></i>;
        })}
      </span>
    </>
  );
}
