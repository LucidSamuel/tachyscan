import { useMemo, useState } from 'preact/hooks';
import type { EpochProgress } from './lib';
import type { Dashboard } from './types';
import { blockPath } from './explorer-route';
import { transactionPath } from './transaction-route';
import { ExplorerLink } from './ExplorerLink';
import { HashGlyph } from './HashGlyph';
import {
  ACTIVITY_WINDOW,
  durationUntil,
  epochProgress,
  indexLag,
  pruningDate,
  shortHash,
  tachygramActivity,
  transactionForTachygram,
} from './lib';

const RECENT_TACHYGRAMS = 5;

export function EpochPanel({ dashboard, now, pulse, onNavigate }: {
  dashboard: Dashboard;
  now: number;
  /** Changes when a new block lands so the ring can acknowledge it once. */
  pulse: number | null;
  onNavigate: (path: string) => void;
}) {
  const progress = epochProgress(dashboard.height, dashboard.activationHeight, dashboard.epochLength);
  const lag = indexLag(dashboard.index, dashboard.height);
  const pruneAt = useMemo(
    () => pruningDate(dashboard.height, dashboard.activationHeight, dashboard.epochLength, dashboard.blockTargetSeconds),
    [dashboard.height, dashboard.activationHeight, dashboard.epochLength, dashboard.blockTargetSeconds],
  );
  const activity = useMemo(
    () => tachygramActivity(dashboard.tachygrams, dashboard.height, ACTIVITY_WINDOW),
    [dashboard.tachygrams, dashboard.height],
  );
  const newestFirst = useMemo(
    () => [...dashboard.tachygrams].sort((a, b) => b.revealedHeight - a.revealedHeight || a.value.localeCompare(b.value)),
    [dashboard.tachygrams],
  );
  const [showAll, setShowAll] = useState(false);
  const listed = showAll ? newestFirst : newestFirst.slice(0, RECENT_TACHYGRAMS);

  if (!progress) {
    return (
      <section class="panel epoch-panel">
        <div class="panel-label"><span>EPOCH</span><b>not active</b></div>
        <p class="epoch-empty">Tachyon activates at block {dashboard.activationHeight.toLocaleString()}.</p>
      </section>
    );
  }

  return (
    <section class="panel epoch-panel">
      <div class="panel-label">
        <span>EPOCH {progress.epoch.toLocaleString()}</span>
        <b>
          {dashboard.retainedTachygramCount.toLocaleString()} retained
          {lag > 0 && <em class="index-lag" title={`The tachygram index is ${lag} block${lag === 1 ? '' : 's'} behind the chain tip`}>indexing {dashboard.index.scannedHeight?.toLocaleString()}</em>}
        </b>
      </div>

      <EpochRing progress={progress} pruneText={durationUntil(pruneAt, now)} pulse={pulse} />

      <ActivityStrip activity={activity} onNavigate={onNavigate} />

      <div class={`recent-tachygrams ${showAll ? 'expanded' : ''}`}>
        <div class="recent-head">
          <p class="section-kicker">{showAll ? 'RETAINED TACHYGRAMS' : 'LATEST TACHYGRAMS'}</p>
          {newestFirst.length > RECENT_TACHYGRAMS && (
            <button type="button" class="link-button" onClick={() => setShowAll((open) => !open)} aria-expanded={showAll}>
              {showAll ? 'Show latest only' : `Show all ${newestFirst.length.toLocaleString()}`}
            </button>
          )}
        </div>
        {listed.length ? (
          <ul>
            {listed.map((tachygram) => {
              const selection = transactionForTachygram(dashboard.blocks, tachygram.value);
              const label = <>
                <HashGlyph hash={tachygram.value} size={12} />
                <code title={tachygram.value}>{shortHash(tachygram.value, 10, 6)}</code>
                <span>block {tachygram.revealedHeight.toLocaleString()}</span>
              </>;
              return (
                <li key={tachygram.value}>
                  {selection
                    ? <ExplorerLink href={transactionPath(selection.transaction.txid)} onNavigate={onNavigate} title="Open the transaction that revealed this tachygram">{label}</ExplorerLink>
                    : <ExplorerLink href={blockPath(tachygram.revealedHeight)} onNavigate={onNavigate} title="Open the block that revealed this tachygram">{label}</ExplorerLink>}
                  <CopyButton value={tachygram.value} />
                </li>
              );
            })}
          </ul>
        ) : <p class="epoch-empty">No tachygrams retained yet.</p>}
      </div>
    </section>
  );
}

function ActivityStrip({ activity, onNavigate }: {
  activity: { height: number; count: number }[];
  onNavigate: (path: string) => void;
}) {
  const max = Math.max(1, ...activity.map((point) => point.count));
  const total = activity.reduce((sum, point) => sum + point.count, 0);
  const first = activity[0]?.height ?? 0;
  const last = activity.at(-1)?.height ?? 0;
  return (
    <div class="activity">
      <div class="activity-head">
        <p class="section-kicker">TACHYGRAMS PER BLOCK</p>
        <span>{total.toLocaleString()} in the last {activity.length.toLocaleString()} blocks</span>
      </div>
      <div class="activity-strip" role="list" aria-label="Tachygrams revealed per block">
        {activity.map((point) => (
          <ExplorerLink
            key={point.height}
            class={`activity-bar ${point.count ? 'active' : ''}`}
            href={blockPath(point.height)}
            onNavigate={onNavigate}
            title={`Block ${point.height.toLocaleString()}: ${point.count} tachygram${point.count === 1 ? '' : 's'}`}
          >
            <span style={{ height: `${point.count ? Math.max(8, (point.count / max) * 100) : 2}%` }} />
          </ExplorerLink>
        ))}
      </div>
      <div class="activity-caption"><span>{first.toLocaleString()}</span><span>{last.toLocaleString()}</span></div>
    </div>
  );
}

const RING_SIZE = 220;
const RING_RADIUS = 88;
const RING_TICKS = 32;

/** The epoch as a dial: the boundary sits at twelve o'clock, the filled arc is the blocks
 *  seen so far, and the particle is the tip. */
function EpochRing({ progress, pruneText, pulse }: {
  progress: EpochProgress;
  pruneText: string;
  pulse: number | null;
}) {
  const centre = RING_SIZE / 2;
  const circumference = 2 * Math.PI * RING_RADIUS;
  const angle = progress.fraction * 2 * Math.PI;
  const tipX = centre + RING_RADIUS * Math.sin(angle);
  const tipY = centre - RING_RADIUS * Math.cos(angle);
  const ticks = Array.from({ length: RING_TICKS }, (_, index) => {
    const theta = (index / RING_TICKS) * 2 * Math.PI;
    const inner = RING_RADIUS - (index % 8 === 0 ? 9 : 5);
    const outer = RING_RADIUS - 1;
    return {
      x1: centre + inner * Math.sin(theta), y1: centre - inner * Math.cos(theta),
      x2: centre + outer * Math.sin(theta), y2: centre - outer * Math.cos(theta),
      major: index % 8 === 0,
      lit: index / RING_TICKS <= progress.fraction,
    };
  });
  return (
    <div class="epoch-ring" role="group" aria-label={`Block ${progress.index.toLocaleString()} of ${progress.length.toLocaleString()} in epoch ${progress.epoch.toLocaleString()}`}>
      <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true" key={pulse ?? 'ring'} class={pulse !== null ? 'pulse' : ''}>
        <circle class="ring-track" cx={centre} cy={centre} r={RING_RADIUS} />
        {ticks.map((tick, index) => (
          <line key={index} class={`ring-tick ${tick.major ? 'major' : ''} ${tick.lit ? 'lit' : ''}`} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
        ))}
        <circle
          class="ring-arc"
          cx={centre}
          cy={centre}
          r={RING_RADIUS}
          transform={`rotate(-90 ${centre} ${centre})`}
          stroke-dasharray={`${circumference * progress.fraction} ${circumference}`}
        />
        <line class="ring-boundary" x1={centre} y1={centre - RING_RADIUS - 10} x2={centre} y2={centre - RING_RADIUS + 10} />
        <circle class="ring-tip-glow" cx={tipX} cy={tipY} r={11} />
        <circle class="ring-tip" cx={tipX} cy={tipY} r={4} />
      </svg>
      <div class="ring-centre">
        <span class="ring-label">epoch</span>
        <strong>{progress.epoch.toLocaleString()}</strong>
        <span class="ring-detail">block <b>{progress.index.toLocaleString()}</b> of {progress.length.toLocaleString()}</span>
        <span class="ring-detail">prunes in <b>{pruneText}</b></span>
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      class={`copy-button ${copied ? 'copied' : ''}`}
      title={copied ? 'Copied' : 'Copy the full tachygram'}
      aria-label={copied ? 'Copied' : 'Copy the full tachygram'}
      onClick={async () => {
        try {
          await navigator.clipboard?.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          // Clipboard access can be refused; the hover title still shows the value.
        }
      }}
    >{copied ? 'copied' : 'copy'}</button>
  );
}
