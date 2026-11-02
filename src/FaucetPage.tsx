import { useEffect, useRef, useState } from 'preact/hooks';
import { ExplorerLink } from './ExplorerLink';
import { transactionPath } from './transaction-route';
import { solvePuzzle, type Challenge, type Proof, type WorkProgress } from './faucet-pow';
import './FaucetPage.css';

interface FaucetStatus {
  amount_zat: number;
  cooldown_seconds: number;
  server_time_ms: number;
  remaining_ms: number;
  accepting: boolean;
  reason: 'ready' | 'cooldown' | 'syncing' | 'funding' | 'processing' | 'empty' | 'unavailable';
}

interface Claim {
  state: 'queued' | 'pending' | 'mined' | 'expired';
  txid: string | null;
  amount_zat: number;
  address: string;
  receipt_available: boolean;
}

interface SavedRequest { token: string; address: string; proof?: Proof }
const STORAGE_KEY = 'tachyscan-faucet-request';
const FIELD_MODULUS = BigInt('0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001');

export function normalizePaymentKey(value: string): string {
  const key = value.trim().replace(/^tachyon-test:/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(key)
    || BigInt('0x' + key.match(/../g)!.reverse().join('')) >= FIELD_MODULUS) {
    throw new Error('Enter the Tachyon payment key from your wallet’s address command.');
  }
  return 'tachyon-test:' + key;
}

function savedRequest(): SavedRequest | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && /^[0-9a-f]{64}$/.test(saved.token) && normalizePaymentKey(saved.address) === saved.address) return saved;
  } catch { /* An unavailable browser store must not break the page. */ }
  return null;
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch('/api/faucet/' + path, {
    ...init, cache: 'no-store', signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error ?? 'The faucet could not be reached. Please try again.') as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data;
}

const reasons: Record<FaucetStatus['reason'], string> = {
  ready: 'Ready for the next visitor',
  cooldown: 'A pause between requests from your IP address',
  syncing: 'The faucet wallet is syncing',
  funding: 'Preparing funds for the next payment',
  processing: 'Finishing the previous payment',
  empty: 'Waiting for the faucet to be funded',
  unavailable: 'The faucet is temporarily unavailable',
};

const claimLabels: Record<Claim['state'], string> = {
  queued: 'Preparing your payment',
  pending: 'Awaiting confirmation',
  mined: 'Payment confirmed',
  expired: 'Payment expired without confirmation',
};

export function FaucetPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [request, setRequest] = useState<SavedRequest | null>(savedRequest);
  const [input, setInput] = useState(() => request?.address ?? '');
  const [claim, setClaim] = useState<Claim | null>(null);
  const [status, setStatus] = useState<FaucetStatus | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [lastStatus, setLastStatus] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [claimMissing, setClaimMissing] = useState(false);
  const [work, setWork] = useState<{ started: number; progress: WorkProgress | null } | null>(null);
  const puzzleController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const submitLock = useRef(false);
  const refresh = useRef<() => void>(() => {});

  useEffect(() => () => {
    mounted.current = false;
    puzzleController.current?.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const data: FaucetStatus = await api('status');
        if (!cancelled) {
          setStatus(data);
          // Use the server's remaining duration so the visitor's clock need not agree.
          const receivedAt = Date.now();
          setDeadline(receivedAt + data.remaining_ms);
          setNow(receivedAt);
          setLastStatus(receivedAt);
          setConnectionError(false);
        }
      } catch {
        if (!cancelled) setConnectionError(true);
      } finally {
        polling = false;
      }
    };
    refresh.current = () => { void poll(); };
    void poll();
    const timer = window.setInterval(poll, 5000);
    const onVisible = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setClaim(null);
    setClaimMissing(false);
    if (!request) return;
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const data = await api('claim', { headers: { Authorization: 'Bearer ' + request.token } });
        if (!cancelled) {
          setClaim(data);
          setClaimMissing(false);
        }
      } catch (cause) {
        if (!cancelled) setClaimMissing((cause as Error & { status?: number }).status === 404);
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [request?.token]);

  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  const countdown = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  const connected = status !== null && !connectionError && now - lastStatus < 20000;
  const canClaim = connected && status.accepting && seconds === 0 && !request;

  const submit = async (event?: Event) => {
    event?.preventDefault();
    if (submitLock.current) return;
    if (!request && !canClaim) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      let next = request;
      if (!next) {
        const address = normalizePaymentKey(input);
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
        const controller = new AbortController();
        puzzleController.current = controller;
        const started = Date.now();
        setWork({ started, progress: null });
        const challenge: Challenge = await api('challenge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, token }), signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        const proof = await solvePuzzle(challenge, controller.signal,
          (progress) => setWork({ started, progress }));
        controller.signal.throwIfAborted();
        puzzleController.current = null;
        setWork(null);
        next = { address, token, proof };
        // Save before POST: a lost response can be recovered without sending twice.
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setRequest(next);
        setInput(address);
      }
      const data = await api('claims', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!mounted.current) return;
      setClaim(data.claim);
      setClaimMissing(false);
      setStatus(data.status);
      const receivedAt = Date.now();
      setDeadline(receivedAt + data.status.remaining_ms);
      setNow(receivedAt);
      setLastStatus(receivedAt);
      setConnectionError(false);
    } catch (cause) {
      if (!mounted.current || (cause as Error).name === 'AbortError') return;
      setError((cause as Error).message);
      // These responses definitively rejected admission. Keep the token for
      // ambiguous failures, but let a rejected visitor correct their address.
      const code = (cause as Error & { status?: number }).status;
      if (code === 400 || code === 410 || code === 429) {
        sessionStorage.removeItem(STORAGE_KEY);
        setRequest(null);
        setClaim(null);
      }
    } finally {
      puzzleController.current = null;
      submitLock.current = false;
      if (mounted.current) {
        setWork(null);
        setSubmitting(false);
        refresh.current();
      }
    }
  };

  const download = async () => {
    if (!request || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const note = await api('claim/receipt', { headers: { Authorization: 'Bearer ' + request.token } });
      const url = URL.createObjectURL(new Blob([JSON.stringify(note, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'faucet-note.json';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const reset = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      setRequest(null);
      setClaim(null);
      setError(null);
    } catch { setError('Your browser could not clear the saved request.'); }
  };

  return (
    <section class="panel faucet-page" aria-labelledby="faucet-heading">
      <div class="faucet-intro">
        <p class="section-kicker">TACHYON ALPHA TESTNET</p>
        <h2 id="faucet-heading">A little fuel<br />for your next <span>💫</span></h2>
        <p>Receive a Tachyon note, download it, and try a transaction.</p>
        <div class="faucet-availability">
          <span class="section-kicker">YOUR IP COOLDOWN</span>
          <strong>{!connected ? 'Connecting…' : seconds ? countdown : status.accepting ? 'Ready' : 'Preparing…'}</strong>
          <p>{!connected ? 'Checking faucet availability.' : seconds
            ? 'Until your IP address can request another payment.'
            : reasons[status.reason]}</p>
        </div>
        <p class="faucet-caption">
          {status ? 'One payment per IP address every ' + Math.round(status.cooldown_seconds / 60 * 10) / 10 + ' minutes.' : 'Each IP address has its own cooldown.'}
          {' '}People sharing a public IP share this limit.
          {' '}Testnet funds only.
        </p>
      </div>
      <div class="faucet-form-panel">
        <form onSubmit={submit}>
          <label for="payment-key">Your Tachyon payment key</label>
          <p class="faucet-hint">Paste the payment key or <code>tachyon-test:</code> address from your wallet’s <code>address</code> command.</p>
          <textarea id="payment-key" value={input} onInput={(event) => setInput(event.currentTarget.value)}
            placeholder="tachyon-test:…" rows={3} maxLength={128} required
            spellcheck={false} autoCapitalize="off" autoComplete="off" disabled={request !== null || submitting} />
          {!request && <button class="faucet-primary" type="submit" disabled={!canClaim || submitting}>
            {work ? 'Solving your puzzle…' : submitting ? 'Submitting…' : 'Request ' + (status ? (status.amount_zat / 100000000).toLocaleString(undefined, { maximumFractionDigits: 8 }) + ' testnet ZEC' : 'test funds')}
          </button>}
        </form>
        {work && <div class="faucet-pow" aria-busy="true">
          <div class="faucet-pow-title">
            <span class="section-kicker">A LITTLE PROOF OF WORK</span>
            <span class="faucet-pow-time">{Math.max(0, Math.floor((now - work.started) / 1000))}s</span>
          </div>
          <h3>{work.progress ? 'Finding your spark' : 'Getting your puzzle'}</h3>
          <div class="faucet-pow-track" role="progressbar" aria-label="Solving Equihash puzzle"
            aria-valuetext="Searching for a solution; completion time varies">
            <span class="faucet-pow-trail" /><span class="faucet-pow-spark" />
          </div>
          <div class="faucet-pow-detail">
            <span>{work.progress ? 'Search ' + work.progress.attempts.toLocaleString()
              + ' · ' + (work.progress.phase === 'hashing' ? 'Hashing' : 'Matching ' + work.progress.round + '/5') : 'Connecting to the faucet…'}</span>
            <span>EQUIHASH</span>
          </div>
          <p>Your browser is solving a small puzzle before requesting funds. Timing varies; you can cancel anytime. This does not reserve the faucet.</p>
          <button class="faucet-secondary" onClick={() => puzzleController.current?.abort()}>Cancel puzzle</button>
        </div>}
        {error && <p class="faucet-error" role="alert">{error}</p>}
        {request && <div class="faucet-claim">
          <p class="section-kicker">YOUR PAYMENT</p>
          <h3>{claim ? claimLabels[claim.state] : submitting ? 'Submitting your request…' : 'Recovering your request…'}</h3>
          {!claim && !submitting && <>
            <p>{claimMissing ? 'No accepted claim was found yet.' : 'The outcome is not confirmed yet.'} Retry the same request safely.</p>
            <button class="faucet-secondary" onClick={() => void submit()}>Retry this request</button>
          </>}
          {claim?.txid && <ExplorerLink class="faucet-tx-link" href={transactionPath(claim.txid)} onNavigate={onNavigate}>
            View transaction ↗ <span>{claim.txid}</span>
          </ExplorerLink>}
          {claim?.receipt_available && <>
            <button class="faucet-primary" onClick={download} disabled={downloading}>
              {downloading ? 'Downloading…' : 'Download note JSON ↓'}
            </button>
            <p>Keep this file private. Import it into the wallet that owns your payment key, then sync after the transaction is mined.</p>
            <pre><code>{'zcash-devtool tachyon --wallet-dir ~/tachyon-wallet receive \\\n  --receipt ~/Downloads/faucet-note.json\nzcash-devtool tachyon --wallet-dir ~/tachyon-wallet sync --max-blocks 10000'}</code></pre>
            <p>Repeat sync until <code>caught_up</code> is <code>true</code>.</p>
          </>}
          {claim?.state === 'expired' && <p>This payment expired without confirmation. You can request another when the faucet is ready.</p>}
          {(claim?.state === 'mined' || claim?.state === 'expired') && <>
            {claim.receipt_available && <p>Save your note JSON before starting another request.</p>}
            <button class="faucet-secondary" onClick={reset}>Start another request</button>
          </>}
          <p class="faucet-caption">This tab remembers your private claim across refreshes. Download the note before closing it.</p>
        </div>}
        {!request && <div class="faucet-how">
          <span>01 · Enter your key and let your browser solve a puzzle</span>
          <span>02 · Download your note JSON</span>
          <span>03 · Import it with devtool and sync</span>
        </div>}
      </div>
    </section>
  );
}
