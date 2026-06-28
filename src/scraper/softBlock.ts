import { logger } from '../logger.js';
import { CONSECUTIVE_EMPTY_ABORT } from '../config/constants.js';
import type { ParsedPage } from '../models/internalTypes.js';
import type { PageEvent, RunMetrics } from '../models/metrics.js';

/**
 * Builds a structured `PageEvent` representing a soft-block state change.
 *
 * @remarks
 * A soft block is a portal-side throttle that returns HTTP 200 with a valid page
 * structure but zero result rows while still signalling more pages. This event is
 * appended to `pageEvents` so the run report can surface the occurrence without
 * relying on log parsing.
 *
 * @param type - `'soft_block_warning'` for interim empty pages; `'soft_block_abort'` on final abort
 * @param site - Site key (`'pj-peru'` | `'oefa'`) for event attribution
 * @param sectorId - Sector being scraped at the time of the block; `null` for single-sector sites
 * @param sectorName - Human-readable sector label for display and reporting
 * @param pageIndex - 0-based page index where the empty response was received
 * @param page - Current page state (used to derive the page label and totalRecords)
 * @param metrics - Shared run metrics snapshot at the time of the event
 * @param runLimit - Global document limit for this run; `null` means no limit
 * @param elapsed - Formatted elapsed time string (e.g. `"2m14s"`)
 * @returns A fully-populated `PageEvent` with all PDF counters set to zero
 */
const buildSoftBlockEvent = (
  type: 'soft_block_abort' | 'soft_block_warning',
  site: string,
  sectorId: string | null,
  sectorName: string | null,
  pageIndex: number,
  page: ParsedPage,
  metrics: RunMetrics,
  runLimit: number | null,
  elapsed: string,
): PageEvent => ({
  type,
  site,
  sectorId,
  sectorName,
  pageIndex,
  pageLabel: `${pageIndex + 1}${page.totalPages != null ? `/${page.totalPages}` : '/?'}`,
  docsThisPage: 0,
  totalDocs: metrics.totalDocumentsCollected,
  targetDocs: runLimit,
  totalRecords: page.totalRecords,
  pdfDownloadedThisPage: 0,
  pdfFailedThisPage: 0,
  pdfMissingThisPage: 0,
  pdfConfidentialThisPage: 0,
  pdfSkippedExistingThisPage: 0,
  elapsed,
  createdAt: new Date().toISOString(),
});

/**
 * Evaluates a consecutive-empty-page counter and decides whether to warn or abort.
 *
 * @remarks
 * Called from the pagination loop every time a page returns zero rows while the
 * paginator still signals more pages. The counter is maintained by the caller and
 * incremented before this function is invoked.
 *
 * Behaviour:
 * - `consecutiveEmptyPages < CONSECUTIVE_EMPTY_ABORT` → emits a warning event and returns `'continue'`
 * - `consecutiveEmptyPages >= CONSECUTIVE_EMPTY_ABORT` → emits an abort event and returns `'abort'`
 *
 * Both paths append a `PageEvent` to `ctx.pageEvents` for the run report and log
 * a `warn`-level message via Winston so the condition is visible in the log file.
 *
 * @param consecutiveEmptyPages - How many empty pages have been seen in a row (already incremented)
 * @param page - Current page state (for the event payload)
 * @param pageIndex - 0-based index of the empty page
 * @param ctx - Shared sector context carrying metrics, events, and identification fields
 * @param elapsed - Formatted elapsed time string at the moment of detection
 * @returns `'abort'` to break the pagination loop; `'continue'` to advance to the next page
 */
export const handleSoftBlock = (
  consecutiveEmptyPages: number,
  page: ParsedPage,
  pageIndex: number,
  ctx: {
    site: string;
    sectorId: string | null;
    sectorName: string | null;
    metrics: RunMetrics;
    pageEvents: PageEvent[];
    runLimit: number | null;
    totalScraped: number;
  },
  elapsed: string,
): 'abort' | 'continue' => {
  const reachedAbortThreshold = consecutiveEmptyPages >= CONSECUTIVE_EMPTY_ABORT;
  const blockType: 'soft_block_abort' | 'soft_block_warning' = reachedAbortThreshold
    ? 'soft_block_abort'
    : 'soft_block_warning';

  logger.warn(
    `${blockType} [${consecutiveEmptyPages}/${CONSECUTIVE_EMPTY_ABORT}]: 0 rows on page with hasNextPage=true`,
    { sectorId: ctx.sectorId, pageIndex, totalScraped: ctx.totalScraped },
  );

  ctx.pageEvents.push(
    buildSoftBlockEvent(
      blockType,
      ctx.site, ctx.sectorId, ctx.sectorName,
      pageIndex, page, ctx.metrics, ctx.runLimit, elapsed,
    ),
  );

  return reachedAbortThreshold ? 'abort' : 'continue';
};
