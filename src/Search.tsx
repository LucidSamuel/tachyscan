import { useEffect, useRef, useState } from 'preact/hooks';
import { blockPath, isBlockId } from './explorer-route';
import { isTransactionId, transactionPath } from './transaction-route';

/** Resolve what the person typed: a height is a block; a 64-hex value is a transaction
 *  if the node knows one by that ID, otherwise a block hash. */
export async function resolveSearch(
  query: string,
  lookup: (txid: string) => Promise<boolean> = async (txid) => (await fetch(`/api/transactions/${txid}`)).ok,
): Promise<string | null> {
  const value = query.trim().toLowerCase();
  if (!value) return null;
  if (/^\d+$/.test(value)) return isBlockId(value) ? blockPath(value) : null;
  if (!isTransactionId(value)) return null;
  return (await lookup(value)) ? transactionPath(value) : blockPath(value);
}

export function Search({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
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
        setInvalid(false);
        input.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    const path = await resolveSearch(query);
    setBusy(false);
    if (path === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setQuery('');
    onNavigate(path);
  };

  return (
    <form class={`search ${invalid ? 'invalid' : ''}`} role="search" onSubmit={submit}>
      <input
        ref={input}
        type="search"
        value={query}
        placeholder="Block height, block hash, or txid  ( / )"
        aria-label="Find a block or transaction"
        aria-invalid={invalid}
        spellcheck={false}
        autocomplete="off"
        onInput={(event) => {
          setQuery((event.target as HTMLInputElement).value);
          if (invalid) setInvalid(false);
        }}
      />
      <button type="submit" disabled={busy || !query.trim()}>{busy ? '…' : 'Find'}</button>
      {invalid && <p role="alert">Enter a block height, a 64-character block hash, or a txid.</p>}
    </form>
  );
}
