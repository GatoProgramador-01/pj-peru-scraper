import { logger } from '../logger.js';
import { createRunMetrics } from '../models/metrics.js';

/**
 * Formats a millisecond duration as a compact human-readable string.
 *
 * @remarks
 * Used in run-completion log lines and the terminal summary table.
 * Under 60 s → `"Xs"`, at or above → `"XmYs"`.
 *
 * @param ms - Total elapsed milliseconds to format
 * @returns Compact duration string
 */
export const formatDuration = (ms: number): string => {
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
};

/**
 * Derives the human-readable throughput stats for the final run summary.
 *
 * @remarks
 * `elapsedMin` is floored at 0.001 to avoid division-by-zero when the run
 * completes in under a millisecond (tests). `avgPdfLatencyMs` is 0 when no
 * PDF latency samples were recorded. All rates are rounded to the nearest
 * integer.
 *
 * @param metrics - Shared run metrics accumulated across all sectors
 * @param elapsedMs - Total wall-clock time for the run in milliseconds
 * @returns Object with elapsedMin, totalPdfCompleted, avgPdfLatencyMs, docsPerMinute, pdfsPerMinute
 */
export const calcRunStats = (
  metrics: ReturnType<typeof createRunMetrics>,
  elapsedMs: number,
): { elapsedMin: number; totalPdfCompleted: number; avgPdfLatencyMs: number; docsPerMinute: number; pdfsPerMinute: number } => {
  const elapsedMin = Math.max(elapsedMs / 60_000, 0.001);
  const totalPdfCompleted = metrics.totalPdfDownloaded + metrics.totalSkippedExisting;
  const avgPdfLatencyMs = metrics.pdfLatencySamples.length > 0
    ? Math.round(metrics.pdfLatencySamples.reduce((sum, ms) => sum + ms, 0) / metrics.pdfLatencySamples.length)
    : 0;
  return {
    elapsedMin,
    totalPdfCompleted,
    avgPdfLatencyMs,
    docsPerMinute: Math.round(metrics.totalDocumentsCollected / elapsedMin),
    pdfsPerMinute: Math.round(totalPdfCompleted / elapsedMin),
  };
};

/**
 * Logs a one-line completion summary for a finished sector.
 *
 * @remarks
 * Formats cumulative elapsed time from `runStart` so the log entry is
 * self-contained without needing to diff timestamps. Called after every
 * `scrapeSectorWithRetry` call in the sector loop.
 *
 * @param i - Zero-based index of the completed sector
 * @param total - Total number of sectors in the run
 * @param sectorId - Identifier code for the sector, or null if unavailable
 * @param sectorName - Display name of the sector, or null if unavailable
 * @param sectorCount - Number of documents collected in this sector
 * @param totalSoFar - Cumulative document count across all completed sectors
 * @param runStart - `Date.now()` timestamp recorded at run start
 */
export const logSectorDone = (
  i: number,
  total: number,
  sectorId: string | null,
  sectorName: string | null,
  sectorCount: number,
  totalSoFar: number,
  runStart: number,
): void => {
  const runSec = Math.round((Date.now() - runStart) / 1000);
  logger.info(`Sector ${i + 1}/${total} done`, {
    sector: `${sectorId}=${sectorName}`,
    sectorDocs: sectorCount,
    totalSoFar,
    runElapsed: runSec < 60 ? `${runSec}s` : `${Math.floor(runSec / 60)}m${runSec % 60}s`,
  });
};
