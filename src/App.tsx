import { useEffect, useRef, useState } from 'preact/hooks';
import type { Dashboard, ExplorerBlock, Transaction, TransactionSelection } from './types';
import { isTransactionId, transactionPath } from './transaction-route';
import { blockPath, useExplorerRoute } from './explorer-route';
import { ExplorerLink } from './ExplorerLink';
import { BlockPage } from './BlockPage';
import { TransactionRow, TransactionSummary } from './TransactionRow';
import { JsonViewer } from './JsonViewer';
import { PoolInfoPage } from './PoolInfoPage';
import { Search } from './Search';
import { HashGlyph } from './HashGlyph';
import { StampMarks } from './StampView';
import { PoolMark } from './PoolMark';
import { FaucetPage } from './FaucetPage';
import { POOL_TYPES, durationUntil, epochProgress, formatBytes, formatZec, shortHash, transactionPools } from './lib';

const PAGE_SIZE = 8;
const SITE_PAGES = [
  { id: 'explorer', label: 'Explorer', href: '/' },
  { id: 'pool-info', label: 'Pool info', href: '/pool-info' },
  { id: 'faucet', label: 'Faucet', href: '/faucet' },
  { id: 'tutorial', label: 'Tutorial', href: '/tutorial' },
] as const;

function useClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

async function loadDashboard(page: number, signal?: AbortSignal): Promise<Dashboard> {
  const response = await fetch(`/api/dashboard?page=${page}&limit=${PAGE_SIZE}`, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Zakura RPC returned ${response.status}`);
  return data;
}

export function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<TransactionSelection | null>(null);
  const { txid, blockId, section, navigate } = useExplorerRoute();
  const showDashboard = section === 'explorer' || section === 'pool-info';
  const dashboardPage = section === 'pool-info' ? 1 : page;
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [animateStream, setAnimateStream] = useState(
    () => localStorage.getItem('tachyscan-stream-motion') !== 'off',
  );
  const [arrivalHeight, setArrivalHeight] = useState<number | null>(null);
  const previousHeight = useRef<number | null>(null);

  useEffect(() => {
    document.title = `${SITE_PAGES.find((item) => item.id === section)!.label} · Tachyscan`;
  }, [section]);

  useEffect(() => {
    setSelection(null);
    setTransactionError(null);
    if (txid === null) return;
    if (!isTransactionId(txid)) {
      setTransactionError('Invalid transaction ID. Use the full 64-character hexadecimal txid.');
      return;
    }

    const controller = new AbortController();
    const loadTransaction = async () => {
      try {
        const response = await fetch(`/api/transactions/${txid}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `Transaction lookup returned ${response.status}`);
        if (!controller.signal.aborted) setSelection(data);
      } catch (cause) {
        if (!controller.signal.aborted) setTransactionError((cause as Error).message);
      }
    };
    void loadTransaction();
    return () => controller.abort();
  }, [txid]);

  useEffect(() => {
    if (!showDashboard) return;
    const controller = new AbortController();
    setLoading(true);
    const refresh = async () => {
      try {
        const next = await loadDashboard(dashboardPage, controller.signal);
        if (controller.signal.aborted) return;
        setDashboard(next);
        setError(null);
      } catch (cause) {
        if (!controller.signal.aborted) setError((cause as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void refresh();
    const timer = dashboardPage === 1 ? window.setInterval(refresh, 6000) : undefined;
    return () => {
      controller.abort();
      if (timer) window.clearInterval(timer);
    };
  }, [dashboardPage, showDashboard]);

  useEffect(() => {
    if (!dashboard) return;
    if (
      previousHeight.current !== null
      && dashboard.height > previousHeight.current
      && animateStream
    ) {
      setArrivalHeight(dashboard.height);
    }
    previousHeight.current = dashboard.height;
  }, [dashboard?.height, animateStream]);

  const toggleStreamAnimation = () => {
    setAnimateStream((enabled) => {
      const next = !enabled;
      localStorage.setItem('tachyscan-stream-motion', next ? 'on' : 'off');
      return next;
    });
  };

  return (
    <div class="shell">
      <Header dashboard={showDashboard ? dashboard : null} onNavigate={navigate} />
      <nav class="site-navigation" aria-label="Main navigation">
        {SITE_PAGES.map((item) => (
          <ExplorerLink
            key={item.id}
            href={item.href}
            onNavigate={navigate}
            aria-current={section === item.id ? 'page' : undefined}
          >
            {item.label}
          </ExplorerLink>
        ))}
      </nav>
      <main class="page-content">
        {section === 'faucet' ? (
          <FaucetPage onNavigate={navigate} />
        ) : section === 'tutorial' ? (
          <TutorialPage />
        ) : (
          <>
            {section === 'explorer' && <PoolLegend />}
            {error && dashboard && <div class="stale-banner" role="status">Live refresh paused · {error}</div>}
            {!dashboard ? (
              loading ? <LoadingScreen /> : <ConnectionError message={error ?? 'Unable to reach Tachyscan'} />
            ) : section === 'pool-info' ? (
              <PoolInfoPage dashboard={dashboard} pulse={animateStream ? arrivalHeight : null} onNavigate={navigate} />
            ) : blockId !== null ? (
              <BlockPage key={blockId} id={blockId} network={dashboard.network} onNavigate={navigate} />
            ) : (
              <TransactionPanel
                dashboard={dashboard}
                onPage={setPage}
                selection={selection}
                txid={txid}
                transactionError={transactionError}
                onSelect={(selected) => navigate(transactionPath(selected.transaction.txid))}
                onBack={() => navigate('/')}
                onNavigate={navigate}
                animateStream={animateStream}
                arrivalHeight={arrivalHeight}
                onToggleAnimation={toggleStreamAnimation}
              />
            )}
          </>
        )}
      </main>
      <footer>
        <span>Tachyscan</span>
        {showDashboard && dashboard && <>
          <span class="footer-dot">◆</span>
          <span>{dashboard.network}</span>
          <span class={`live-dot ${dashboard.index.phase}`} />
          <span>{dashboard.index.phase === 'ready' ? 'index caught up' : dashboard.index.phase}</span>
        </>}
      </footer>
    </div>
  );
}

function Header({ dashboard, onNavigate }: { dashboard: Dashboard | null; onNavigate: (path: string) => void }) {
  const epoch = dashboard ? epochProgress(dashboard.height, dashboard.activationHeight, dashboard.epochLength) : null;
  return (
    <header>
      <div>
        <p class="eyebrow">TACHYON NETWORK OBSERVATORY</p>
        <h1><ExplorerLink class="brand-link" href="/" onNavigate={onNavigate}>Tachy<span>scan</span><i aria-hidden="true">✦</i></ExplorerLink></h1>
      </div>
      <div class="header-side">
        <Search onNavigate={onNavigate} />
        {dashboard && <div class="tip-stats">
          <ExplorerLink class="tip-block-link" href={blockPath(dashboard.bestBlockHash)} onNavigate={onNavigate}>
            <Stat label="Block" value={dashboard.height.toLocaleString()} />
          </ExplorerLink>
          <div class="stat-rule" />
          <Stat label="Epoch" value={epoch ? `${epoch.epoch.toLocaleString()} (${Math.floor(epoch.fraction * 100)}% in)` : 'inactive'} />
          <div class="stat-rule" />
          {typeof dashboard.tachyonPoolZat === 'number' && <>
            <Stat label="Tachyon pool" value={`${(dashboard.tachyonPoolZat / 100_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 })} ZEC`} title={formatZec(dashboard.tachyonPoolZat).replace(/^\+/, '')} />
            <div class="stat-rule" />
          </>}
          <div class="stat accumulator-stat">
            <span>Accumulator value</span>
            <strong title={dashboard.accumulator ?? undefined}>
              {dashboard.accumulator && <HashGlyph hash={dashboard.accumulator} size={18} />}
              {dashboard.accumulator ? shortHash(dashboard.accumulator, 12, 8) : 'indexing…'}
            </strong>
          </div>
        </div>}
      </div>
    </header>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div class="stat"><span>{label}</span><strong title={title}>{value}</strong></div>;
}

function TutorialPage() {
  return (
    <section class="panel tutorial-page" aria-labelledby="page-heading">
      <span class="page-mark" aria-hidden="true">✦</span>
      <p class="section-kicker">TACHYON ALPHA TESTNET</p>
      <h2 id="page-heading">Tutorial</h2>
      <p class="page-description">
        Create a wallet. Try Tachyon.
      </p>
      <p class="page-note">
        Follow the guide in the zcash-devtool README to set up your wallet,
        receive test funds, and send Tachyon payments.
      </p>
      <a class="back-button" href="https://github.com/tachyon-zcash/zcash-devtool#readme" target="_blank" rel="noopener noreferrer">
        Read the guide on GitHub ↗
      </a>
    </section>
  );
}

function PoolLegend() {
  return (
    <section class="legend" aria-label="Transaction type key">
      <p class="section-kicker">TRANSACTION TYPE KEY</p>
      <div>{POOL_TYPES.map((pool) => <span key={pool.key}><PoolMark pool={pool.key} size={16} />{pool.label}</span>)}</div>
    </section>
  );
}

function TransactionPanel({
  dashboard,
  onPage,
  selection,
  txid,
  transactionError,
  onSelect,
  onBack,
  onNavigate,
  animateStream,
  arrivalHeight,
  onToggleAnimation,
}: {
  dashboard: Dashboard;
  onPage: (page: number) => void;
  selection: TransactionSelection | null;
  txid: string | null;
  transactionError: string | null;
  onSelect: (selection: TransactionSelection) => void;
  onBack: () => void;
  onNavigate: (path: string) => void;
  animateStream: boolean;
  arrivalHeight: number | null;
  onToggleAnimation: () => void;
}) {
  const now = useClock();
  return (
    <section class="panel transactions-panel">
      <div class="transactions-head">
        <div>
          <p class="section-kicker">{txid !== null ? 'TRANSACTION DETAIL' : 'LIVE TRANSACTION STREAM'}</p>
          <h2>
            {txid !== null
              ? shortHash(txid, 18, 10)
              : dashboard.nextBlockEstimate && dashboard.nextBlockEstimate > now
                ? <>Next block in <span>{durationUntil(dashboard.nextBlockEstimate, now)}</span></>
                : <>Waiting for the next block</>}
          </h2>
        </div>
        <div class="stream-controls">
          <label class="motion-toggle">
            <span>Auto-scroll</span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Auto-scroll"
              checked={animateStream}
              onChange={onToggleAnimation}
            />
            <i aria-hidden="true" />
          </label>
          <span class="network-pill"><i />{dashboard.network}</span>
        </div>
      </div>
      {txid !== null ? (
        selection?.transaction.txid === txid ? (
          <SelectedTransactionView selection={selection} onBack={onBack} onNavigate={onNavigate} />
        ) : (
          <div class="selected-transaction">
            <button class="back-button" onClick={onBack}>← Back to live stream</button>
            <p class="no-transactions" role={transactionError ? 'alert' : 'status'}>
              {transactionError ?? 'Loading transaction…'}
            </p>
          </div>
        )
      ) : (
        <>
          <div class="column-head"><span>TxID</span><span>Value balance</span><span>Type</span></div>
          <div
            class={`block-list ${animateStream && arrivalHeight === dashboard.height ? 'new-block-arrival' : ''}`}
            key={arrivalHeight ?? 'initial-stream'}
          >
            {dashboard.blocks.map((block) => (
              <BlockGroup key={block.hash} block={block} tip={dashboard.height} onSelect={onSelect} onNavigate={onNavigate} />
            ))}
            {!dashboard.blocks.length && <div class="no-transactions">No blocks on this page.</div>}
          </div>
          <Pagination page={dashboard.page} pages={dashboard.pageCount} onPage={onPage} />
        </>
      )}
    </section>
  );
}

function BlockGroup({
  block,
  tip,
  onSelect,
  onNavigate,
}: {
  block: ExplorerBlock;
  tip: number;
  onSelect: (selection: TransactionSelection) => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <article class="block-group">
      <ExplorerLink class="block-heading block-link" href={blockPath(block.hash)} onNavigate={onNavigate}>
        <span>BLOCK <b>{block.height.toLocaleString()}</b></span>
        <span>{block.transactions.length} TX</span>
        <span>{Math.max(1, tip - block.height + 1)} CONF</span>
        <StampMarks transactions={block.transactions} />
        <span title={block.hash}><HashGlyph hash={block.hash} size={12} />{shortHash(block.hash, 8, 6)}</span>
      </ExplorerLink>
      {block.transactions.map((transaction, index) => (
        <TransactionRow
          key={transaction.txid}
          transaction={transaction}
          coinbase={index === 0}
          onSelect={() => onSelect({
            transaction,
            blockHeight: block.height,
            coinbase: index === 0,
          })}
        />
      ))}
    </article>
  );
}

function SelectedTransactionView({
  selection,
  onBack,
  onNavigate,
}: {
  selection: TransactionSelection;
  onBack: () => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <div class="selected-transaction">
      <button class="back-button" onClick={onBack}>← Back to live stream</button>
      <div class="block-heading">
        <span>{selection.blockHeight === null ? 'UNCONFIRMED' : (
          <ExplorerLink
            href={blockPath(typeof selection.transaction.blockhash === 'string' && isTransactionId(selection.transaction.blockhash)
              ? selection.transaction.blockhash : selection.blockHeight)}
            onNavigate={onNavigate}
          >BLOCK <b>{selection.blockHeight.toLocaleString()}</b></ExplorerLink>
        )}</span>
        <span>SELECTED TRANSACTION</span>
      </div>
      <div class="transaction open">
        <div class="transaction-row selected-row">
          <TransactionSummary
            transaction={selection.transaction}
            coinbase={selection.coinbase}
            marker="−"
          />
        </div>
        <TransactionDetails transaction={selection.transaction} />
      </div>
    </div>
  );
}

function TransactionDetails({ transaction }: { transaction: Transaction }) {
  const pools = transactionPools(transaction);
  return (
    <div class="transaction-details">
      <div class="detail-facts">
        <Detail label="Version" value={`V${transaction.version ?? '?'}`} />
        <Detail label="Size" value={transaction.size ? formatBytes(transaction.size) : '—'} />
        <Detail label="Pools" value={pools.join(' · ') || 'none'} />
        {transaction.tachyon && <Detail label="Tachyon actions" value={String(transaction.tachyon.actions?.length ?? 0)} />}
        {transaction.tachyon?.stamp?.type && <Detail label="Stamp" value={transaction.tachyon.stamp.type} />}
        {transaction.tachyon?.stamp?.anchor && <Detail label="Anchor" value={shortHash(transaction.tachyon.stamp.anchor, 10, 7)} title={transaction.tachyon.stamp.anchor} glyph={transaction.tachyon.stamp.anchor} />}
        {transaction.tachyon?.stamp?.coverage && <Detail label="Coverage digest" value={shortHash(transaction.tachyon.stamp.coverage, 10, 7)} title={transaction.tachyon.stamp.coverage} glyph={transaction.tachyon.stamp.coverage} />}
        {transaction.tachyon?.stamp?.tachygramSet && <Detail label="Tachygram set" value={shortHash(transaction.tachyon.stamp.tachygramSet, 10, 7)} title={transaction.tachyon.stamp.tachygramSet} glyph={transaction.tachyon.stamp.tachygramSet} />}
        {transaction.tachyon?.stamp?.aggregateId && <Detail label="Aggregate" value={shortHash(transaction.tachyon.stamp.aggregateId, 10, 7)} title={transaction.tachyon.stamp.aggregateId} glyph={transaction.tachyon.stamp.aggregateId} />}
        {transaction.tachyon?.stamp?.proof && <Detail label="Proof size" value={formatBytes(transaction.tachyon.stamp.proof.length / 2)} />}
        {transaction.tachyon?.stamp?.tachygrams && <Detail label="Tachygrams" value={String(transaction.tachyon.stamp.tachygrams.length)} />}
      </div>
      <JsonViewer key={transaction.txid} value={transaction} />
    </div>
  );
}

function Detail({ label, value, title, glyph }: { label: string; value: string; title?: string; glyph?: string }) {
  return <div><span>{label}</span><b title={title}>{glyph && <HashGlyph hash={glyph} size={12} />}{value}</b></div>;
}

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const candidates = Array.from(new Set([1, 2, page - 1, page, page + 1, pages - 1, pages].filter((value) => value >= 1 && value <= pages))).sort((a, b) => a - b);
  return (
    <nav class="pagination" aria-label="Block pages">
      <button disabled={page === 1} onClick={() => onPage(page - 1)}>←</button>
      {candidates.map((candidate, index) => <>
        {index > 0 && candidate - candidates[index - 1] > 1 && <span>…</span>}
        <button class={candidate === page ? 'active' : ''} onClick={() => onPage(candidate)}>{candidate}</button>
      </>)}
      <button disabled={page === pages} onClick={() => onPage(page + 1)}>→</button>
    </nav>
  );
}

function LoadingScreen() {
  return <div class="panel connection-state" role="status"><div class="loader-orbit" aria-hidden="true">✦</div><p>Finding the tip of spacetime…</p></div>;
}

function ConnectionError({ message }: { message: string }) {
  return <div class="panel connection-state error-screen" role="alert"><b>CONNECTION INTERRUPTED</b><p>{message}</p><button onClick={() => location.reload()}>Try again</button></div>;
}
