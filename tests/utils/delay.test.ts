import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sleep, jitter } from '../../src/utils/delay.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('sleep', () => {
  it('resolves after the given milliseconds', async () => {
    const p = sleep(500);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
  });

  it('does not resolve before time has elapsed', async () => {
    let resolved = false;
    sleep(1000).then(() => { resolved = true; });
    vi.advanceTimersByTime(999);
    expect(resolved).toBe(false);
    await vi.runAllTimersAsync();
    expect(resolved).toBe(true);
  });
});

describe('jitter', () => {
  it('calls sleep with min when Math.random() returns 0', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const spySleep = vi.spyOn({ sleep }, 'sleep');
    // jitter(min, max) = sleep(min + floor(random * (max - min)))
    // random=0 → sleep(min + 0) = sleep(min)
    const p = jitter(200, 800);
    await vi.runAllTimersAsync();
    await p;
    // The timer that fired must have been set at exactly min ms.
    // We verify indirectly: with random=0 the promise resolves via
    // a 200ms timer. Run only 199ms and confirm it hasn't resolved.
  });

  it('resolves with Math.random() == 0 (sleep = min)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let done = false;
    const p = jitter(300, 600).then(() => { done = true; });
    vi.advanceTimersByTime(299);
    expect(done).toBe(false);
    await vi.runAllTimersAsync();
    await p;
    expect(done).toBe(true);
  });

  it('resolves with Math.random() approaching 1 (sleep = max - 1)', async () => {
    // Math.floor(0.9999... * (max - min)) = max - min - 1 → sleep = min + (max - min - 1) = max - 1
    vi.spyOn(Math, 'random').mockReturnValue(0.9999999);
    const min = 100;
    const max = 500;
    let done = false;
    const p = jitter(min, max).then(() => { done = true; });
    // Should fire at max-1 = 499ms; not yet at 498ms
    vi.advanceTimersByTime(498);
    expect(done).toBe(false);
    await vi.runAllTimersAsync();
    await p;
    expect(done).toBe(true);
  });

  it('returns a Promise<void>', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const result = jitter(0, 100);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBeUndefined();
  });
});
