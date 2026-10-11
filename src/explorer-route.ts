import { useEffect, useState } from 'preact/hooks';
import { transactionIdFromPath } from './transaction-route';

export function isBlockId(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value)
    || (/^(0|[1-9][0-9]{0,9})$/.test(value) && Number(value) <= 0xffff_ffff);
}

export function blockPath(id: string | number): string {
  const value = String(id);
  if (!isBlockId(value)) throw new Error('Expected a full block hash or a non-negative block height');
  return `/block/${value.toLowerCase()}`;
}

export function blockIdFromPath(pathname: string): string | null {
  // Keep malformed IDs in the detail view so it can show a useful error.
  return pathname.startsWith('/block/') ? pathname.slice(7).replace(/\/$/, '').toLowerCase() : null;
}

export function useExplorerRoute() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (path: string) => {
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    setPathname(path);
  };

  return { txid: transactionIdFromPath(pathname), blockId: blockIdFromPath(pathname), navigate };
}
