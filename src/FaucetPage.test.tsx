// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FaucetPage, normalizePaymentKey } from './FaucetPage';
import { solvePuzzle } from './faucet-pow';
import vector from './fixtures/equihash.json';

vi.mock('./faucet-pow', () => ({ solvePuzzle: vi.fn() }));

const key = '01' + '00'.repeat(31);
const address = 'tachyon-test:' + key;
const token = '11'.repeat(32);
const txid = 'ab'.repeat(32);
const storage = 'tachyscan-faucet-request';
const ready = { amount_zat: 1000000, cooldown_seconds: 300, server_time_ms: 100000,
  remaining_ms: 0, accepting: true, reason: 'ready' };
const receipt = { version: 1, network_id: 'cd'.repeat(32), payment_key: key,
  value_zat: 1000000, psi: '03' + '00'.repeat(31), rcm: '04' + '00'.repeat(31) };
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

function response(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data };
}

beforeEach(() => {
  sessionStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  fetchMock = vi.fn(async (url: string) => url.endsWith('/status')
    ? response(ready) : url.endsWith('/challenge') ? response(vector.challenge) : response({ error: 'Claim not found' }, 404));
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(solvePuzzle).mockReset().mockResolvedValue(vector.proof);
});

afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

async function mount() {
  await act(async () => { render(<FaucetPage onNavigate={() => {}} />, host); });
  await act(async () => {});
}
async function enter(value: string) {
  await act(() => {
    const textarea = host.querySelector('textarea')!;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    // Flush the challenge -> worker -> claim promise chain. A deliberately
    // pending worker still lets this return so cancellation can be exercised.
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
  await act(async () => {});
}

describe('faucet', () => {
  it('normalizes payment keys and rejects noncanonical encodings', () => {
    expect(normalizePaymentKey(key)).toBe(address);
    expect(normalizePaymentKey(' ' + address.toUpperCase().replace('TACHYON-TEST:', 'tachyon-test:') + ' ')).toBe(address);
    expect(() => normalizePaymentKey('ff'.repeat(32))).toThrow();
    expect(() => normalizePaymentKey('tmAtransparentAddress')).toThrow();
  });

  it('counts down a server duration independently of the browser clock, then revalidates', async () => {
    vi.useFakeTimers();
    let available = false;
    fetchMock.mockImplementation(async () => response(available ? ready : {
      ...ready, remaining_ms: 2000, accepting: false, reason: 'cooldown',
    }));
    await mount();
    expect(host.textContent).toContain('0:02');
    expect(host.querySelector('button')!.disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(host.querySelector('button')!.disabled).toBe(true);
    available = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(host.querySelector('button')!.disabled).toBe(false);
  });

  it('keeps claiming disabled if status is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await mount();
    expect(host.textContent).toContain('Checking faucet availability');
    expect(host.querySelector('button')!.disabled).toBe(true);
  });

  it('does not submit an invalid address or consume a claim token', async () => {
    await mount();
    await enter('not-an-address');
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('payment key');
    expect(sessionStorage.getItem(storage)).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('saves a private token before sending and retries the identical request after a lost response', async () => {
    const posts: string[] = [];
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/status')) return response(ready);
      if (url.endsWith('/challenge')) return response(vector.challenge);
      if (init.method === 'POST') {
        posts.push(String(init.body));
        expect(JSON.parse(sessionStorage.getItem(storage)!)).toEqual(JSON.parse(String(init.body)));
        if (posts.length === 1) throw new Error('Response lost');
        return response({ claim: { state: 'queued', amount_zat: 1000000, address, txid: null, receipt_available: false },
          status: { ...ready, remaining_ms: 300000, accepting: false, reason: 'cooldown' } }, 202);
      }
      return response({ error: 'Claim not found' }, 404);
    });
    await mount();
    await enter(key);
    await submit();
    expect(host.querySelector('textarea')!.disabled).toBe(true);
    const retry = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Retry this request')!;
    await act(async () => retry.click());
    await act(async () => {});
    expect(posts).toHaveLength(2);
    expect(posts[0]).toBe(posts[1]);
    expect(solvePuzzle).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Preparing your payment');
  });

  it('recovers a claim after refresh and downloads only receipt JSON using bearer authorization', async () => {
    sessionStorage.setItem(storage, JSON.stringify({ token, address }));
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/status')) return response({ ...ready, remaining_ms: 100000, accepting: false, reason: 'cooldown' });
      expect(init.headers).toEqual({ Authorization: 'Bearer ' + token });
      if (url.endsWith('/receipt')) return response(receipt);
      return response({ state: 'mined', amount_zat: 1000000, address, txid, receipt_available: true });
    });
    const blobUrl = vi.fn(() => 'blob:synthetic-download');
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = blobUrl;
      static revokeObjectURL = vi.fn();
    });
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await mount();
    expect(host.querySelector(`a[href="/tx/${txid}"]`)).not.toBeNull();
    const download = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Download note JSON'))!;
    await act(async () => download.click());
    await act(async () => {});
    expect(blobUrl).toHaveBeenCalledOnce();
    expect(clicked).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([url]) => url.includes(token))).toBe(false);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('allows correction after the server rejects admission', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/status')) return response(ready);
      if (url.endsWith('/challenge')) return response(vector.challenge);
      if (init.method === 'POST') return response({ error: 'Use your own wallet’s key' }, 400);
      return response({ error: 'Claim not found' }, 404);
    });
    await mount();
    await enter(key);
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('own wallet');
    expect(sessionStorage.getItem(storage)).toBeNull();
    expect(host.querySelector('textarea')!.disabled).toBe(false);
  });

  it('does not present an expired payment as spendable', async () => {
    sessionStorage.setItem(storage, JSON.stringify({ token, address }));
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/status') ? response(ready)
      : response({ state: 'expired', amount_zat: 1000000, address, txid, receipt_available: false }));
    await mount();
    expect(host.textContent).toContain('Payment expired without confirmation');
    expect(host.textContent).not.toContain('Download note JSON');
    const restart = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Start another request')!;
    await act(() => restart.click());
    expect(sessionStorage.getItem(storage)).toBeNull();
    expect(host.querySelector('textarea')!.disabled).toBe(false);
  });

  it('shows real search activity and cancels before creating a claim', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(solvePuzzle).mockImplementation((_challenge, abort, report) => {
      signal = abort;
      report({ attempts: 12, phase: 'matching', round: 3 });
      return new Promise((_resolve, reject) => {
        abort.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
      });
    });
    await mount();
    await enter(key);
    await submit();
    expect(host.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
    expect(host.textContent).toContain('Search 12 · Matching 3/5');
    expect(host.querySelector('textarea')!.disabled).toBe(true);
    expect(sessionStorage.getItem(storage)).toBeNull();
    await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Cancel puzzle')!.click());
    expect(signal?.aborted).toBe(true);
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('textarea')!.disabled).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/claims'))).toBe(false);
  });

  it('cancels the worker when navigating away', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(solvePuzzle).mockImplementation((_challenge, abort) => {
      signal = abort;
      return new Promise((_resolve, reject) => abort.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))));
    });
    await mount();
    await enter(key);
    await submit();
    await act(() => render(null, host));
    expect(signal?.aborted).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/claims'))).toBe(false);
  });

  it('lets the visitor retry a failed or expired search without saving a claim', async () => {
    vi.mocked(solvePuzzle).mockRejectedValue(new Error('The puzzle expired. Please try again.'));
    await mount();
    await enter(key);
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('puzzle expired');
    expect(sessionStorage.getItem(storage)).toBeNull();
    expect(host.querySelector('textarea')!.disabled).toBe(false);
  });

  it('handles a visitor losing the global cooldown race during a solve', async () => {
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/status') ? response(ready)
      : url.endsWith('/challenge') ? response(vector.challenge)
        : response({ error: 'The global faucet cooldown is still running' }, 429));
    await mount();
    await enter(key);
    await submit();
    expect(solvePuzzle).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('cooldown');
    expect(sessionStorage.getItem(storage)).toBeNull();
    expect(host.querySelector('textarea')!.disabled).toBe(false);
  });
});
