import { solveChallenge, type Challenge } from './equihash';

self.onmessage = (event: MessageEvent<Challenge>) => {
  try {
    const proof = solveChallenge(event.data, (progress) => self.postMessage({ type: 'progress', progress }));
    self.postMessage({ type: 'solved', proof });
  } catch (cause) {
    self.postMessage({ type: 'error', message: cause instanceof Error ? cause.message : 'Puzzle search failed.' });
  }
};
