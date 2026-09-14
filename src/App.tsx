import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Dashboard, ExplorerBlock, Transaction, TransactionSelection } from './types';
import {
  POOL_TYPES,
  durationUntil,
  formatBytes,
  formatZec,
  pruningDate,
  shortHash,
  tachygramGradient,
  transactionForTachygram,
  transactionPools,
  transactionValueBalance,
} from './lib';

const PAGE_SIZE = 8;
const TACHYGRAM_STAGGER_MS = 65;

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
  const [animateStream, setAnimateStream] = useState(
    () => localStorage.getItem('tachyscan-stream-motion') !== 'off',
  );
  const [arrivalHeight, setArrivalHeight] = useState<number | null>(null);
  const previousHeight = useRef<number | null>(null);

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

  const selectTachygram = (tachygram: string) => {
    const matchingTransaction = transactionForTachygram(dashboard.blocks, tachygram);
    if (matchingTransaction) setSelection(matchingTransaction);
  };
  const toggleStreamAnimation = () => {
    setAnimateStream((enabled) => {
      const next = !enabled;
      localStorage.setItem('tachyscan-stream-motion', next ? 'on' : 'off');
      return next;
    });
  };

  return (
    <main class="shell">
      <Header dashboard={dashboard} />
      {error && <div class="stale-banner">Live refresh paused · {error}</div>}
      <div class="dashboard-grid">
        <TachyonPanel dashboard={dashboard} onSelectTachygram={selectTachygram} />
        <TransactionPanel
          dashboard={dashboard}
          onPage={setPage}
          selection={selection}
          onSelect={setSelection}
          onBack={() => setSelection(null)}
          animateStream={animateStream}
          arrivalHeight={arrivalHeight}
          onToggleAnimation={toggleStreamAnimation}
        />
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

function Header({ dashboard }: { dashboard: Dashboard }) {
  return (
    <header>
      <div>
        <p class="eyebrow">TACHYON NETWORK OBSERVATORY</p>
        <h1>Tachy<span>scan</span><i>✦</i></h1>
      </div>
      <div class="tip-stats">
        <Stat label="Block" value={dashboard.height.toLocaleString()} />
        <div class="stat-rule" />
        <Stat
          label="Accumulator value"
          value={dashboard.accumulator ? shortHash(dashboard.accumulator, 12, 8) : 'indexing…'}
          title={dashboard.accumulator ?? undefined}
        />
      </div>
    </header>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div class="stat"><span>{label}</span><strong title={title}>{value}</strong></div>;
}

function TachyonPanel({
  dashboard,
  onSelectTachygram,
}: {
  dashboard: Dashboard;
  onSelectTachygram: (tachygram: string) => void;
}) {
  const now = useClock();
  const brickLayout = useRef<HTMLDivElement>(null);
  const previousBrickPositions = useRef(new Map<string, DOMRect>());
  const visibleTachygrams = dashboard.tachygrams.slice(0, 42);
  const brickSequence = visibleTachygrams.map((tachygram) => tachygram.value).join(':');

  useLayoutEffect(() => {
    const layout = brickLayout.current;
    if (!layout) return;

    const nextPositions = new Map<string, DOMRect>();
    const hasPreviousLayout = previousBrickPositions.current.size > 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let arrivingBrickIndex = 0;
    layout.querySelectorAll<HTMLElement>('[data-tachygram]').forEach((brick) => {
      const tachygram = brick.dataset.tachygram;
      if (!tachygram) return;

      const nextPosition = brick.getBoundingClientRect();
      nextPositions.set(tachygram, nextPosition);
      const previousPosition = previousBrickPositions.current.get(tachygram);
      if (reducedMotion) return;

      brick.getAnimations().forEach((animation) => animation.cancel());
      if (!previousPosition) {
        if (!hasPreviousLayout) return;

        brick.animate(
          [
            { opacity: 0, scale: 0.78, translate: '0 -10px' },
            { opacity: 1, scale: 1, translate: '0 0' },
          ],
          {
            duration: 260,
            delay: arrivingBrickIndex * TACHYGRAM_STAGGER_MS,
            easing: 'cubic-bezier(.18,.82,.3,1)',
            fill: 'backwards',
          },
        );
        arrivingBrickIndex += 1;
        return;
      }

      const horizontalShift = previousPosition.left - nextPosition.left;
      const verticalShift = previousPosition.top - nextPosition.top;
      if (horizontalShift === 0 && verticalShift === 0) return;

      brick.animate(
        [
          { translate: `${horizontalShift}px ${verticalShift}px` },
          { translate: '0 0' },
        ],
        {
          duration: 520,
          easing: 'cubic-bezier(.2,.76,.25,1)',
        },
      );
    });
    previousBrickPositions.current = nextPositions;
  }, [brickSequence]);

  const pruneAt = useMemo(
    () => pruningDate(dashboard.height, dashboard.activationHeight, dashboard.epochLength, dashboard.blockTargetSeconds),
    [dashboard.height, dashboard.activationHeight, dashboard.epochLength, dashboard.blockTargetSeconds],
  );
  return (
    <aside class="tachyon-panel">
      <section class="panel tachygram-vault">
        <div class="panel-label"><span>RETAINED TACHYGRAMS</span><b>{dashboard.retainedTachygramCount.toLocaleString()}</b></div>
        <div class="brick-field" aria-label={`${dashboard.retainedTachygramCount} retained Tachygrams`}>
          {visibleTachygrams.length ? (
            <div class="brick-layout" ref={brickLayout}>
              {visibleTachygrams.map((tachygram, index) => {
                const selection = transactionForTachygram(dashboard.blocks, tachygram.value);
                return (
                  <button
                    key={tachygram.value}
                    data-tachygram={tachygram.value}
                    class={`tachy-brick ${selection ? 'linked' : ''}`}
                    style={{
                      '--offset': `${(index % 3) * 8}px`,
                      '--brick-color': tachygramGradient(index),
                    }}
                    title={`${tachygram.value}\nRevealed at block ${tachygram.revealedHeight}${selection ? '\nOpen transaction' : ''}`}
                    onClick={() => {
                      if (selection) onSelectTachygram(tachygram.value);
                      else void navigator.clipboard?.writeText(tachygram.value);
                    }}
                  >
                    {shortHash(tachygram.value, 8, 4)}
                  </button>
                );
              })}
            </div>
          ) : <div class="empty-vault">Waiting for proof stamps <span>💫</span></div>}
        </div>
      </section>
      <div class="prune-line">
        <span>Pruning in</span>
        <strong>{durationUntil(pruneAt, now)}</strong>
      </div>
      <section class="footprint-section">
        <p class="section-kicker">TACHYGRAM PAYLOAD FOOTPRINT</p>
        <h2>{formatBytes(dashboard.footprintBytes)}</h2>
        <FootprintChart dashboard={dashboard} />
      </section>
      <PoolLegend />
    </aside>
  );
}

function FootprintChart({ dashboard }: { dashboard: Dashboard }) {
  const points = dashboard.footprintHistory;
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

  return (
    <div class="chart-frame">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tachygram payload footprint over block height">
        <line class="axis" x1={inset} x2={inset} y1={inset} y2={height - inset} />
        <line class="axis" x1={inset} x2={width - inset} y1={height - inset} y2={height - inset} />
        {boundaries.map((boundary) => <line class="epoch-line" x1={x(boundary)} x2={x(boundary)} y1={inset} y2={height - inset} />)}
        {path && <path class="footprint-line" d={path} />}
        {points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 22)) === 0).map((point) => (
          <circle class="footprint-point" cx={x(point.height)} cy={y(point.bytes)} r="3.6" />
        ))}
      </svg>
      <div class="chart-caption"><span>BLOCK {minHeight.toLocaleString()}</span><span>epoch boundary ┊</span><span>{maxHeight.toLocaleString()}</span></div>
      {dashboard.index.phase === 'syncing' && (
        <div class="index-progress">
          <span style={{ width: `${Math.max(2, ((dashboard.index.scannedHeight ?? dashboard.activationHeight) - dashboard.activationHeight) / Math.max(1, dashboard.index.targetHeight - dashboard.activationHeight) * 100)}%` }} />
          <b>Reconstructing accumulator · {dashboard.index.scannedHeight?.toLocaleString() ?? 'starting'} / {dashboard.index.targetHeight.toLocaleString()}</b>
        </div>
      )}
    </div>
  );
}

function PoolLegend() {
  return (
    <section class="legend">
      <p class="section-kicker">TRANSACTION TYPE KEY</p>
      <div>{POOL_TYPES.map((pool) => <span><b>{pool.emoji}</b>{pool.label}</span>)}</div>
    </section>
  );
}

function TransactionPanel({
  dashboard,
  onPage,
  selection,
  onSelect,
  onBack,
  animateStream,
  arrivalHeight,
  onToggleAnimation,
}: {
  dashboard: Dashboard;
  onPage: (page: number) => void;
  selection: TransactionSelection | null;
  onSelect: (selection: TransactionSelection) => void;
  onBack: () => void;
  animateStream: boolean;
  arrivalHeight: number | null;
  onToggleAnimation: () => void;
}) {
  const now = useClock();
  return (
    <section class="panel transactions-panel">
      <div class="transactions-head">
        <div>
          <p class="section-kicker">{selection ? 'TRANSACTION DETAIL' : 'LIVE TRANSACTION STREAM'}</p>
          <h2>
            {selection
              ? shortHash(selection.transaction.txid, 18, 10)
              : <>Next block in <span>{durationUntil(dashboard.nextBlockEstimate, now)}</span></>}
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
      {selection ? (
        <SelectedTransactionView selection={selection} onBack={onBack} />
      ) : (
        <>
          <div class="column-head"><span>TxID</span><span>Value balance</span><span>Type</span></div>
          <div
            class={`block-list ${animateStream && arrivalHeight === dashboard.height ? 'new-block-arrival' : ''}`}
            key={arrivalHeight ?? 'initial-stream'}
          >
            {dashboard.blocks.map((block) => (
              <BlockGroup block={block} tip={dashboard.height} onSelect={onSelect} />
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
}: {
  block: ExplorerBlock;
  tip: number;
  onSelect: (selection: TransactionSelection) => void;
}) {
  return (
    <article class="block-group">
      <div class="block-heading">
        <span>BLOCK <b>{block.height.toLocaleString()}</b></span>
        <span>{block.transactions.length} TX</span>
        <span>{Math.max(1, tip - block.height + 1)} CONF</span>
        <span title={block.hash}>{shortHash(block.hash, 8, 6)}</span>
      </div>
      {block.transactions.map((transaction, index) => (
        <TransactionRow
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

function TransactionRow({
  transaction,
  coinbase,
  onSelect,
}: {
  transaction: Transaction;
  coinbase: boolean;
  onSelect: () => void;
}) {
  return (
    <div class="transaction">
      <button class="transaction-row" onClick={onSelect}>
        <TransactionSummary transaction={transaction} coinbase={coinbase} marker="+" />
      </button>
    </div>
  );
}

function TransactionSummary({
  transaction,
  coinbase,
  marker,
}: {
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
          return <i title={pool.label} aria-label={pool.label}>{pool.emoji}</i>;
        })}
      </span>
    </>
  );
}

function SelectedTransactionView({
  selection,
  onBack,
}: {
  selection: TransactionSelection;
  onBack: () => void;
}) {
  return (
    <div class="selected-transaction">
      <button class="back-button" onClick={onBack}>← Back to live stream</button>
      <div class="block-heading">
        <span>BLOCK <b>{selection.blockHeight.toLocaleString()}</b></span>
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
        {transaction.tachyon?.stamp?.anchor && <Detail label="Anchor" value={shortHash(transaction.tachyon.stamp.anchor, 10, 7)} title={transaction.tachyon.stamp.anchor} />}
      </div>
      <details><summary>Raw transaction data</summary><pre>{JSON.stringify(transaction, null, 2)}</pre></details>
    </div>
  );
}

function Detail({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div><span>{label}</span><b title={title}>{value}</b></div>;
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
