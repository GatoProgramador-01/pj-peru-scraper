import fs from 'fs';
import { logger } from '../logger.js';
import { ROWS_PER_PAGE } from '../config/constants.js';
import * as display from '../display/terminal.js';
import type { ParsedRow, Session } from '../models/internalTypes.js';
import type { PageEvent, PdfDownloadResult, PdfFailure, RunMetrics } from '../models/metrics.js';
import { pdfFailureFromDocument } from '../models/metrics.js';
import type { JudicialDocument, ScrapeOptions, SiteConfig } from '../types.js';
import { loadCheckpoint, saveCheckpoint } from '../checkpoint/checkpointManager.js';
import { fetchNextPage } from '../jsf/pagination.js';
import { submitSearch } from '../jsf/searchForm.js';
import { parsePage } from '../parser/pageParser.js';
import { pageHasNext, parsePaginatorText } from '../parser/paginatorParser.js';
import { parseRows } from '../parser/rowParser.js';
import { rowToDocument } from '../parser/documentMapper.js';
import { downloadJsfActionPdf, downloadPdf } from '../pdf/downloader.js';
import { fetchStartPage } from '../session/session.js';
import { withRetry } from '../session/retry.js';
import { jitter } from '../utils/delay.js';

interface PagePdfStats {
  pdfDownloadedThisPage: number;
  pdfFailedThisPage: number;
  pdfMissingThisPage: number;
  pdfConfidentialThisPage: number;
  pdfSkippedExistingThisPage: number;
}

const isConfidentialDocument = (doc: JudicialDocument): boolean =>
  doc.rawCells.some(cell => /confidencial/i.test(cell));

const recordPdfResult = (
  doc: JudicialDocument,
  result: PdfDownloadResult,
  metrics: RunMetrics,
  failedPdfs: PdfFailure[],
): void => {
  if (result.localPath) doc.pdfLocalPath = result.localPath;
  if (result.latencyMs > 0) metrics.pdfLatencySamples.push(result.latencyMs);

  if (result.status === 'downloaded') {
    metrics.totalPdfDownloaded++;
    return;
  }

  if (result.status === 'skippedExisting') {
    metrics.totalSkippedExisting++;
    return;
  }

  if (result.status === 'failedDownload') {
    metrics.totalPdfFailed++;
    failedPdfs.push(pdfFailureFromDocument(doc, result.status, 'PDF download failed', result.error));
    return;
  }

  metrics.totalPdfMissing++;
  if (result.status === 'confidential') metrics.totalPdfConfidential++;
  failedPdfs.push(pdfFailureFromDocument(doc, result.status, result.error ?? result.status));
};

const processPdfResult = (
  doc: JudicialDocument,
  result: PdfDownloadResult,
  metrics: RunMetrics,
  failedPdfs: PdfFailure[],
  pageStats: PagePdfStats,
): void => {
  recordPdfResult(doc, result, metrics, failedPdfs);
  if (result.status === 'downloaded') pageStats.pdfDownloadedThisPage++;
  if (result.status === 'failedDownload') pageStats.pdfFailedThisPage++;
  if (result.status === 'missingPdfUrl' || result.status === 'missingJsfAction') pageStats.pdfMissingThisPage++;
  if (result.status === 'confidential') {
    pageStats.pdfMissingThisPage++;
    pageStats.pdfConfidentialThisPage++;
  }
  if (result.status === 'skippedExisting') pageStats.pdfSkippedExistingThisPage++;
};

const downloadPagePdfs = async (
  session: Session,
  config: SiteConfig,
  docs: JudicialDocument[],
  rows: ParsedRow[],
  viewState: string,
  pdfDir: string,
  pdfConcurrency: number,
  metrics: RunMetrics,
  failedPdfs: PdfFailure[],
  onProgress?: (done: number, total: number) => void,
): Promise<PagePdfStats> => {
  const pageStats: PagePdfStats = {
    pdfDownloadedThisPage: 0,
    pdfFailedThisPage: 0,
    pdfMissingThisPage: 0,
    pdfConfidentialThisPage: 0,
    pdfSkippedExistingThisPage: 0,
  };

  // Classify candidates; non-candidates (confidential / missing) are resolved immediately.
  type Candidate = { index: number; isJsf: boolean };
  const candidates: Candidate[] = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const row = rows[i];
    if (doc.pdfUrl) {
      metrics.totalPdfCandidates++;
      candidates.push({ index: i, isJsf: false });
    } else if (row?.pdfJsfAction) {
      metrics.totalPdfCandidates++;
      candidates.push({ index: i, isJsf: true });
    } else {
      const status = isConfidentialDocument(doc) ? 'confidential' : 'missingJsfAction';
      processPdfResult(
        doc,
        {
          status,
          localPath: null,
          latencyMs: 0,
          error: status === 'confidential' ? 'OEFA marks this row as confidential' : 'No direct PDF URL or JSF action found',
        },
        metrics,
        failedPdfs,
        pageStats,
      );
    }
  }

  // Ensure the PDF directory exists even if it was deleted or never created mid-run.
  fs.mkdirSync(pdfDir, { recursive: true });

  // Download all PDF candidates concurrently in batches of pdfConcurrency.
  // absorbCookies() in downloadJsfActionPdf is synchronous on promise resolution,
  // so Node.js single-thread guarantees no cookie-jar race condition.
  let doneCount = 0;
  const totalCandidates = candidates.length;

  for (let i = 0; i < candidates.length; i += pdfConcurrency) {
    const chunk = candidates.slice(i, i + pdfConcurrency);
    const results = await Promise.all(chunk.map(async ({ index, isJsf }) => ({
      index,
      result: isJsf
        ? await downloadJsfActionPdf(session, config, viewState, rows[index].pdfJsfAction!, docs[index], pdfDir, metrics)
        : await downloadPdf(session, docs[index], pdfDir, config.timing.retryWaitMs, metrics),
    })));
    for (const { index, result } of results) {
      processPdfResult(docs[index], result, metrics, failedPdfs, pageStats);
      onProgress?.(++doneCount, totalCandidates);
    }
    if (i + pdfConcurrency < candidates.length) await jitter(...config.timing.pdfDelayMs);
  }

  return pageStats;
};

export const scrapeSector = async (
  session: Session,
  config: SiteConfig,
  opts: ScrapeOptions,
  sectorId: string | null,
  sectorName: string | null,
  out: fs.WriteStream | null,
  metrics: RunMetrics,
  failedPdfs: PdfFailure[],
  pageEvents: PageEvent[],
  runLimit: number | null,
): Promise<number> => {
  const { site, pdfDir, limit, dryRun } = opts;
  const envPdfConcurrency = Number(process.env.PDF_CONCURRENCY ?? 1) || 1;
  const pdfConcurrency = Math.max(1, opts.pdfConcurrency ?? envPdfConcurrency);

  const useRichFaces = config.rowParser === 'richfacesRepeat';

  const districtId = opts.districtId ?? null;

  const { startPage, completed } = opts.resume
    ? loadCheckpoint(site, sectorId, districtId)
    : { startPage: 0, completed: false };

  if (completed) return 0;

  let totalScraped = 0;
  let pageIndex = startPage;
  const sectorStart = Date.now();

  const elapsed = (): string => {
    const sec = Math.round((Date.now() - sectorStart) / 1000);
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
  };

  display.phaseStep('Bootstrap session');
  const $initial = await withRetry(
    () => fetchStartPage(session, config.startUrl),
    config.timing.retryWaitMs,
    `bootstrap-sector-${sectorId}`,
    metrics,
  );
  display.phaseOk('Session ready', elapsed());
  let page = parsePage($initial, config, config.baseUrl);

  if (config.search) {
    display.phaseStep('Submitting search');
    page = await withRetry(
      () => submitSearch(session, config.startUrl, page, config, sectorId, districtId),
      config.timing.retryWaitMs,
      `search-sector-${sectorId}${districtId ? `-d${districtId}` : ''}`,
      metrics,
    );
    display.phaseOk(
      'Search complete',
      `${page.totalRecords ?? '?'} records · ${page.totalPages ?? '?'} pages · ${elapsed()}`,
    );
    // Portals like pj-peru (RichFaces) don't render paginator buttons on initial GET —
    // if hasNextPage is false but we got a full page and totalPages is unknown, assume more.
    if (!page.hasNextPage && page.totalPages === null && page.rows.length >= ROWS_PER_PAGE) {
      page = { ...page, hasNextPage: true };
    }
    logger.info('Search submitted - first page received', {
      sector: `${sectorId}=${sectorName}`,
      rowsFound: page.rows.length,
      totalRecords: page.totalRecords ?? '?',
      totalPages: page.totalPages ?? '?',
      elapsed: elapsed(),
    });

    if (page.rows.length === 0) {
      logger.warn('Zero results for sector - skipping', { sectorId, sectorName });
      return 0;
    }
  }

  // Fast-forward to resume page by replaying page-turn POSTs
  if (pageIndex > 0) {
    display.phaseStep(`Resuming from page ${pageIndex + 1}`);
  }
  for (let i = 0; i < pageIndex; i++) {
    const { $: next$, newViewState } = await withRetry(
      () => fetchNextPage(session, config.startUrl, page, i + 1, ROWS_PER_PAGE, useRichFaces),
      config.timing.retryWaitMs,
      `resume-nav-${i + 1}`,
      metrics,
    );
    const pag = parsePaginatorText(next$);
    const resumeRows = parseRows(next$, config, config.baseUrl);
    page = {
      ...page,
      viewState: newViewState ?? page.viewState,
      rows: resumeRows,
      hasNextPage: pag ? pageHasNext(next$) : page.totalPages != null ? i + 2 < page.totalPages : pageHasNext(next$) || resumeRows.length >= ROWS_PER_PAGE,
      currentPage: pag?.currentPage ?? i + 2,
      totalPages: pag?.totalPages ?? page.totalPages,
      totalRecords: pag?.totalRecords ?? page.totalRecords,
    };
  }
  if (pageIndex > 0) {
    display.phaseOk(`Resumed at page ${pageIndex + 1}`, elapsed());
  }

  // Main pagination loop
  while (true) {
    if (limit !== null && totalScraped >= limit) { logger.info('Limit reached', { limit }); break; }

    const docs = page.rows.map(rowToDocument(site, pageIndex, config.columns, sectorId, sectorName));
    if (docs.length === 0) { logger.info('Empty page - end of results', { sectorId, pageIndex }); break; }

    const toWrite = limit !== null ? docs.slice(0, limit - totalScraped) : docs;

    const pagePdfStartedAt = Date.now();
    const pagePdfStats = pdfDir && !dryRun
      ? await downloadPagePdfs(
          session, config, toWrite, page.rows, page.viewState, pdfDir, pdfConcurrency,
          metrics, failedPdfs,
          (done, total) => display.liveProgress('pdf', done, total),
        )
      : { pdfDownloadedThisPage: 0, pdfFailedThisPage: 0, pdfMissingThisPage: 0, pdfConfidentialThisPage: 0, pdfSkippedExistingThisPage: 0 };

    display.clearProgress();

    if (dryRun) {
      logger.info('[dry-run]', { sectorId, pageIndex, count: toWrite.length, sample: toWrite[0]?.caseNumber });
    } else {
      for (const doc of toWrite) out!.write(JSON.stringify(doc) + '\n');
    }

    totalScraped += toWrite.length;
    metrics.totalDocumentsCollected += toWrite.length;
    if (!dryRun) saveCheckpoint(site, sectorId, pageIndex, totalScraped, false, districtId);

    const elapsedSec = (Date.now() - sectorStart) / 1000;
    const docsPerMin = elapsedSec > 5 ? Math.round((totalScraped / elapsedSec) * 60) : null;
    const remaining = page.totalRecords != null ? page.totalRecords - totalScraped : null;
    const pagePdfSec = Math.max(1, (Date.now() - pagePdfStartedAt) / 1000);
    const pdfRate = Math.round(((pagePdfStats.pdfDownloadedThisPage + pagePdfStats.pdfSkippedExistingThisPage) / pagePdfSec) * 60);

    const pdfOk = pagePdfStats.pdfDownloadedThisPage + pagePdfStats.pdfSkippedExistingThisPage;
    display.pageLine(
      pageIndex + 1,
      page.totalPages,
      toWrite.length,
      totalScraped,
      runLimit,
      page.totalRecords ?? null,
      pdfOk,
      pagePdfStats.pdfConfidentialThisPage,
      pagePdfStats.pdfFailedThisPage,
      elapsed(),
      docsPerMin,
    );

    logger.info('Page scraped', {
      sector: `${sectorId}=${sectorName}`,
      page: `${pageIndex + 1}${page.totalPages != null ? `/${page.totalPages}` : '/?'}`,
      docsThisPage: toWrite.length,
      totalDocs: runLimit !== null ? `${metrics.totalDocumentsCollected}/${runLimit}` : metrics.totalDocumentsCollected,
      totalScraped,
      totalRecords: page.totalRecords ?? '?',
      remaining: remaining != null ? remaining : '?',
      pdfDownloadedThisPage: pagePdfStats.pdfDownloadedThisPage,
      pdfFailedThisPage: pagePdfStats.pdfFailedThisPage,
      pdfMissingThisPage: pagePdfStats.pdfMissingThisPage,
      pdfConfidentialThisPage: pagePdfStats.pdfConfidentialThisPage,
      pdfSkippedExistingThisPage: pagePdfStats.pdfSkippedExistingThisPage,
      pdfRate: `${pdfRate} pdfs/min`,
      rate: docsPerMin != null ? `${docsPerMin} docs/min` : '-',
      elapsed: elapsed(),
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
      pdfDownloadedThisPage: pagePdfStats.pdfDownloadedThisPage,
      pdfFailedThisPage: pagePdfStats.pdfFailedThisPage,
      pdfMissingThisPage: pagePdfStats.pdfMissingThisPage,
      pdfConfidentialThisPage: pagePdfStats.pdfConfidentialThisPage,
      pdfSkippedExistingThisPage: pagePdfStats.pdfSkippedExistingThisPage,
      elapsed: elapsed(),
      createdAt: new Date().toISOString(),
    });

    if (!page.hasNextPage) {
      logger.info('Last page - sector complete', { sector: `${sectorId}=${sectorName}`, pagesProcessed: pageIndex + 1, totalScraped, elapsed: elapsed() });
      break;
    }

    if (config.timing.pageDelayMs[1] > 0) await jitter(...config.timing.pageDelayMs);
    const { $: next$, newViewState } = await withRetry(
      () => fetchNextPage(session, config.startUrl, page, pageIndex + 1, ROWS_PER_PAGE, useRichFaces),
      config.timing.retryWaitMs,
      `page-${pageIndex + 1}-sector-${sectorId}`,
      metrics,
    );
    const nextPag = parsePaginatorText(next$);
    const nextRows = parseRows(next$, config, config.baseUrl);
    page = {
      ...page,
      viewState: newViewState ?? page.viewState,
      rows: nextRows,
      hasNextPage: nextPag ? pageHasNext(next$) : page.totalPages != null ? pageIndex + 2 < page.totalPages : pageHasNext(next$) || nextRows.length >= ROWS_PER_PAGE,
      currentPage: nextPag?.currentPage ?? pageIndex + 2,
      totalPages: nextPag?.totalPages ?? page.totalPages,
      totalRecords: nextPag?.totalRecords ?? page.totalRecords,
    };
    pageIndex++;
  }

  if (!dryRun) saveCheckpoint(site, sectorId, pageIndex, totalScraped, true, districtId);
  logger.info('Sector done', { sector: `${sectorId}=${sectorName}`, totalScraped, elapsed: elapsed() });
  return totalScraped;
};
