import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRateLimited, extract429WaitMs } from '../../src/session/rateLimit.js';

/** DEFAULT_RETRY_AFTER_MS = 60_000 (from src/config/constants.ts) */
const DEFAULT_RETRY_AFTER_MS = 60_000;

describe('isRateLimited', () => {
  it('returns true for "demasiadas solicitudes" (case-insensitive)', () => {
    expect(isRateLimited('<html>DEMASIADAS SOLICITUDES</html>')).toBe(true);
  });

  it('returns true for "too many requests" (case-insensitive)', () => {
    expect(isRateLimited('<html>Too Many Requests</html>')).toBe(true);
  });

  it('returns true for "rate limit"', () => {
    expect(isRateLimited('<html>Rate Limit exceeded</html>')).toBe(true);
  });

  it('returns true for "acceso denegado"', () => {
    expect(isRateLimited('<p>Acceso Denegado al sistema</p>')).toBe(true);
  });

  it('returns true for "access denied"', () => {
    expect(isRateLimited('<body>Access Denied</body>')).toBe(true);
  });

  it('returns true for "por favor espere"', () => {
    expect(isRateLimited('Por favor espere unos momentos')).toBe(true);
  });

  it('returns true for "please wait"', () => {
    expect(isRateLimited('Please Wait while we process your request')).toBe(true);
  });

  it('returns false for normal HTML (no rate-limit signals)', () => {
    expect(isRateLimited('<html><body><h1>Resultados de búsqueda</h1></body></html>')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isRateLimited('')).toBe(false);
  });

  it('returns false for unrelated error text', () => {
    expect(isRateLimited('<html>Error 500 — Internal Server Error</html>')).toBe(false);
  });

  it('is case-insensitive for all signals', () => {
    expect(isRateLimited('RATE LIMIT')).toBe(true);
    expect(isRateLimited('TOO MANY REQUESTS')).toBe(true);
    expect(isRateLimited('please wait')).toBe(true);
  });
});

describe('extract429WaitMs', () => {
  it('returns 0 for a non-429 error (status 500)', () => {
    const err = { response: { status: 500, headers: {} } };
    expect(extract429WaitMs(err)).toBe(0);
  });

  it('returns 0 for a non-429 error (status 503)', () => {
    const err = { response: { status: 503 } };
    expect(extract429WaitMs(err)).toBe(0);
  });

  it('returns 0 when err has no response', () => {
    expect(extract429WaitMs(new Error('network failure'))).toBe(0);
  });

  it('returns 0 for null/undefined', () => {
    expect(extract429WaitMs(null)).toBe(0);
    expect(extract429WaitMs(undefined)).toBe(0);
  });

  it('returns DEFAULT_RETRY_AFTER_MS for 429 with no Retry-After header', () => {
    const err = { response: { status: 429, headers: {} } };
    expect(extract429WaitMs(err)).toBe(DEFAULT_RETRY_AFTER_MS);
  });

  it('returns DEFAULT_RETRY_AFTER_MS for 429 when headers is missing', () => {
    const err = { response: { status: 429 } };
    expect(extract429WaitMs(err)).toBe(DEFAULT_RETRY_AFTER_MS);
  });

  it('returns seconds * 1000 for numeric Retry-After header (string "30")', () => {
    const err = { response: { status: 429, headers: { 'retry-after': '30' } } };
    expect(extract429WaitMs(err)).toBe(30_000);
  });

  it('returns seconds * 1000 for numeric Retry-After of "120"', () => {
    const err = { response: { status: 429, headers: { 'retry-after': '120' } } };
    expect(extract429WaitMs(err)).toBe(120_000);
  });

  it('returns seconds * 1000 when Retry-After is an array (first element used)', () => {
    const err = { response: { status: 429, headers: { 'retry-after': ['45'] } } };
    expect(extract429WaitMs(err)).toBe(45_000);
  });

  it('returns date-relative ms for HTTP-date Retry-After', () => {
    // Fix Date.now so we can compute an exact expected value
    const nowMs = 1_700_000_000_000; // arbitrary fixed epoch ms
    vi.spyOn(Date, 'now').mockReturnValue(nowMs);

    const futureDate = new Date(nowMs + 90_000); // 90 seconds in the future
    const err = {
      response: {
        status: 429,
        headers: { 'retry-after': futureDate.toUTCString() },
      },
    };
    expect(extract429WaitMs(err)).toBe(90_000);

    vi.restoreAllMocks();
  });

  it('clamps to 0 when HTTP-date Retry-After is in the past', () => {
    const nowMs = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(nowMs);

    const pastDate = new Date(nowMs - 5_000); // 5 seconds in the past
    const err = {
      response: {
        status: 429,
        headers: { 'retry-after': pastDate.toUTCString() },
      },
    };
    expect(extract429WaitMs(err)).toBe(0);

    vi.restoreAllMocks();
  });

  it('returns DEFAULT_RETRY_AFTER_MS for an invalid Retry-After value', () => {
    const err = {
      response: {
        status: 429,
        headers: { 'retry-after': 'not-a-date-or-number' },
      },
    };
    expect(extract429WaitMs(err)).toBe(DEFAULT_RETRY_AFTER_MS);
  });
});
