const RATE_LIMIT_SIGNALS = [
  'demasiadas solicitudes', 'too many requests', 'acceso denegado',
  'access denied', 'rate limit', 'por favor espere', 'please wait',
];

export const isRateLimited = (html: string): boolean =>
  RATE_LIMIT_SIGNALS.some(s => html.toLowerCase().includes(s));

/**
 * Returns the number of ms to wait if this is a 429 error, 0 otherwise.
 * Reads Retry-After header (seconds or HTTP-date format).
 */
export const extract429WaitMs = (err: unknown): number => {
  const axiosErr = err as { response?: { status?: number; headers?: Record<string, string | string[]> } };
  if (axiosErr?.response?.status !== 429) return 0;
  const ra = axiosErr.response?.headers?.['retry-after'];
  if (!ra) return 60_000;
  const val = Array.isArray(ra) ? ra[0] : ra;
  const seconds = Number(val);
  if (!isNaN(seconds)) return seconds * 1_000;
  const httpDate = new Date(val);
  if (!isNaN(httpDate.getTime())) return Math.max(0, httpDate.getTime() - Date.now());
  return 60_000;
};
