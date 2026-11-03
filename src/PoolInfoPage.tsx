import { useEffect, useState } from 'preact/hooks';
import type { Dashboard } from './types';
import { EpochPanel } from './EpochPanel';
import { formatBytes } from './lib';

function useClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function PoolInfoPage({ dashboard, pulse, onNavigate }: {
  dashboard: Dashboard;
  pulse: number | null;
  onNavigate: (path: string) => void;
}) {
  const now = useClock();
  return (
    <section class="pool-info-page" aria-labelledby="pool-info-heading">
      <div class="pool-info-title"><p class="section-kicker">TACHYON POOL</p><h2 id="pool-info-heading">Pool info</h2></div>
      <div class="pool-info-grid">
        <EpochPanel dashboard={dashboard} now={now} pulse={pulse} onNavigate={onNavigate} />
        <section class="footprint-section">
          <p class="section-kicker">TACHYGRAM PAYLOAD FOOTPRINT</p>
          <h2>{formatBytes(dashboard.footprintBytes)}</h2>
          <FootprintChart dashboard={dashboard} />
        </section>
      </div>
    </section>
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
