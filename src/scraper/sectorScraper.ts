import fs from 'fs';
import { logger } from '../logger.js';
import { ROWS_PER_PAGE } from '../config/constants.js';
import type { Session } from '../models/internalTypes.js';
import type { ScrapeOptions, SiteConfig } from '../types.js';
import { loadCheckpoint, saveCheckpoint } from '../checkpoint/checkpointManager.js';
import { fetchNextPage } from '../jsf/pagination.js';
import { submitSearch } from '../jsf/searchForm.js';
import { parsePage } from '../parser/pageParser.js';
import { currentPageNum, pageHasNext, parsePaginatorText } from '../parser/paginatorParser.js';
import { parseRows } from '../parser/rowParser.js';
import { rowToDocument } from '../parser/documentMapper.js';
import { downloadJsfActionPdf, downloadPdf } from '../pdf/downloader.js';
import { fetchStartPage } from '../session/session.js';
import { withRetry } from '../session/retry.js';
import { jitter } from '../utils/delay.js';

export const scrapeSector = async (
  session: Session,
  config: SiteConfig,
  opts: ScrapeOptions,
  sectorId: string | null,
  sectorName: string | null,
  out: fs.WriteStream | null,
): Promise<number> => {
  const { site, pdfDir, limit, dryRun } = opts;

  const { startPage, completed } = opts.resume
    ? loadCheckpoint(site, sectorId)
    : { startPage: 0, completed: false };

  if (completed) return 0;

  let totalScraped = 0;
  let pageIndex = startPage;
  const sectorStart = Date.now();

  const elapsed = (): string => {
    const sec = Math.round((Date.now() - sectorStart) / 1000);
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
  };

  const $initial = await withRetry(
    () => fetchStartPage(session, config.startUrl),
    config.timing.retryWaitMs,
    `bootstrap-sector-${sectorId}`,
  );
  let page = parsePage($initial, config, config.baseUrl);

  if (config.search) {
    page = await withRetry(
      () => submitSearch(session, config.startUrl, page, config, sectorId),
      config.timing.retryWaitMs,
      `search-sector-${sectorId}`,
    );
    logger.info('Search submitted — first page received', {
      sector: `${sectorId}=${sectorName}`,
      rowsFound: page.rows.length,
      totalRecords: page.totalRecords ?? '?',
      totalPages: page.totalPages ?? '?',
      elapsed: elapsed(),
    });

    if (page.rows.length === 0) {
      logger.warn('Zero results for sector — skipping', { sectorId, sectorName });
      return 0;
    }
  }

  // Fast-forward to resume page by replaying page-turn POSTs
  for (let i = 0; i < pageIndex; i++) {
    const { $: next$, newViewState } = await withRetry(
      () => fetchNextPage(session, config.startUrl, page, i + 1, ROWS_PER_PAGE),
      config.timing.retryWaitMs,
      `resume-nav-${i + 1}`,
    );
    const pag = parsePaginatorText(next$);
    page = { ...page, viewState: newViewState ?? page.viewState, rows: parseRows(next$, config, config.baseUrl), hasNextPage: pageHasNext(next$), currentPage: pag?.currentPage ?? currentPageNum(next$), totalPages: pag?.totalPages ?? page.totalPages, totalRecords: pag?.totalRecords ?? page.totalRecords };
  }

  // Main pagination loop
  while (true) {
    if (limit !== null && totalScraped >= limit) { logger.info('Limit reached', { limit }); break; }

    const docs = page.rows.map(rowToDocument(site, pageIndex, config.columns, sectorId, sectorName));
    if (docs.length === 0) { logger.info('Empty page — end of results', { sectorId, pageIndex }); break; }

    const toWrite = limit !== null ? docs.slice(0, limit - totalScraped) : docs;

    if (dryRun) {
      logger.info('[dry-run]', { sectorId, pageIndex, count: toWrite.length, sample: toWrite[0]?.caseNumber });
    } else {
      for (const doc of toWrite) out!.write(JSON.stringify(doc) + '\n');
    }

    if (pdfDir && !dryRun) {
      for (let j = 0; j < toWrite.length; j++) {
        const doc = toWrite[j];
        const row = page.rows[j];
        if (doc.pdfUrl) {
          doc.pdfLocalPath = await downloadPdf(session, doc, pdfDir);
          await jitter(...config.timing.pdfDelayMs);
        } else if (row.pdfJsfAction) {
          doc.pdfLocalPath = await downloadJsfActionPdf(session, config, page.viewState, row.pdfJsfAction, doc, pdfDir);
          await jitter(...config.timing.pdfDelayMs);
        }
      }
    }

    const pdfDownloaded = toWrite.filter(d => d.pdfLocalPath).length;
    const pdfAvailable = toWrite.filter((doc, j) => doc.pdfUrl || page.rows[j]?.pdfJsfAction).length;

    totalScraped += toWrite.length;
    if (!dryRun) saveCheckpoint(site, sectorId, pageIndex, totalScraped);

    const elapsedSec = (Date.now() - sectorStart) / 1000;
    const docsPerMin = elapsedSec > 5 ? Math.round((totalScraped / elapsedSec) * 60) : null;
    const remaining = page.totalRecords != null ? page.totalRecords - totalScraped : null;

    logger.info('Page scraped', {
      sector: `${sectorId}=${sectorName}`,
      page: `${pageIndex + 1}${page.totalPages != null ? `/${page.totalPages}` : ''}`,
      docsThisPage: docs.length,
      totalScraped,
      totalRecords: page.totalRecords ?? '?',
      remaining: remaining != null ? remaining : '?',
      pdfs: `${pdfDownloaded}/${pdfAvailable} downloaded`,
      rate: docsPerMin != null ? `${docsPerMin} docs/min` : '—',
      elapsed: elapsed(),
    });

    if (!page.hasNextPage) {
      logger.info('Last page — sector complete', { sector: `${sectorId}=${sectorName}`, pagesProcessed: pageIndex + 1, totalScraped, elapsed: elapsed() });
      break;
    }

    await jitter(...config.timing.pageDelayMs);

    const { $: next$, newViewState } = await withRetry(
      () => fetchNextPage(session, config.startUrl, page, pageIndex + 1, ROWS_PER_PAGE),
      config.timing.retryWaitMs,
      `page-${pageIndex + 1}-sector-${sectorId}`,
    );
    const nextPag = parsePaginatorText(next$);
    page = {
      ...page,
      viewState: newViewState ?? page.viewState,
      rows: parseRows(next$, config, config.baseUrl),
      hasNextPage: pageHasNext(next$),
      currentPage: nextPag?.currentPage ?? currentPageNum(next$),
      totalPages: nextPag?.totalPages ?? page.totalPages,
      totalRecords: nextPag?.totalRecords ?? page.totalRecords,
    };
    pageIndex++;
  }

  if (!dryRun) saveCheckpoint(site, sectorId, pageIndex, totalScraped, true);
  logger.info('Sector done', { sector: `${sectorId}=${sectorName}`, totalScraped, elapsed: elapsed() });
  return totalScraped;
};
