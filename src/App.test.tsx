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
  window.history.replaceState(null, '', '/');
  host = document.createElement('div');
  document.body.append(host);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  fetchMock = vi.fn(async (url: string) => {
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
