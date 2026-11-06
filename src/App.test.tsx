// @vitest-environment jsdom
import { render } from 'preact';
import type { VNode } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { BlockPage } from './BlockPage';
import { ExplorerLink } from './ExplorerLink';
import type { BlockDetails, Dashboard } from './types';

const hash = 'ab'.repeat(32);
const previous = 'cd'.repeat(32);
const txid = 'ef'.repeat(32);
const transaction = { txid, version: 7, vin: [{ coinbase: '0101' }], tachyon: { actions: [{ cv: 'test' }] } };
const block: BlockDetails = {
  hash, height: 3794, time: 1720000000, size: 1024, confirmations: 3,
  previousblockhash: previous, tx: [transaction],
};
const dashboard: Dashboard = {
  network: 'TachyonTestnet', height: 3796, bestBlockHash: '12'.repeat(32),
  activationHeight: 8, epochLength: 4096, blockTargetSeconds: 75, nextBlockEstimate: null,
  accumulator: null, retainedTachygramCount: 0, tachygrams: [], footprintBytes: 0,
  footprintHistory: [], index: { phase: 'ready', scannedHeight: 3796, targetHeight: 3796 },
  blocks: [{ hash, height: block.height, time: block.time, transactions: block.tx }], page: 1, pageCount: 10,
};
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  host = document.createElement('div');
  document.body.append(host);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/faucet/status') return { ok: true, json: async () => ({
      amount_zat: 1000000, cooldown_seconds: 300, server_time_ms: Date.now(),
      remaining_ms: 0, accepting: false, reason: 'syncing',
    }) };
    if (url.startsWith('/api/dashboard')) return { ok: true, json: async () => dashboard };
    if (url.startsWith('/api/blocks/')) return { ok: true, json: async () => block };
    if (url.startsWith('/api/transactions/')) return {
      ok: true, json: async () => ({ transaction: { ...transaction, blockhash: hash }, blockHeight: 3794, coinbase: true }),
    };
    throw new Error(`Unexpected URL: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

function link(path: string): HTMLAnchorElement {
  const element = host.querySelector<HTMLAnchorElement>(`a[href="${path}"]`);
  expect(element, `link ${path}`).not.toBeNull();
  return element!;
}

async function mount(view: VNode) {
  await act(async () => { render(view, host); });
  // Dashboard resolution can mount a detail view with its own asynchronous lookup.
  await act(async () => {});
}

async function click(path: string) {
  await act(async () => { link(path).click(); });
}

describe('site navigation', () => {
  it('moves between all four pages and restores Explorer for detail routes', async () => {
    await mount(<App />);
    const current = () => host.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')?.textContent;
    expect(current()).toBe('Explorer');
    expect(host.querySelector('[aria-label="Transaction type key"]')).not.toBeNull();
    expect(host.querySelector('.tachygram-vault, .chart-frame')).toBeNull();

    await click('/pool-info');
    expect(current()).toBe('Pool info');
    expect(document.title).toBe('Pool info · Tachyscan');
    expect(host.querySelector('.epoch-panel')).not.toBeNull();
    expect(host.querySelector('.activity-strip')).not.toBeNull();
    expect(host.querySelector('.recent-tachygrams')).not.toBeNull();
    expect(host.querySelector('.chart-frame')).not.toBeNull();
    expect(host.querySelector('.transactions-panel')).toBeNull();
    await click('/');
    expect(host.querySelector('.epoch-panel, .chart-frame')).toBeNull();
    expect(host.querySelector('.pool-chip.tachyon .pool-mark')).not.toBeNull();

    await click('/faucet');
    expect(window.location.pathname).toBe('/faucet');
    expect(current()).toBe('Faucet');
    expect(host.textContent).toContain('YOUR IP COOLDOWN');
    await click('/tutorial');
    expect(current()).toBe('Tutorial');
    expect(document.title).toBe('Tutorial · Tachyscan');

    // Back/Forward must restore the page and the active navigation item together.
    await act(async () => {
      window.history.replaceState(null, '', '/faucet');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(current()).toBe('Faucet');
    await click('/');
    await click(`/block/${hash}`);
    expect(current()).toBe('Explorer');
    await vi.waitFor(() => expect(host.querySelector(`a[href="/tx/${txid}"]`)).not.toBeNull());
    await click(`/tx/${txid}`);
    expect(current()).toBe('Explorer');
  });

  it.each(['/pool-info', '/pool-info/'])('opens the pool page directly at %s', async (path) => {
    window.history.replaceState(null, '', path);
    await mount(<App />);
    expect(host.querySelector('#pool-info-heading')?.textContent).toBe('Pool info');
    expect(host.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')?.getAttribute('href')).toBe('/pool-info');
    await act(async () => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(host.querySelector('.epoch-panel')).toBeNull();
    await act(async () => {
      window.history.replaceState(null, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(host.querySelector('.epoch-panel')).not.toBeNull();
  });

  it('polls the latest pool data even after browsing older explorer pages', async () => {
    vi.useFakeTimers();
    try {
      await mount(<App />);
      const pageTwo = [...host.querySelectorAll<HTMLButtonElement>('.pagination button')].find((button) => button.textContent === '2')!;
      await act(async () => pageTwo.click());
      expect(fetchMock).toHaveBeenLastCalledWith('/api/dashboard?page=2&limit=8', expect.anything());
      await click('/pool-info');
      expect(fetchMock).toHaveBeenLastCalledWith('/api/dashboard?page=1&limit=8', expect.anything());
      fetchMock.mockClear();
      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
      expect(fetchMock).toHaveBeenCalledWith('/api/dashboard?page=1&limit=8', expect.anything());
      await click('/tutorial');
      fetchMock.mockClear();
      await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['/faucet', '/faucet/', '/tutorial', '/tutorial/'])('opens %s without waiting for RPC', async (path) => {
    window.history.replaceState(null, '', path);
    fetchMock.mockRejectedValue(new Error('Node offline'));
    await mount(<App />);
    expect(host.textContent).toContain(path.startsWith('/faucet') ? 'YOUR IP COOLDOWN' : 'TACHYON ALPHA TESTNET');
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/dashboard'))).toBe(false);
    expect(host.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')?.getAttribute('href')).toBe(path.replace(/\/$/, ''));
  });

  it('keeps navigation available when the explorer connection fails', async () => {
    fetchMock.mockRejectedValue(new Error('Node offline'));
    await mount(<App />);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Node offline');
    await click('/tutorial');
    expect(link('https://github.com/tachyon-zcash/zcash-devtool#readme').textContent).toContain('Read the guide on GitHub');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('block pages', () => {
  it('links block headers and the tip, then navigates from a block to its transactions', async () => {
    await mount(<App />);
    expect(link(`/block/${dashboard.bestBlockHash}`)).toBeDefined();
    expect(link(`/block/${hash}`).classList.contains('block-heading')).toBe(true);
    await click(`/block/${hash}`);
    expect(window.location.pathname).toBe(`/block/${hash}`);
    expect(host.textContent).toContain('BLOCK DETAIL');
    await vi.waitFor(() => expect(host.textContent).toContain('3,794'));
    expect(host.textContent).toContain(hash);
    expect(host.textContent).toContain('Tachyon actions');
    expect(host.querySelector('[aria-label="Block JSON"]')).not.toBeNull();
    expect(link(`/block/${previous}`)).toBeDefined();
    await click(`/tx/${txid}`);
    expect(window.location.pathname).toBe(`/tx/${txid}`);
    expect(host.textContent).toContain('TRANSACTION DETAIL');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Transaction JSON"]')).not.toBeNull());
    expect(link(`/block/${hash}`)).toBeDefined();

    // Browser Back/Forward emits popstate; it must restore either detail route.
    await act(async () => {
      window.history.replaceState(null, '', `/block/${hash}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(host.textContent).toContain('BLOCK DETAIL');
    await click('/');
    expect(window.location.pathname).toBe('/');
    expect(host.textContent).toContain('LIVE TRANSACTION STREAM');
  });

  it.each([hash, '0', '3794'])('loads direct URL /block/%s independently of the stream window', async (id) => {
    window.history.replaceState(null, '', `/block/${id}`);
    await mount(<App />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/blocks/${id}`, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(host.textContent).toContain('BLOCK DETAIL');
  });

  it('rejects malformed IDs locally and offers a way back', async () => {
    window.history.replaceState(null, '', '/block/not-a-hash');
    await mount(<App />);
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('Invalid block ID'));
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/blocks/'))).toBe(false);
    expect(link('/')).toBeDefined();
  });

  it('shows lookup errors instead of crashing or displaying stale data', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Block not found' }) });
    await mount(<BlockPage id={hash} network="Testnet" onNavigate={() => {}} />);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Block not found');
  });

  it('ignores a response from a block that has been navigated away from', async () => {
    let resolveOld!: (response: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    await mount(<BlockPage id={previous} network="Testnet" onNavigate={() => {}} />);
    expect(host.textContent).toContain('Loading block');
    await mount(<BlockPage id={hash} network="Testnet" onNavigate={() => {}} />);
    await act(async () => resolveOld({ ok: true, json: async () => ({ ...block, hash: previous, height: 12 }) }));
    expect(host.textContent).toContain('Block 3,794');
    expect(host.textContent).not.toContain('Block 12');
  });

  it('preserves modified clicks for browser new-tab navigation', async () => {
    const navigate = vi.fn();
    await act(() => render(<ExplorerLink href={`/block/${hash}`} onNavigate={navigate}>Block</ExplorerLink>, host));
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    // Observe whether our handler prevents default, without letting jsdom navigate.
    let prevented: boolean | undefined;
    host.addEventListener('click', (event) => { prevented = event.defaultPrevented; event.preventDefault(); });
    await act(() => { link(`/block/${hash}`).dispatchEvent(event); });
    expect(navigate).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });
});
