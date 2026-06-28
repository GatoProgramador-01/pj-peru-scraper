import { logger } from '../logger.js';
import { ROWS_PER_PAGE } from '../config/constants.js';
import type { $Root, ParsedPage, ParsedRow, Session } from '../models/internalTypes.js';
import type { RunMetrics } from '../models/metrics.js';
import type { AdvancePageCtx } from '../models/scraperTypes.js';
import type { SiteConfig } from '../types.js';
import { fetchNextPage } from '../jsf/pagination.js';
import { pageHasNext, parsePaginatorText } from '../parser/paginatorParser.js';
import { jitter } from '../utils/delay.js';
import { withRetry } from '../session/retry.js';

/**
 * Determines whether the scraper should continue fetching the next page.
 *
 * @remarks
 * Uses a three-tier resolution strategy to handle both PrimeFaces (OEFA)
 * and RichFaces (PJ Peru) portals:
 * 1. If paginator text is present, delegate to `pageHasNext` (most reliable).
 * 2. If `totalPages` was parsed from the search response, compare index directly.
 * 3. Fallback: check the DOM next-button OR assume more rows if a full page returned.
 *
 * @param $ - Cheerio root of the current page HTML fragment
 * @param pag - Parsed paginator info; `null` when no paginator text block was found
 * @param current - Parsed page state from the previous request
 * @param nextPageIdx - 0-based index of the page we are about to request
 * @param rows - Rows extracted from the current page (used for fallback heuristic)
 * @returns `true` when there is at least one more page to fetch
 */
export const resolveHasNextPage = (
  $: $Root,
  pag: ReturnType<typeof parsePaginatorText>,
  current: ParsedPage,
  nextPageIdx: number,
  rows: ParsedRow[],
): boolean => {
  if (pag) return pageHasNext($);
  if (current.totalPages != null) return nextPageIdx < current.totalPages;
  return pageHasNext($) || rows.length >= ROWS_PER_PAGE;
};

/**
 * Merges the freshly-fetched page data into the previous page state.
 *
 * @remarks
 * Preserves known `totalPages` / `totalRecords` from earlier responses when the
 * new partial response does not include them (common with RichFaces AJAX updates
 * that only return the table fragment, not the full paginator script block).
 *
 * @param current - Page state from the previous request (used as the base)
 * @param $ - Cheerio root of the newly-fetched HTML
 * @param newViewState - Updated ViewState token; falls back to `current.viewState` if null
 * @param nextRows - Parsed rows extracted from the new HTML
 * @param nextPageIdx - 0-based index of the new page
 * @returns A new `ParsedPage` with updated rows, pagination state, and ViewState
 */
export const buildNextPage = (
  current: ParsedPage,
  $: $Root,
  newViewState: string | null,
  nextRows: ParsedRow[],
  nextPageIdx: number,
): ParsedPage => {
  const pag = parsePaginatorText($);
  return {
    ...current,
    viewState: newViewState ?? current.viewState,
    rows: nextRows,
    hasNextPage: resolveHasNextPage($, pag, current, nextPageIdx, nextRows),
    currentPage: pag?.currentPage ?? nextPageIdx + 1,
    totalPages: pag?.totalPages ?? current.totalPages,
    totalRecords: pag?.totalRecords ?? current.totalRecords,
  };
};

/**
 * Fires the HTTP request for a specific page index, wrapped in retry logic.
 *
 * @remarks
 * Delegates to `fetchNextPage` which builds the correct POST body for either
 * PrimeFaces (OEFA) or RichFaces (PJ Peru) depending on `ctx.useRichFaces`.
 * The retry label encodes page + sector for traceability in logs.
 *
 * @param session - Active axios session with cookie jar
 * @param config - Site configuration providing the base URL and timing
 * @param ctx - Pagination context: current page state, page index, sector, and portal variant
 * @param metrics - Shared run metrics; retry and 429 counts are incremented here
 * @returns Cheerio root of the response HTML and the updated ViewState token
 */
export const advancePage = (
  session: Session,
  config: SiteConfig,
  ctx: AdvancePageCtx,
  metrics: RunMetrics,
): Promise<{ $: $Root; newViewState: string | null }> =>
  withRetry(
    () => fetchNextPage(session, config.startUrl, {
      page: ctx.page,
      targetPageIndex: ctx.pageIndex + 1,
      rowsPerPage: ROWS_PER_PAGE,
      useRichFaces: ctx.useRichFaces,
    }),
    config.timing.retryWaitMs,
    `page-${ctx.pageIndex + 1}-sector-${ctx.sectorId}`,
    metrics,
  );

/**
 * Attempts to advance to the next page, returning `'done'` on any terminal condition.
 *
 * @remarks
 * Two early-exit paths that bypass the HTTP call:
 * - `totalRecords` is known and all records have been collected (OEFA shows a "next"
 *   button on the final page even when nothing is left — trust the count, not the DOM).
 * - The page advance throws after exhausting all retry attempts, which is treated as
 *   the natural end of results rather than a fatal error.
 *
 * A jitter delay is inserted between pages to avoid hammering the portal.
 *
 * @param session - Active axios session with cookie jar
 * @param config - Site configuration providing timing and URL
 * @param ctx - Pagination context for the current page
 * @param metrics - Shared run metrics for retry tracking
 * @param totalScraped - Number of documents collected so far in this sector
 * @param page - Current page state (used to check against `totalRecords`)
 * @returns The raw HTTP result for the next page, or `'done'` to signal loop exit
 */
export const tryAdvancePage = async (
  session: Session,
  config: SiteConfig,
  ctx: AdvancePageCtx,
  metrics: RunMetrics,
  totalScraped: number,
  page: ParsedPage,
): Promise<{ $: $Root; newViewState: string | null } | 'done'> => {
  if (page.totalRecords !== null && totalScraped >= page.totalRecords) {
    logger.info('All records collected - sector complete', {
      sectorId: ctx.sectorId,
      totalScraped,
      totalRecords: page.totalRecords,
    });
    return 'done';
  }

  if (config.timing.pageDelayMs[1] > 0) await jitter(...config.timing.pageDelayMs);

  try {
    return await advancePage(session, config, ctx, metrics);
  } catch (err) {
    logger.warn('Page advance failed after all retries — treating as end of results', {
      sectorId: ctx.sectorId,
      pageIndex: ctx.pageIndex,
      error: (err as Error).message,
    });
    return 'done';
  }
};
