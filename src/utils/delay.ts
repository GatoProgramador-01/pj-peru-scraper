/**
 * Pauses execution for exactly `ms` milliseconds.
 *
 * @param ms - Duration in milliseconds; must be ≥ 0
 * @returns A promise that resolves after the delay
 * @example
 * await sleep(500);
 */
export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/**
 * Pauses for a random duration between `min` and `max` milliseconds.
 *
 * @param min - Lower bound in milliseconds (inclusive)
 * @param max - Upper bound in milliseconds (exclusive)
 * @returns A promise that resolves after the random delay
 * @example
 * await jitter(...config.timing.pageDelayMs);
 */
export const jitter = (min: number, max: number): Promise<void> =>
  sleep(min + Math.floor(Math.random() * (max - min)));
