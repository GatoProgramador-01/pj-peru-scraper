// Tests for src/session/retry.ts — withRetry()
// Fake timers eliminate real waits — all delays are 0ms in tests.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { withRetry } from '../../src/session/retry.js';
import type { RunMetrics } from '../../src/models/metrics.js';

const make429 = (): axios.AxiosError => {
  const e = new axios.AxiosError('429', '429');
  e.response = { status: 429 } as any;
  return e;
};

const makeMetrics = (): RunMetrics => ({
  totalDocumentsCollected: 0, totalPdfCandidates: 0, totalPdfDownloaded: 0,
  totalPdfFailed: 0, totalPdfMissing: 0, totalPdfConfidential: 0,
  totalSkippedExisting: 0, total429: 0, totalRetries: 0,
  pdfLatencySamples: [], startedAt: Date.now(),
});

const WAITS: [number, number, number] = [0, 0, 0];

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('withRetry', () => {
  it('succeeds on first try — calls fn once', async () => {
    const fn = vi.fn().mockResolvedValueOnce('ok');
    const p = withRetry(fn, WAITS, 'test');
    await vi.runAllTimersAsync();
    expect(await p).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fails once then succeeds — calls fn twice', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');
    const p = withRetry(fn, WAITS, 'test');
    await vi.runAllTimersAsync();
    expect(await p).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fails all 3 attempts — throws the last error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('attempt 1'))
      .mockRejectedValueOnce(new Error('attempt 2'))
      .mockRejectedValueOnce(new Error('final failure'));
    // Attach handler BEFORE flushing timers — prevents unhandled rejection warning
    const assertion = expect(withRetry(fn, WAITS, 'test')).rejects.toThrow('final failure');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('HTTP 429 — retries and increments metrics.total429', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(make429())
      .mockResolvedValueOnce('after-429');
    const metrics = makeMetrics();
    const p = withRetry(fn, WAITS, 'test', metrics);
    await vi.runAllTimersAsync();
    await p;
    expect(metrics.total429).toBe(1);
    expect(metrics.totalRetries).toBe(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('increments totalRetries once per retry, not per call', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
      .mockResolvedValueOnce('done');
    const metrics = makeMetrics();
    const p = withRetry(fn, WAITS, 'test', metrics);
    await vi.runAllTimersAsync();
    await p;
    expect(metrics.totalRetries).toBe(2);
    expect(metrics.total429).toBe(0);
  });
});
