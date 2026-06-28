import { logger } from '../logger.js';
import type { RunMetrics } from '../models/metrics.js';
import { sleep } from '../utils/delay.js';
import { extract429WaitMs } from './rateLimit.js';

const MAX_RETRY_ATTEMPTS = 3;

/**
 * Retries fn up to MAX_RETRY_ATTEMPTS times.
 * On HTTP 429: waits max(Retry-After, configured base wait).
 * On other errors: waits configured base wait.
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  waits: readonly number[],
  label: string,
  metrics?: RunMetrics,
): Promise<T> => {
  let lastErr: Error = new Error('No attempts made');
  for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err as Error;
      const waitFrom429 = extract429WaitMs(err);
      const is429 = waitFrom429 > 0;
      const base = is429 ? Math.max(waitFrom429, waits[i]) : waits[i];
      // Full jitter: pick uniformly from [base/2, base] to desynchronize retry storms
      // when multiple workers fail at the same time and all retry simultaneously.
      const half = base / 2;
      const waitMs = Math.round(half + Math.random() * half);
      if (metrics) {
        metrics.totalRetries++;
        if (is429) metrics.total429++;
      }
      logger.warn(is429 ? '429 rate limit — backing off' : 'Request failed, retrying', {
        attempt: i + 1, of: MAX_RETRY_ATTEMPTS, label, waitMs, error: lastErr.message,
      });
      await sleep(waitMs);
    }
  }
  throw lastErr;
};
