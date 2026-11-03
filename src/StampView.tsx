import type { Transaction } from './types';
import { transactionPath } from './transaction-route';
import { ExplorerLink } from './ExplorerLink';
import { HashGlyph } from './HashGlyph';
import { formatBytes, shortHash, stampSummary } from './lib';

/** Tiny marks for a block heading: one filled mark per proof stamp, one hollow per pointer. */
export function StampMarks({ transactions }: { transactions: Transaction[] }) {
  const summary = stampSummary(transactions);
  const pointers = summary.aggregates.reduce((count, aggregate) => count + aggregate.txids.length, 0);
  if (!summary.proofs.length && !pointers) return null;
  const title = `${summary.proofs.length} proof stamp${summary.proofs.length === 1 ? '' : 's'}, ${pointers} pointer stamp${pointers === 1 ? '' : 's'}`;
  return (
    <span class="stamp-marks" title={title} aria-label={title}>
      {summary.proofs.map((proof) => <i key={proof.txid} class="proof" />)}
      {summary.aggregates.map((aggregate) => aggregate.txids.map((txid) => <i key={txid} class="pointer" />))}
    </span>
  );
}

/** How the node stamped this block: proof stamps carry tachygrams and a proof; pointer
 *  stamps reference an aggregate instead of carrying their own. */
export function StampView({ transactions, onNavigate }: {
  transactions: Transaction[];
  onNavigate: (path: string) => void;
}) {
  const summary = stampSummary(transactions);
  const pointers = summary.aggregates.reduce((count, aggregate) => count + aggregate.txids.length, 0);
  if (!summary.proofs.length && !pointers) return null;
  return (
    <section class="stamp-view" aria-label="Proof stamps in this block">
      <p class="section-kicker">PROOF STAMPS</p>
      <div class="stamp-columns">
        <div class="stamp-column">
          <h3>{summary.proofs.length} proof stamp{summary.proofs.length === 1 ? '' : 's'}</h3>
          {summary.proofs.length ? summary.proofs.map((proof) => (
            <ExplorerLink key={proof.txid} class="stamp-card proof" href={transactionPath(proof.txid)} onNavigate={onNavigate}>
              <HashGlyph hash={proof.txid} size={22} />
              <span class="stamp-id" title={proof.txid}>{shortHash(proof.txid, 10, 6)}</span>
              <span class="stamp-meta">{proof.tachygrams} tachygrams, {proof.actions} action{proof.actions === 1 ? '' : 's'}{proof.proofBytes ? `, ${formatBytes(proof.proofBytes)} proof` : ''}</span>
            </ExplorerLink>
          )) : <p class="stamp-none">None. Every Tachyon transaction here points at an aggregate.</p>}
        </div>
        <div class="stamp-column">
          <h3>{pointers} pointer stamp{pointers === 1 ? '' : 's'}</h3>
          {summary.aggregates.length ? summary.aggregates.map((aggregate) => (
            <div key={aggregate.id} class="aggregate-group">
              <div class="aggregate-head" title={aggregate.id}>
                <HashGlyph hash={aggregate.id} size={22} />
                <span>aggregate {shortHash(aggregate.id, 8, 6)}</span>
              </div>
              <ul>
                {aggregate.txids.map((txid) => (
                  <li key={txid}>
                    <ExplorerLink class="stamp-card pointer" href={transactionPath(txid)} onNavigate={onNavigate}>
                      <HashGlyph hash={txid} size={16} />
                      <span class="stamp-id" title={txid}>{shortHash(txid, 10, 6)}</span>
                    </ExplorerLink>
                  </li>
                ))}
              </ul>
            </div>
          )) : <p class="stamp-none">None. Every Tachyon transaction here carries its own proof.</p>}
        </div>
      </div>
      {summary.unstamped > 0 && <p class="stamp-none">{summary.unstamped} Tachyon transaction{summary.unstamped === 1 ? '' : 's'} without a stamp.</p>}
    </section>
  );
}
