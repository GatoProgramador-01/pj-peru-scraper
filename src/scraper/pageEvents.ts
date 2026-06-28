import { logger } from '../logger.js';
import type { ParsedPage } from '../models/internalTypes.js';
import type { PageEvent, RunMetrics } from '../models/metrics.js';
import type { PagePdfStats } from '../models/pdfTypes.js';
import type { JudicialDocument } from '../types.js';

/**
 * Constructs a structured `PageEvent` for a successfully scraped page.
 *
 * @remarks
 * `PageEvent` records are appended to the run's `pageEvents` array after every page
 * and flushed to `output/<run>/page-events.jsonl` by `writeRunReports`. They enable
 * post-run analysis of throughput, per-page PDF rates, and sector progress without
 * re-parsing Winston log files.
 *
 * PDF counters are spread directly from `pagePdfStats` so the event mirrors the
 * same fields tracked by `PagePdfStats` (downloaded, failed, missing, confidential,
 * skipped-existing).
 *
 * @param site - Site key (`'pj-peru'` | `'oefa'`)
 * @param sectorId - Sector identifier used as the search filter value; `null` for single-sector sites
 * @param sectorName - Human-readable sector label (e.g. `'MINERIA'`)
 * @param pageIndex - 0-based page index
 * @param page - Current page state (provides `totalPages` and `totalRecords` for the label)
 * @param toWrite - Documents collected from this page (may be a slice when a limit is active)
 * @param metrics - Shared run metrics snapshot at emit time (cumulative document count)
 * @param runLimit - Global document limit; `null` when no limit is set
 * @param pagePdfStats - Per-page PDF download counters
 * @param elapsed - Formatted elapsed time string (e.g. `"1m42s"`)
 * @returns A fully-populated `PageEvent` of type `'pageScraped'`
 */
export const buildPageEvent = (
  site: string,
  sectorId: string | null,
  sectorName: string | null,
  pageIndex: number,
  page: ParsedPage,
  toWrite: JudicialDocument[],
  metrics: RunMetrics,
  runLimit: number | null,
  pagePdfStats: PagePdfStats,
  elapsed: string,
): PageEvent => ({
  type: 'pageScraped',
  site,
  sectorId,
  sectorName,
  pageIndex,
  pageLabel: `${pageIndex + 1}${page.totalPages != null ? `/${page.totalPages}` : '/?'}`,
  docsThisPage: toWrite.length,
  totalDocs: metrics.totalDocumentsCollected,
  targetDocs: runLimit,
  totalRecords: page.totalRecords,
  ...pagePdfStats,
  elapsed,
  createdAt: new Date().toISOString(),
});

/**
 * Emits a structured `info`-level log entry after a page is successfully scraped.
 *
 * @remarks
 * Combines document throughput, PDF rates, and pagination progress into a single
 * log line so the Winston file log is self-contained for post-run analysis.
 * The `remaining` field subtracts `totalScraped` from `totalRecords` to give an
 * ETA-friendly count; it is omitted (shown as `'?'`) when `totalRecords` is unknown.
 *
 * @param sectorId - Sector identifier for the log context field
 * @param sectorName - Human-readable sector label
 * @param pageIndex - 0-based page index just processed
 * @param page - Current page state (provides `totalPages` and `totalRecords`)
 * @param toWrite - Documents emitted from this page
 * @param totalScraped - Cumulative documents collected in this sector
 * @param runLimit - Global document limit for the `totalDocs` display; `null` means unlimited
 * @param metrics - Shared run metrics (cumulative `totalDocumentsCollected`)
 * @param pagePdfStats - Per-page PDF counters spread into the log object
 * @param pdfRate - PDFs-per-minute throughput for this page's download batch
 * @param docsPerMin - Documents-per-minute throughput; `null` during the 5-second warmup window
 * @param elapsed - Formatted elapsed time string
 */
export const logPageScraped = (
  sectorId: string | null,
  sectorName: string | null,
  pageIndex: number,
  page: ParsedPage,
  toWrite: JudicialDocument[],
  totalScraped: number,
  runLimit: number | null,
  metrics: RunMetrics,
  pagePdfStats: PagePdfStats,
  pdfRate: number,
  docsPerMin: number | null,
  elapsed: string,
): void => {
  const remaining = page.totalRecords != null ? page.totalRecords - totalScraped : null;
  logger.info('Page scraped', {
    sector: `${sectorId}=${sectorName}`,
    page: `${pageIndex + 1}${page.totalPages != null ? `/${page.totalPages}` : '/?'}`,
    docsThisPage: toWrite.length,
    totalDocs: runLimit !== null ? `${metrics.totalDocumentsCollected}/${runLimit}` : metrics.totalDocumentsCollected,
    totalScraped,
    totalRecords: page.totalRecords ?? '?',
    remaining: remaining != null ? remaining : '?',
    ...pagePdfStats,
    pdfRate: `${pdfRate} pdfs/min`,
    rate: docsPerMin != null ? `${docsPerMin} docs/min` : '-',
    elapsed,
  });
};
