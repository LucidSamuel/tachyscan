// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Search, resolveSearch } from './Search';

const hex = 'ab'.repeat(32);

describe('search', () => {
  afterEach(() => { document.body.innerHTML = ''; });

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
});
