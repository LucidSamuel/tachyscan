// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { solvePuzzle } from './faucet-pow';
import vector from './fixtures/equihash.json';

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { FakeWorker.latest = this; }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('puzzle worker lifetime', () => {
  it('forwards progress and terminates on success', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const report = vi.fn();
    const result = solvePuzzle(vector.challenge, new AbortController().signal, report);
    const worker = FakeWorker.latest;
    worker.onmessage!({ data: { type: 'progress', progress: { attempts: 1 } } });
    worker.onmessage!({ data: { type: 'solved', proof: vector.proof } });
    expect(await result).toEqual(vector.proof);
    expect(report).toHaveBeenCalledWith({ attempts: 1 });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates immediately on cancellation', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const result = solvePuzzle(vector.challenge, controller.signal, () => {});
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });

  it('terminates a stalled worker at the challenge deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    const result = solvePuzzle({ ...vector.challenge, valid_for_ms: 1000 }, new AbortController().signal, () => {});
    const failed = expect(result).rejects.toThrow('expired');
    await vi.advanceTimersByTimeAsync(1000);
    await failed;
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });

  it('terminates after a browser worker error', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const result = solvePuzzle(vector.challenge, new AbortController().signal, () => {});
    FakeWorker.latest.onerror!();
    await expect(result).rejects.toThrow('could not run');
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
});
