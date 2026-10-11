import { useEffect, useState } from 'preact/hooks';
import type { BlockDetails } from './types';
import { blockPath, isBlockId } from './explorer-route';
import { transactionPath } from './transaction-route';
import { formatBytes, shortHash, transactionPools } from './lib';
import { ExplorerLink } from './ExplorerLink';
import { JsonViewer } from './JsonViewer';
import { TransactionRow } from './TransactionRow';

export function BlockPage({ id, network, onNavigate }: {
  id: string;
  network: string;
  onNavigate: (path: string) => void;
}) {
  const [block, setBlock] = useState<BlockDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBlock(null);
    setError(null);
    if (!isBlockId(id)) {
      setError('Invalid block ID. Use a full 64-character hexadecimal hash or a non-negative height.');
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/blocks/${id}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `Block lookup returned ${response.status}`);
        if (!controller.signal.aborted) setBlock(data);
      } catch (cause) {
        if (!controller.signal.aborted) setError((cause as Error).message);
      }
    };
    void load();
    return () => controller.abort();
  }, [id]);

  return (
    <section class="panel transactions-panel">
      <div class="transactions-head">
        <div>
          <p class="section-kicker">BLOCK DETAIL</p>
          <h2>Block {block ? block.height.toLocaleString() : shortHash(id, 12, 8)}</h2>
        </div>
        <span class="network-pill"><i />{network}</span>
      </div>
      <div class="selected-transaction">
        <ExplorerLink class="back-button" href="/" onNavigate={onNavigate}>← Back to live stream</ExplorerLink>
        {block ? <>
          <div class="block-detail-summary">
            <p class="section-kicker">BLOCK HASH</p>
            <ExplorerLink class="block-hash" href={blockPath(block.hash)} onNavigate={onNavigate}>{block.hash}</ExplorerLink>
            <dl class="block-facts">
              <div><dt>Timestamp (UTC)</dt><dd>{new Date(block.time * 1000).toISOString().replace('T', ' ').replace('.000Z', '')}</dd></div>
              <div><dt>Confirmations</dt><dd>{block.confirmations === -1 ? 'Not in main chain' : block.confirmations?.toLocaleString() ?? '—'}</dd></div>
              <div><dt>Size</dt><dd>{block.size === undefined ? '—' : formatBytes(block.size)}</dd></div>
              <div><dt>Transactions</dt><dd>{block.tx.length.toLocaleString()}</dd></div>
              <div><dt>Tachyon transactions</dt><dd>{block.tx.filter((tx) => transactionPools(tx).includes('tachyon')).length.toLocaleString()}</dd></div>
              <div><dt>Tachyon actions</dt><dd>{block.tx.reduce((count, tx) => count + (tx.tachyon?.actions?.length ?? 0), 0).toLocaleString()}</dd></div>
            </dl>
            <nav class="block-navigation" aria-label="Adjacent blocks">
              {block.height > 0 && block.previousblockhash
                ? <ExplorerLink href={blockPath(block.previousblockhash)} onNavigate={onNavigate}>← Previous block</ExplorerLink>
                : <span>Genesis block</span>}
              {block.nextblockhash
                ? <ExplorerLink href={blockPath(block.nextblockhash)} onNavigate={onNavigate}>Next block →</ExplorerLink>
                : <span>No next block at lookup</span>}
            </nav>
          </div>
          <div class="column-head"><span>TxID</span><span>Value balance</span><span>Type</span></div>
          {block.tx.map((transaction, index) => <TransactionRow
            key={transaction.txid}
            transaction={transaction}
            coinbase={index === 0}
            onSelect={() => onNavigate(transactionPath(transaction.txid))}
          />)}
          {!block.tx.length && <p class="no-transactions">No transactions in this block.</p>}
          <div class="block-detail-summary"><JsonViewer key={block.hash} value={block} subject="Block" /></div>
        </> : <p class="no-transactions" role={error ? 'alert' : 'status'}>{error ?? 'Loading block…'}</p>}
      </div>
    </section>
  );
}
