import { createRunMetrics } from '../models/metrics.js';
import { withRetry } from '../session/retry.js';

const make429 = (retryAfterSeconds = '0.001'): Error & { response: { status: number; headers: Record<string, string> } } => {
  const err = new Error('HTTP 429 Too Many Requests') as Error & {
    response: { status: number; headers: Record<string, string> };
  };
  err.response = { status: 429, headers: { 'retry-after': retryAfterSeconds } };
  return err;
};

const assertEqual = (label: string, actual: unknown, expected: unknown): void => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

const retryWaitMs: [number, number, number] = [1, 2, 4];

const recoverableMetrics = createRunMetrics();
let recoverableAttempts = 0;
const recovered = await withRetry(
  async () => {
    recoverableAttempts++;
    if (recoverableAttempts < 3) throw make429();
    return 'ok';
  },
  retryWaitMs,
  'simulate-recoverable-429',
  recoverableMetrics,
);

assertEqual('recoverable result', recovered, 'ok');
assertEqual('recoverable attempts', recoverableAttempts, 3);
assertEqual('recoverable retries', recoverableMetrics.totalRetries, 2);
assertEqual('recoverable 429 count', recoverableMetrics.total429, 2);

const persistentMetrics = createRunMetrics();
let persistentAttempts = 0;
let persistentFailed = false;
try {
  await withRetry(
    async () => {
      persistentAttempts++;
      throw make429();
    },
    retryWaitMs,
    'simulate-persistent-429',
    persistentMetrics,
  );
} catch {
  persistentFailed = true;
}

assertEqual('persistent failure observed', persistentFailed, true);
assertEqual('persistent attempts', persistentAttempts, 3);
assertEqual('persistent retries', persistentMetrics.totalRetries, 3);
assertEqual('persistent 429 count', persistentMetrics.total429, 3);

console.log(JSON.stringify({
  ok: true,
  recoverable: {
    attempts: recoverableAttempts,
    retries: recoverableMetrics.totalRetries,
    total429: recoverableMetrics.total429,
    outcome: recovered,
  },
  persistent: {
    attempts: persistentAttempts,
    retries: persistentMetrics.totalRetries,
    total429: persistentMetrics.total429,
    outcome: 'failed-after-retries',
  },
}, null, 2));
