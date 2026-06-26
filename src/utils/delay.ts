export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

export const jitter = (min: number, max: number): Promise<void> =>
  sleep(min + Math.floor(Math.random() * (max - min)));
