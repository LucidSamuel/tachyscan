import { useEffect, useRef, useState } from 'preact/hooks';
import { blockPath, isBlockId } from './explorer-route';
import { isTransactionId, transactionPath } from './transaction-route';

async function lookupTransaction(txid: string): Promise<boolean> {
  const response = await fetch(`/api/transactions/${txid}`);
  if (response.ok) return true;
  if (response.status === 404) return false;
  const data = await response.json();
  // The transaction API currently wraps node RPC errors in HTTP 502. Only
  // Zcash's not-found code (-5) means we should try the value as a block hash.
  if (typeof data.error === 'string' && data.error.startsWith('Zakura RPC -5:')) return false;
  throw new Error(data.error ?? `Transaction lookup returned ${response.status}`);
}

/** Resolve what the person typed: a height is a block; a 64-hex value is a transaction
 *  if the node knows one by that ID, otherwise a block hash. */
export async function resolveSearch(
  query: string,
  lookup: (txid: string) => Promise<boolean> = lookupTransaction,
): Promise<string | null> {
  const value = query.trim().toLowerCase();
  if (!value) return null;
  if (isTransactionId(value)) return (await lookup(value)) ? transactionPath(value) : blockPath(value);
  return isBlockId(value) ? blockPath(value) : null;
}

export function Search({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        input.current?.focus();
      } else if (event.key === 'Escape' && target === input.current) {
        setQuery('');
        setError(null);
        input.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const path = await resolveSearch(query);
      if (path === null) {
        setError('Enter a block height, a 64-character block hash, or a txid.');
        return;
      }
      setQuery('');
      onNavigate(path);
    } catch (cause) {
      setError(`Search failed: ${(cause as Error).message}. Try again.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class={`search ${error ? 'invalid' : ''}`} role="search" onSubmit={submit}>
      <input
        ref={input}
        type="search"
        value={query}
        placeholder="Block height, block hash, or txid  ( / )"
        aria-label="Find a block or transaction"
        aria-invalid={Boolean(error)}
        spellcheck={false}
        autocomplete="off"
        onInput={(event) => {
          setQuery((event.target as HTMLInputElement).value);
          if (error) setError(null);
        }}
      />
      <button type="submit" disabled={busy || !query.trim()}>{busy ? '…' : 'Find'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
