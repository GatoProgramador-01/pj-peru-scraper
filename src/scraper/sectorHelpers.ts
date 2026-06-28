import type { ParsedPage } from '../models/internalTypes.js';
import type { PageMetrics } from '../models/scraperTypes.js';

/**
 * Formats elapsed milliseconds as a compact human-readable duration.
 *
 * @param startMs - `Date.now()` value captured at the start of the timed operation
 * @returns `"Xs"` for durations under one minute; `"XmYs"` for longer runs
 *
 * @example
 * elapsedSince(Date.now() - 75_000) // → "1m15s"
 * elapsedSince(Date.now() - 4_000)  // → "4s"
 */
export const elapsedSince = (startMs: number): string => {
  const sec = Math.round((Date.now() - startMs) / 1000);
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
};

/**
 * Returns `true` when the per-sector document limit has been reached.
 *
 * @param total - Number of documents collected so far in this sector
 * @param limit - Maximum documents to collect; `null` means no limit
 */
export const hasReachedDocLimit = (total: number, limit: number | null): boolean =>
  limit !== null && total >= limit;

/**
 * Returns `true` when an empty page qualifies as a soft-block condition.
 *
 * @remarks
 * A soft block is a portal-side rate-limit that returns HTTP 200 with a valid
 * page structure but zero rows. We only treat it as suspicious when the paginator
 * still signals a next page AND we are past the first page — an empty page 0 means
 * the search itself returned nothing, which is a normal termination condition.
 *
 * @param hasNext - Whether the paginator signals more pages are available
 * @param pageIndex - 0-based index of the current page
 */
export const isSoftBlock = (hasNext: boolean, pageIndex: number): boolean =>
  hasNext && pageIndex > 0;

/**
 * Returns `true` when PDF downloads should be attempted for the current page.
 *
 * @param pdfDir - Output directory for PDFs; falsy values disable downloads
 * @param dryRun - When `true`, no writes occur — PDFs are skipped regardless
 */
export const shouldDownloadPdfs = (pdfDir: string | null | undefined, dryRun: boolean): boolean =>
  Boolean(pdfDir) && !dryRun;

/**
 * Detects the RichFaces quirk where the portal omits the "next" paginator
 * button on the initial search response even though more pages exist.
 *
 * @remarks
 * PJ Peru's RichFaces DataScroller does not render navigation buttons on the
 * initial full-page load — they only appear in subsequent AJAX responses.
 * If `hasNextPage` is false but `totalPages` is unknown and a full page of
 * rows was returned, we assume there are more pages and override the flag.
 *
 * @param page - Parsed page state from the initial search response
 * @returns `true` when the missing-next-button heuristic applies
 */
export const richFacesMissingNextButton = (page: ParsedPage): boolean =>
  !page.hasNextPage && page.totalPages === null && page.rows.length >= 10;

/**
 * Returns `true` when `totalRecords` was scraped but `totalPages` was not.
 *
 * @remarks
 * RichFaces AJAX partial responses on PJ Peru include the record count in the
 * result header but never the DataScroller config script that encodes `totalPages`.
 * When this is detected, the caller should derive `totalPages` from
 * `Math.ceil(totalRecords / ROWS_PER_PAGE)` on the initial full-page response.
 *
 * @param page - Parsed page state (typically from the search POST response)
 */
export const paginatorHidTotalPages = (page: ParsedPage): boolean =>
  page.totalRecords !== null && page.totalPages === null;

/**
 * Computes per-page throughput metrics for the terminal progress display.
 *
 * @remarks
 * All rates are suppressed (returned as `null`) during the first 5 seconds to
 * avoid misleading numbers while the connection is still warming up.
 * `pdfRate` uses a 1-second floor so a near-instant batch never reports infinity.
 *
 * @param totalScraped - Cumulative documents collected in this sector run
 * @param pageIndex - 0-based index of the page just processed
 * @param elapsedMs - Total wall-clock time since the sector started (milliseconds)
 * @param pagePdfMs - Wall-clock time spent on PDF downloads for this page alone
 * @param pdfCompleted - PDFs downloaded + skipped (already existed) for this page
 * @returns Throughput rates: docs/min, pages/min, and pdfs/min
 */
export const calcPageMetrics = (
  totalScraped: number,
  pageIndex: number,
  elapsedMs: number,
  pagePdfMs: number,
  pdfCompleted: number,
): PageMetrics => {
  const elapsedSec = elapsedMs / 1000;
  const docsPerMin = elapsedSec > 5 ? Math.round((totalScraped / elapsedSec) * 60) : null;
  const pagesPerMin = elapsedSec > 5 ? Math.round(((pageIndex + 1) / elapsedSec) * 60 * 10) / 10 : null;
  const pagePdfSec = Math.max(1, pagePdfMs / 1000);
  const pdfRate = Math.round((pdfCompleted / pagePdfSec) * 60);
  return { docsPerMin, pagesPerMin, pdfRate };
};
