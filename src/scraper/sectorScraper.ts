import { logger } from '../logger.js';
import { CONSECUTIVE_EMPTY_ABORT, ROWS_PER_PAGE } from '../config/constants.js';
import * as display from '../display/terminal.js';
import type { $Root, ParsedPage, ParsedRow, Session } from '../models/internalTypes.js';
import type { RunMetrics } from '../models/metrics.js';
import type { AdvancePageCtx, PageMetrics, SectorContext, SectorResult } from '../models/scraperTypes.js';
import type { JudicialDocument, ScrapeOptions, SiteConfig } from '../types.js';
import { loadCheckpoint, saveCheckpoint } from '../checkpoint/checkpointManager.js';
import { fetchNextPage } from '../jsf/pagination.js';
import { submitSearch } from '../jsf/searchForm.js';
import { parsePage } from '../parser/pageParser.js';
import { pageHasNext, parsePaginatorText } from '../parser/paginatorParser.js';
import { parseRows } from '../parser/rowParser.js';
import { rowToDocument } from '../parser/documentMapper.js';
import { fetchStartPage } from '../session/session.js';
import { withRetry } from '../session/retry.js';
import { jitter } from '../utils/delay.js';
import { emptyPdfStats, downloadPagePdfs } from './pdfBatch.js';

// --- Pagination helpers ---

const resolveHasNextPage = (
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

const buildNextPage = (
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

const advancePage = (
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

// --- Pure helpers ---

const elapsedSince = (startMs: number): string => {
  const sec = Math.round((Date.now() - startMs) / 1000);
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
};

const hasReachedDocLimit = (total: number, limit: number | null): boolean =>
  limit !== null && total >= limit;

const isSoftBlock = (hasNext: boolean, pageIndex: number): boolean =>
  hasNext && pageIndex > 0;

const shouldDownloadPdfs = (pdfDir: string | null | undefined, dryRun: boolean): boolean =>
  Boolean(pdfDir) && !dryRun;

const richFacesMissingNextButton = (page: ParsedPage): boolean =>
  !page.hasNextPage && page.totalPages === null && page.rows.length >= ROWS_PER_PAGE;

const paginatorHidTotalPages = (page: ParsedPage): boolean =>
  page.totalRecords !== null && page.totalPages === null;

const calcPageMetrics = (
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

// --- Main scraper ---

export const scrapeSector = async (
  session: Session,
  config: SiteConfig,
  opts: ScrapeOptions,
  ctx: SectorContext,
): Promise<SectorResult> => {
  const { sectorId, sectorName, metrics, failedPdfs, pageEvents, runLimit } = ctx;
  const { site, pdfDir, limit, dryRun } = opts;
  const envPdfConcurrency = Number(process.env.PDF_CONCURRENCY ?? 1) || 1;
  const pdfConcurrency = Math.max(1, opts.pdfConcurrency ?? envPdfConcurrency);
  const useRichFaces = config.rowParser === 'richfacesRepeat';
  const districtId = opts.districtId ?? null;

  // With memory-first output, mid-district checkpoints can't restore the
  // in-memory doc buffer, so resuming from a partial startPage would silently
  // drop the already-scraped pages. Only the completed=true flag is meaningful:
  // it lets parallel-districts skip a finished district on --resume.
  const { completed } = opts.resume
    ? loadCheckpoint(site, sectorId, districtId, opts.checkpointId)
    : { completed: false };

  if (completed) return { count: 0, docs: [] };

  const collected: JudicialDocument[] = [];
  let totalScraped = 0;
  let pageIndex = 0;
  const sectorStart = Date.now();

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  display.phaseStep('Bootstrap session');
  const $initial = await withRetry(
    () => fetchStartPage(session, config.startUrl),
    config.timing.retryWaitMs,
    `bootstrap-sector-${sectorId}`,
    metrics,
  );
  display.phaseOk('Session ready', elapsedSince(sectorStart));
  let page = parsePage($initial, config, config.baseUrl);

  // ── Search submit ──────────────────────────────────────────────────────────
  if (config.search) {
    display.phaseStep('Submitting search');
    page = await withRetry(
      () => submitSearch(
        session,
        { url: config.startUrl, page, config },
        { sectorId, districtId, searchFields: opts.searchFields },
      ),
      config.timing.retryWaitMs,
      `search-sector-${sectorId}${districtId ? `-d${districtId}` : ''}`,
      metrics,
    );

    // RichFaces AJAX partial responses never include the DataScroller config script,
    // so totalPages must be derived from totalRecords on the initial full-page load.
    if (paginatorHidTotalPages(page)) {
      page = { ...page, totalPages: Math.ceil(page.totalRecords! / ROWS_PER_PAGE) };
    }

    display.phaseOk(
      'Search complete',
      `${page.totalRecords ?? '?'} records · ${page.totalPages ?? '?'} pages · ${elapsedSince(sectorStart)}`,
    );

    // Portals like pj-peru (RichFaces) don't render paginator buttons on initial GET —
    // if hasNextPage is false but we got a full page and totalPages is unknown, assume more.
    if (richFacesMissingNextButton(page)) page = { ...page, hasNextPage: true };

    logger.info('Search submitted - first page received', {
      sector: `${sectorId}=${sectorName}`,
      rowsFound: page.rows.length,
      totalRecords: page.totalRecords ?? '?',
      totalPages: page.totalPages ?? '?',
      elapsed: elapsedSince(sectorStart),
    });

    if (page.rows.length === 0) {
      logger.warn('Zero results for sector - skipping', { sectorId, sectorName });
      return { count: 0, docs: [] };
    }
  }

  // ── Pagination loop ────────────────────────────────────────────────────────
  let consecutiveEmptyPages = 0;

  while (true) {
    if (hasReachedDocLimit(totalScraped, limit)) { logger.info('Limit reached', { limit }); break; }

    const docs = page.rows.map(rowToDocument({ site, pageIndex, columns: config.columns, sectorId, sectorName }));

    if (docs.length === 0) {
      if (!isSoftBlock(page.hasNextPage, pageIndex)) {
        logger.info('Empty page - end of results', { sectorId, pageIndex });
        break;
      }

      consecutiveEmptyPages++;
      const reachedAbortThreshold = consecutiveEmptyPages >= CONSECUTIVE_EMPTY_ABORT;
      const blockType = reachedAbortThreshold ? 'soft_block_abort' : 'soft_block_warning';
      logger.warn(`${blockType} [${consecutiveEmptyPages}/${CONSECUTIVE_EMPTY_ABORT}]: 0 rows on page with hasNextPage=true`, { sectorId, pageIndex, totalScraped });
      pageEvents.push({
        type: blockType,
        site, sectorId, sectorName, pageIndex,
        pageLabel: `${pageIndex + 1}${page.totalPages != null ? `/${page.totalPages}` : '/?'}`,
        docsThisPage: 0, totalDocs: metrics.totalDocumentsCollected, targetDocs: runLimit,
        totalRecords: page.totalRecords,
        pdfDownloadedThisPage: 0, pdfFailedThisPage: 0, pdfMissingThisPage: 0,
        pdfConfidentialThisPage: 0, pdfSkippedExistingThisPage: 0,
        elapsed: elapsedSince(sectorStart), createdAt: new Date().toISOString(),
      });

      if (reachedAbortThreshold) break;

      // Still in soft-block retry window — skip PDF/write, advance to next page
      if (!page.hasNextPage) break;
      if (config.timing.pageDelayMs[1] > 0) await jitter(...config.timing.pageDelayMs);
      const { $: next$, newViewState } = await advancePage(session, config, { page, pageIndex, sectorId, useRichFaces }, metrics);
      page = buildNextPage(page, next$, newViewState, parseRows(next$, config, config.baseUrl), pageIndex + 1);
      pageIndex++;
      continue;
    }

    consecutiveEmptyPages = 0;
    const toWrite = limit !== null ? docs.slice(0, limit - totalScraped) : docs;

    // ── PDF download stage ─────────────────────────────────────────────────
    const pagePdfStartedAt = Date.now();
    const pagePdfStats = shouldDownloadPdfs(pdfDir, dryRun)
      ? await downloadPagePdfs(
          session,
          config,
          { docs: toWrite, rows: page.rows, viewState: page.viewState },
          { pdfDir: pdfDir!, pdfConcurrency, metrics, failedPdfs, onProgress: (done, total) => display.liveProgress('pdf', done, total) },
        )
      : emptyPdfStats();

    display.clearProgress();

    // ── Collect & emit ─────────────────────────────────────────────────────
    if (dryRun) {
      logger.info('[dry-run]', { sectorId, pageIndex, count: toWrite.length, sample: toWrite[0]?.caseNumber });
    } else {
      collected.push(...toWrite);
    }

    totalScraped += toWrite.length;
    metrics.totalDocumentsCollected += toWrite.length;

    const remaining = page.totalRecords != null ? page.totalRecords - totalScraped : null;
    const pdfCompleted = pagePdfStats.pdfDownloadedThisPage + pagePdfStats.pdfSkippedExistingThisPage;
    const { docsPerMin, pagesPerMin, pdfRate } = calcPageMetrics(
      totalScraped, pageIndex, Date.now() - sectorStart, Date.now() - pagePdfStartedAt, pdfCompleted,
    );

    display.pageLine(
      pageIndex + 1,
      page.totalPages,
      toWrite.length,
      totalScraped,
      runLimit,
      page.totalRecords ?? null,
      pdfCompleted,
      pagePdfStats.pdfConfidentialThisPage,
      pagePdfStats.pdfFailedThisPage,
      elapsedSince(sectorStart),
      docsPerMin,
      pagesPerMin,
    );

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
      elapsed: elapsedSince(sectorStart),
    });

    pageEvents.push({
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
      elapsed: elapsedSince(sectorStart),
      createdAt: new Date().toISOString(),
    });

    if (!page.hasNextPage) {
      logger.info('Last page - sector complete', { sector: `${sectorId}=${sectorName}`, pagesProcessed: pageIndex + 1, totalScraped, elapsed: elapsedSince(sectorStart) });
      break;
    }

    // ── Advance to next page ───────────────────────────────────────────────
    // OEFA's paginator renders a "next" button on the final page even when all
    // records are already collected. Trust totalRecords over the DOM signal.
    if (page.totalRecords !== null && totalScraped >= page.totalRecords) {
      logger.info('All records collected - sector complete', { sector: `${sectorId}=${sectorName}`, totalScraped, totalRecords: page.totalRecords });
      break;
    }
    if (config.timing.pageDelayMs[1] > 0) await jitter(...config.timing.pageDelayMs);
    try {
      const { $: next$, newViewState } = await advancePage(session, config, { page, pageIndex, sectorId, useRichFaces }, metrics);
      page = buildNextPage(page, next$, newViewState, parseRows(next$, config, config.baseUrl), pageIndex + 1);
      pageIndex++;
    } catch (err) {
      // All retries exhausted on page advance — treat as end of results rather than
      // crashing and losing the docs already collected in this run.
      logger.warn('Page advance failed after all retries — treating as end of results', {
        sectorId, pageIndex, error: (err as Error).message,
      });
      break;
    }
  }

  if (!dryRun) saveCheckpoint(site, sectorId, pageIndex, totalScraped, true, districtId, opts.checkpointId);
  logger.info('Sector done', { sector: `${sectorId}=${sectorName}`, totalScraped, elapsed: elapsedSince(sectorStart) });
  return { count: totalScraped, docs: collected };
};
