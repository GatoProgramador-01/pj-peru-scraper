import { logger } from '../logger.js';
import type { RunMetrics } from '../models/metrics.js';
import { sleep } from '../utils/delay.js';
import { extract429WaitMs } from './rateLimit.js';

/**
 * Retries fn up to 3 times.
 * On HTTP 429: waits max(Retry-After, configured base wait).
 * On other errors: waits configured base wait.
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  waits: [number, number, number],
  label: string,
  metrics?: RunMetrics,
): Promise<T> => {
  let lastErr: Error = new Error('No attempts made');
  for (let i = 0; i < 3; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err as Error;
      const waitFrom429 = extract429WaitMs(err);
      const is429 = waitFrom429 > 0;
      const waitMs = is429 ? Math.max(waitFrom429, waits[i]) : waits[i];
      if (metrics) {
        metrics.totalRetries++;
        if (is429) metrics.total429++;
      }
      logger.warn(is429 ? '429 rate limit — backing off' : 'Request failed, retrying', {
        attempt: i + 1, of: 3, label, waitMs, error: lastErr.message,
      });
      await sleep(waitMs);
    }
  }
  throw lastErr;
};
