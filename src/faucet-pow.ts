import type { Challenge, Proof, WorkProgress } from './equihash';

export type { Challenge, Proof, WorkProgress } from './equihash';

export function solvePuzzle(challenge: Challenge, signal: AbortSignal, report: (progress: WorkProgress) => void): Promise<Proof> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./equihash.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener('abort', cancel);
      window.clearTimeout(timer);
    };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const cancel = () => fail(new DOMException('Puzzle cancelled', 'AbortError'));
    const timer = window.setTimeout(() => fail(new Error('The puzzle expired. Please try again.')),
      Math.min(Math.max(challenge.valid_for_ms, 1000), 3600000));
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = () => fail(new Error('Your browser could not run the puzzle. Please reload and try again.'));
    worker.onmessageerror = () => fail(new Error('Could not read the puzzle result. Please try again.'));
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') report(data.progress);
      else if (data.type === 'solved') { cleanup(); resolve(data.proof); }
      else if (data.type === 'error') fail(new Error(data.message));
    };
    worker.postMessage(challenge);
  });
}
