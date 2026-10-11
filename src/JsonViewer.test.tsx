// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonViewer } from './JsonViewer';

const proof = '0123456789abcdef'.repeat(256);
const transaction = {
  txid: 'ab'.repeat(32),
  hex: proof,
  version: 7,
  active: true,
  missing: null,
  vin: [],
  tachyon: { actions: [{ proof, value: -50 }] },
};
let host: HTMLDivElement;

function button(label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent) === label,
  );
  expect(match, `button ${label}`).toBeDefined();
  return match!;
}

async function click(label: string) {
  await act(() => button(label).click());
}

async function mount(value: unknown = transaction, key = 'tx') {
  await act(() => render(<JsonViewer key={key} value={value} />, host));
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

describe('transaction JSON explorer', () => {
  it('uses block labels and copies the full block when reused on a block page', async () => {
    const block = { hash: 'ab'.repeat(32), tx: [transaction] };
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await act(() => render(<JsonViewer value={block} subject="Block" />, host));
    expect(host.querySelector('[aria-label="Block JSON"]')).not.toBeNull();
    expect(button('Fold block')).toBeDefined();
    await click('Fold all');
    await click('Copy JSON');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(JSON.stringify(block, null, 2));
  });

  it('shows top-level fields but lazily folds nested containers and long strings', async () => {
    await mount();
    expect(button('Fold transaction').getAttribute('aria-expanded')).toBe('true');
    expect(button('Unfold tachyon').getAttribute('aria-expanded')).toBe('false');
    expect(button('Unfold hex').getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).toContain('4,096 chars');
    expect(host.textContent).not.toContain(proof);
    expect(host.textContent).not.toContain('"actions"');
    expect(host.textContent).toContain('"version": 7');
    expect(host.textContent).toContain('"active": true');
    expect(host.textContent).toContain('"missing": null');
  });

  it('expands and collapses individual fields, arrays, and long strings', async () => {
    await mount();
    await click('Unfold tachyon');
    await click('Unfold actions');
    await click('Unfold 0');
    await click('Unfold proof');
    expect(host.textContent).toContain(proof);
    expect(host.textContent).toContain('"value": -50');
    await click('Fold proof');
    expect(host.textContent).not.toContain(proof);
    await click('Fold tachyon');
    expect(host.textContent).not.toContain('"actions"');
  });

  it('folds and unfolds all descendants and strings, overriding individual toggles', async () => {
    await mount();
    await click('Unfold all');
    expect(host.textContent).toContain(proof);
    expect(host.textContent).toContain('"value": -50');
    expect(host.querySelectorAll('[aria-expanded="false"]')).toHaveLength(0);
    await click('Fold hex');
    await click('Unfold all');
    expect(button('Fold hex').getAttribute('aria-expanded')).toBe('true');
    await click('Fold all');
    expect(host.textContent).not.toContain('"txid"');
    await click('Unfold transaction');
    expect(button('Unfold tachyon').getAttribute('aria-expanded')).toBe('false');
    expect(button('Unfold hex').getAttribute('aria-expanded')).toBe('false');
  });

  it('copies the complete pretty-printed original JSON even when everything is folded', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await mount();
    await click('Fold all');
    await click('Copy JSON');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(JSON.stringify(transaction, null, 2));
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Copied full JSON');
  });

  it('explains unavailable clipboard access', async () => {
    vi.stubGlobal('navigator', {});
    await mount();
    await click('Copy JSON');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('HTTPS or localhost');
  });

  it('reports clipboard permission failures without claiming success', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    await mount();
    await click('Copy JSON');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Could not copy JSON');
    expect(button('Copy JSON').disabled).toBe(false);
  });

  it('resets folding when navigating to a different transaction', async () => {
    await mount();
    await click('Fold all');
    await mount({ txid: 'cd'.repeat(32) }, 'different-tx');
    expect(button('Fold transaction').getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('cd'.repeat(32));
  });

  it('renders hostile-looking strings as text and keeps escaped paths independent', async () => {
    const text = '<img src=x onerror=alert(1)>\n"quoted"\\';
    await mount({ 'a/b': { value: 1 }, a: { b: { value: 2 } }, text, empty: {} });
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain(JSON.stringify(text));
    await click('Unfold a/b');
    await click('Unfold a');
    expect(button('Unfold b').getAttribute('aria-expanded')).toBe('false');
    await click('Unfold empty');
    expect(button('Fold empty').getAttribute('aria-expanded')).toBe('true');
  });
});
