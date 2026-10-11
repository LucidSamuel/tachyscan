import type { Transaction } from './types';
import { transactionPath } from './transaction-route';
import { ExplorerLink } from './ExplorerLink';
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
      <span class="txid"><i>{marker}</i><b title={transaction.txid}>{shortHash(transaction.txid, 12, 7)}</b>{coinbase && <em>COINBASE</em>}</span>
      <span class={balance && balance < 0 ? 'negative' : ''}>{formatZec(balance)}</span>
      <span class="pool-emojis">
        {pools.map((key) => {
          const pool = POOL_TYPES.find((item) => item.key === key)!;
          return <i key={key} title={pool.label} aria-label={pool.label}>{pool.emoji}</i>;
        })}
      </span>
    </>
  );
}
