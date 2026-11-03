// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Search, resolveSearch } from './Search';

const hex = 'ab'.repeat(32);

describe('search', () => {
  afterEach(() => {
    for (const host of [...document.body.children]) render(null, host);
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('routes heights to blocks and hex to a transaction when the node knows it', async () => {
    expect(await resolveSearch('  3794 ', async () => false)).toBe('/block/3794');
    expect(await resolveSearch(hex.toUpperCase(), async () => true)).toBe(`/tx/${hex}`);
    expect(await resolveSearch(hex, async () => false)).toBe(`/block/${hex}`);
    expect(await resolveSearch('', async () => true)).toBeNull();
    expect(await resolveSearch('not-a-hash', async () => true)).toBeNull();
    expect(await resolveSearch('99999999999', async () => true)).toBeNull();
  });

  it('explains an invalid query instead of navigating', async () => {
    const navigate = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    await act(() => render(<Search onNavigate={navigate} />, host));
    const input = host.querySelector('input')!;
    await act(() => { input.value = 'nope'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(navigate).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('block height');
  });

  it('accepts a full hash consisting only of decimal digits', async () => {
    const hash = '01'.repeat(32);
    expect(await resolveSearch(hash, async () => true)).toBe(`/tx/${hash}`);
    expect(await resolveSearch(hash, async () => false)).toBe(`/block/${hash}`);
  });

  it('only falls back to a block for a missing transaction, not an RPC failure', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: 'Zakura RPC -5: No such transaction' }) });
    expect(await resolveSearch(hex)).toBe(`/block/${hex}`);
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: 'could not reach Zakura' }) });
    await expect(resolveSearch(hex)).rejects.toThrow('could not reach Zakura');
  });

  it('shows a network error, clears the busy state, and lets the user retry', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Network offline')).mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const navigate = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    await act(() => render(<Search onNavigate={navigate} />, host));
    const input = host.querySelector('input')!;
    await act(() => { input.value = hex; input.dispatchEvent(new Event('input', { bubbles: true })); });
    const submit = () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await act(async () => { submit(); });
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('Network offline'));
    expect(host.querySelector('button')!.disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => { submit(); });
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(`/tx/${hex}`));
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

});
