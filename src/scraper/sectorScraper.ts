import { logger } from '../logger.js';
import { ROWS_PER_PAGE } from '../config/constants.js';
import * as display from '../display/terminal.js';
import type { Session } from '../models/internalTypes.js';
import type { SectorContext, SectorResult } from '../models/scraperTypes.js';
import type { JudicialDocument, ScrapeOptions, SiteConfig } from '../types.js';
import { loadCheckpoint, saveCheckpoint } from '../checkpoint/checkpointManager.js';
import { submitSearch } from '../jsf/searchForm.js';
import { parsePage } from '../parser/pageParser.js';
import { parseRows } from '../parser/rowParser.js';
import { rowToDocument } from '../parser/documentMapper.js';
import { fetchStartPage } from '../session/session.js';
import { withRetry } from '../session/retry.js';
import { jitter } from '../utils/delay.js';
import { emptyPdfStats, downloadPagePdfs } from './pdfBatch.js';
import { handleSoftBlock } from './softBlock.js';
import { buildPageEvent, logPageScraped } from './pageEvents.js';
import { buildNextPage, advancePage, tryAdvancePage } from './paginationHelpers.js';
import {
  elapsedSince,
  hasReachedDocLimit,
  isSoftBlock,
  shouldDownloadPdfs,
  richFacesMissingNextButton,
  paginatorHidTotalPages,
  calcPageMetrics,
} from './sectorHelpers.js';

/**
 * Scrapes all pages for a single sector, collecting documents and optionally downloading PDFs.
 *
 * @remarks
 * Execution phases (in order):
 * 1. **Resume check** — if `opts.resume` is set and a completed checkpoint exists, returns early.
 * 2. **Bootstrap** — GETs the portal start page to obtain a JSESSIONID cookie and ViewState token.
 * 3. **Search submit** — POSTs the search form with the sector filter; skips when `config.search` is absent.
 * 4. **Pagination loop** — iterates pages until the last page, doc limit, or a soft-block abort.
 *    - Each page: maps rows → documents → optional PDF batch → appends to collected array.
 *    - Soft-block detection: 3 consecutive empty pages with `hasNextPage=true` triggers abort.
 * 5. **Checkpoint save** — marks the sector as completed (used by `--resume` on the next run).
 *
 * @param session - Axios session with cookie jar; created fresh per sector by `scrapeSectorWithRetry`
 * @param config - Static site configuration (selectors, timing, search form, column map)
 * @param opts - Runtime CLI options (limit, dryRun, pdfDir, resume, districtId, etc.)
 * @param ctx - Mutable sector context: metrics, failedPdfs, pageEvents shared across the run
 * @returns `{ count, docs }` — count of documents scraped and the collected records (empty on dry-run)
 */
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

    // PJ Peru (RichFaces) does not render paginator buttons on the initial GET —
    // if hasNextPage is false but a full page returned and totalPages is unknown, assume more.
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
      const signal = handleSoftBlock(
        consecutiveEmptyPages, page, pageIndex,
        { site, sectorId, sectorName, metrics, pageEvents, runLimit, totalScraped },
        elapsedSince(sectorStart),
      );
      if (signal === 'abort') break;
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
          session, config,
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

    const pdfCompleted = pagePdfStats.pdfDownloadedThisPage + pagePdfStats.pdfSkippedExistingThisPage;
    const { docsPerMin, pagesPerMin, pdfRate } = calcPageMetrics(
      totalScraped, pageIndex, Date.now() - sectorStart, Date.now() - pagePdfStartedAt, pdfCompleted,
    );

    const elapsed = elapsedSince(sectorStart);
    display.pageLine(
      pageIndex + 1, page.totalPages, toWrite.length, totalScraped,
      runLimit, page.totalRecords ?? null, pdfCompleted,
      pagePdfStats.pdfConfidentialThisPage, pagePdfStats.pdfFailedThisPage,
      elapsed, docsPerMin, pagesPerMin,
    );
    logPageScraped(sectorId, sectorName, pageIndex, page, toWrite, totalScraped, runLimit, metrics, pagePdfStats, pdfRate, docsPerMin, elapsed);
    pageEvents.push(buildPageEvent(site, sectorId, sectorName, pageIndex, page, toWrite, metrics, runLimit, pagePdfStats, elapsed));

    if (!page.hasNextPage) {
      logger.info('Last page - sector complete', {
        sector: `${sectorId}=${sectorName}`,
        pagesProcessed: pageIndex + 1,
        totalScraped,
        elapsed: elapsedSince(sectorStart),
      });
      break;
    }

    // ── Advance to next page ───────────────────────────────────────────────
    // OEFA's paginator renders a "next" button on the final page even when all
    // records are already collected. Trust totalRecords over the DOM signal.
    const advResult = await tryAdvancePage(session, config, { page, pageIndex, sectorId, useRichFaces }, metrics, totalScraped, page);
    if (advResult === 'done') break;
    page = buildNextPage(page, advResult.$, advResult.newViewState, parseRows(advResult.$, config, config.baseUrl), pageIndex + 1);
    pageIndex++;
  }

  if (!dryRun) saveCheckpoint(site, sectorId, pageIndex, totalScraped, true, districtId, opts.checkpointId);
  logger.info('Sector done', { sector: `${sectorId}=${sectorName}`, totalScraped, elapsed: elapsedSince(sectorStart) });
  return { count: totalScraped, docs: collected };
};
