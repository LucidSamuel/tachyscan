import { useEffect, useRef, useState } from 'preact/hooks';
import type { Dashboard, ExplorerBlock, Transaction, TransactionSelection } from './types';
import { isTransactionId, transactionPath } from './transaction-route';
import { blockPath, useExplorerRoute } from './explorer-route';
import { ExplorerLink } from './ExplorerLink';
import { BlockPage } from './BlockPage';
import { TransactionRow, TransactionSummary } from './TransactionRow';
import { JsonViewer } from './JsonViewer';
import { EpochPanel } from './EpochPanel';
import { Search } from './Search';
import { HashGlyph } from './HashGlyph';
import { StampMarks } from './StampView';
import { durationUntil, epochProgress, formatBytes, formatZec, shortHash, transactionPools } from './lib';

const PAGE_SIZE = 8;

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
  const { txid, blockId, navigate } = useExplorerRoute();
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [animateStream, setAnimateStream] = useState(
    () => localStorage.getItem('tachyscan-stream-motion') !== 'off',
  );
  const [arrivalHeight, setArrivalHeight] = useState<number | null>(null);
  const previousHeight = useRef<number | null>(null);

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
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const next = await loadDashboard(page, controller.signal);
        setDashboard(next);
        setError(null);
      } catch (cause) {
        if ((cause as Error).name !== 'AbortError') setError((cause as Error).message);
      } finally {
        setLoading(false);
      }
    };
    void refresh();
    const timer = page === 1 ? window.setInterval(refresh, 6000) : undefined;
    return () => {
      controller.abort();
      if (timer) window.clearInterval(timer);
    };
  }, [page]);

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

  if (!dashboard && loading) return <LoadingScreen />;
  if (!dashboard) return <ConnectionError message={error ?? 'Unable to reach Tachyscan'} />;

  const toggleStreamAnimation = () => {
    setAnimateStream((enabled) => {
      const next = !enabled;
      localStorage.setItem('tachyscan-stream-motion', next ? 'on' : 'off');
      return next;
    });
  };

  return (
    <main class="shell">
      <Header dashboard={dashboard} onNavigate={navigate} />
      {error && <div class="stale-banner">Live refresh paused · {error}</div>}
      <div class="dashboard-grid">
        <TachyonPanel dashboard={dashboard} pulse={animateStream ? arrivalHeight : null} onNavigate={navigate} />
        {blockId !== null ? (
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
      </div>
      <footer>
        <span>Tachyscan</span>
        <span class="footer-dot">◆</span>
        <span>{dashboard.network}</span>
        <span class={`live-dot ${dashboard.index.phase}`} />
        <span>{dashboard.index.phase === 'ready' ? 'index caught up' : dashboard.index.phase}</span>
      </footer>
    </main>
  );
}

function Header({ dashboard, onNavigate }: { dashboard: Dashboard; onNavigate: (path: string) => void }) {
  const epoch = epochProgress(dashboard.height, dashboard.activationHeight, dashboard.epochLength);
  return (
    <header>
      <div>
        <p class="eyebrow">TACHYON NETWORK OBSERVATORY</p>
        <h1>Tachy<span>scan</span><i>✦</i></h1>
      </div>
      <div class="header-side">
        <Search onNavigate={onNavigate} />
        <div class="tip-stats">
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
        </div>
      </div>
    </header>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div class="stat"><span>{label}</span><strong title={title}>{value}</strong></div>;
}

function TachyonPanel({ dashboard, pulse, onNavigate }: {
  dashboard: Dashboard;
  pulse: number | null;
  onNavigate: (path: string) => void;
}) {
  const now = useClock();
  return (
    <aside class="tachyon-panel">
      <EpochPanel dashboard={dashboard} now={now} pulse={pulse} onNavigate={onNavigate} />
      <section class="footprint-section">
        <p class="section-kicker">TACHYGRAM PAYLOAD FOOTPRINT</p>
        <h2>{formatBytes(dashboard.footprintBytes)}</h2>
        <FootprintChart dashboard={dashboard} />
      </section>
    </aside>
  );
}

function FootprintChart({ dashboard }: { dashboard: Dashboard }) {
  const points = dashboard.footprintHistory;
  const [hover, setHover] = useState<number | null>(null);
  const width = 620;
  const height = 270;
  const inset = 22;
  const minHeight = points[0]?.height ?? dashboard.activationHeight;
  const maxHeight = points.at(-1)?.height ?? dashboard.height;
  const maxBytes = Math.max(32, ...points.map((point) => point.bytes));
  const x = (block: number) => inset + ((block - minHeight) / Math.max(1, maxHeight - minHeight)) * (width - inset * 2);
  const y = (bytes: number) => height - inset - (bytes / maxBytes) * (height - inset * 2);
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.height)} ${y(point.bytes)}`).join(' ');
  const firstBoundary = dashboard.activationHeight + Math.ceil((minHeight - dashboard.activationHeight) / dashboard.epochLength) * dashboard.epochLength;
  const boundaries: number[] = [];
  for (let boundary = firstBoundary; boundary <= maxHeight; boundary += dashboard.epochLength) boundaries.push(boundary);

  const locate = (event: PointerEvent) => {
    if (!points.length) return;
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const block = minHeight + ((event.clientX - box.left) / box.width * width - inset) / (width - inset * 2) * (maxHeight - minHeight);
    let nearest = 0;
    for (let index = 1; index < points.length; index += 1) {
      if (Math.abs(points[index].height - block) < Math.abs(points[nearest].height - block)) nearest = index;
    }
    setHover(nearest);
  };
  const focus = hover === null ? null : points[hover];

  return (
    <div class="chart-frame">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Tachygram payload footprint over block height"
        onPointerMove={locate}
        onPointerLeave={() => setHover(null)}
      >
        <line class="axis" x1={inset} x2={inset} y1={inset} y2={height - inset} />
        <line class="axis" x1={inset} x2={width - inset} y1={height - inset} y2={height - inset} />
        {boundaries.map((boundary) => <line class="epoch-line" x1={x(boundary)} x2={x(boundary)} y1={inset} y2={height - inset} />)}
        {path && <path class="footprint-line" d={path} />}
        {points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 22)) === 0).map((point) => (
          <circle class="footprint-point" cx={x(point.height)} cy={y(point.bytes)} r="3.6" />
        ))}
        {focus && <>
          <line class="chart-cursor" x1={x(focus.height)} x2={x(focus.height)} y1={inset} y2={height - inset} />
          <circle class="chart-cursor-point" cx={x(focus.height)} cy={y(focus.bytes)} r="5" />
        </>}
      </svg>
      <div class="chart-caption">
        {focus
          ? <><span>BLOCK {focus.height.toLocaleString()}</span><span class="chart-readout">{formatBytes(focus.bytes)} retained</span><span>{maxHeight.toLocaleString()}</span></>
          : <><span>BLOCK {minHeight.toLocaleString()}</span><span>{boundaries.length ? 'epoch boundary ┊' : ''}</span><span>{maxHeight.toLocaleString()}</span></>}
      </div>
      {dashboard.index.phase === 'syncing' && (
        <div class="index-progress">
          <span style={{ width: `${Math.max(2, ((dashboard.index.scannedHeight ?? dashboard.activationHeight) - dashboard.activationHeight) / Math.max(1, dashboard.index.targetHeight - dashboard.activationHeight) * 100)}%` }} />
          <b>Reconstructing accumulator · {dashboard.index.scannedHeight?.toLocaleString() ?? 'starting'} / {dashboard.index.targetHeight.toLocaleString()}</b>
        </div>
      )}
    </div>
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
  return <div class="full-screen"><div class="loader-orbit">✦</div><h1>Tachy<span>scan</span></h1><p>Finding the tip of spacetime…</p></div>;
}

function ConnectionError({ message }: { message: string }) {
  return <div class="full-screen error-screen"><b>CONNECTION INTERRUPTED</b><h1>Tachy<span>scan</span></h1><p>{message}</p><button onClick={() => location.reload()}>Try again</button></div>;
}
