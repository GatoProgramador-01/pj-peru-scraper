import fs from 'fs';
import type { ParsedRow, Session } from '../models/internalTypes.js';
import type { PdfDownloadResult, PdfFailure, RunMetrics } from '../models/metrics.js';
import { pdfFailureFromDocument } from '../models/metrics.js';
import type { JudicialDocument, SiteConfig } from '../types.js';
import { downloadJsfActionPdf, downloadPdf } from '../pdf/downloader.js';
import { jitter } from '../utils/delay.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-page PDF download counters displayed in the terminal progress line. */
export interface PagePdfStats {
  pdfDownloadedThisPage: number;
  pdfFailedThisPage: number;
  pdfMissingThisPage: number;
  pdfConfidentialThisPage: number;
  pdfSkippedExistingThisPage: number;
}

/** Documents and JSF state needed to resolve PDF downloads for one page. */
export interface PdfBatchInput {
  docs: JudicialDocument[];
  rows: ParsedRow[];
  viewState: string;
}

/** Infrastructure options for a PDF batch: where to write, how many concurrent, where to record failures. */
export interface PdfBatchOptions {
  pdfDir: string;
  pdfConcurrency: number;
  metrics: RunMetrics;
  failedPdfs: PdfFailure[];
  onProgress?: (done: number, total: number) => void;
}

/** A doc that has a resolvable PDF source: either a direct URL or a JSF action. */
type PdfCandidate = { index: number; isJsf: boolean };

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const emptyPdfStats = (): PagePdfStats => ({
  pdfDownloadedThisPage: 0,
  pdfFailedThisPage: 0,
  pdfMissingThisPage: 0,
  pdfConfidentialThisPage: 0,
  pdfSkippedExistingThisPage: 0,
});

/** OEFA marks restricted records with the word "confidencial" in a raw cell. */
const isConfidentialDocument = (doc: JudicialDocument): boolean =>
  doc.rawCells.some(cell => /confidencial/i.test(cell));

/** Updates global metrics and the failed-PDF list based on a single download result. */
const recordPdfResult = (
  doc: JudicialDocument,
  result: PdfDownloadResult,
  metrics: RunMetrics,
  failedPdfs: PdfFailure[],
): void => {
  if (result.localPath) doc.pdfLocalPath = result.localPath;
  if (result.latencyMs > 0) metrics.pdfLatencySamples.push(result.latencyMs);

  if (result.status === 'downloaded') { metrics.totalPdfDownloaded++; return; }
  if (result.status === 'skippedExisting') { metrics.totalSkippedExisting++; return; }

  if (result.status === 'failedDownload') {
    metrics.totalPdfFailed++;
    failedPdfs.push(pdfFailureFromDocument(doc, result.status, 'PDF download failed', result.error));
    return;
  }

  metrics.totalPdfMissing++;
  if (result.status === 'confidential') metrics.totalPdfConfidential++;
  failedPdfs.push(pdfFailureFromDocument(doc, result.status, result.error ?? result.status));
};

/** Increments the per-page display counters for one download result. */
const updatePagePdfStats = (stats: PagePdfStats, result: PdfDownloadResult): void => {
  if (result.status === 'downloaded') stats.pdfDownloadedThisPage++;
  if (result.status === 'failedDownload') stats.pdfFailedThisPage++;
  if (result.status === 'missingPdfUrl' || result.status === 'missingJsfAction') stats.pdfMissingThisPage++;
  if (result.status === 'confidential') { stats.pdfMissingThisPage++; stats.pdfConfidentialThisPage++; }
  if (result.status === 'skippedExisting') stats.pdfSkippedExistingThisPage++;
};

/** Builds an immediate failure result for a doc with no PDF source (confidential or missing). */
const resolveNoPdfSource = (doc: JudicialDocument): PdfDownloadResult => {
  const isConfidential = isConfidentialDocument(doc);
  return {
    status: isConfidential ? 'confidential' : 'missingJsfAction',
    localPath: null,
    latencyMs: 0,
    error: isConfidential ? 'OEFA marks this row as confidential' : 'No direct PDF URL or JSF action found',
  };
};

/**
 * Classifies each doc as a downloadable candidate (direct URL or JSF action) or resolves
 * it immediately (confidential / no source). Returns only the candidates that need HTTP.
 */
const buildCandidates = (
  docs: JudicialDocument[],
  rows: ParsedRow[],
  metrics: RunMetrics,
  failedPdfs: PdfFailure[],
  stats: PagePdfStats,
): PdfCandidate[] =>
  docs.flatMap<PdfCandidate>((doc, i) => {
    if (doc.pdfUrl)            { metrics.totalPdfCandidates++; return [{ index: i, isJsf: false }]; }
    if (rows[i]?.pdfJsfAction) { metrics.totalPdfCandidates++; return [{ index: i, isJsf: true  }]; }
    const result = resolveNoPdfSource(doc);
    recordPdfResult(doc, result, metrics, failedPdfs);
    updatePagePdfStats(stats, result);
    return [];
  });

/** Dispatches one PDF download via the correct strategy: direct GET (PJ Peru) or JSF POST (OEFA). */
const downloadCandidate = (
  session: Session,
  config: SiteConfig,
  candidate: PdfCandidate,
  input: PdfBatchInput,
  pdfDir: string,
  metrics: RunMetrics,
): Promise<PdfDownloadResult> => {
  const { index, isJsf } = candidate;
  const { docs, rows, viewState } = input;
  return isJsf
    ? downloadJsfActionPdf(session, config, { viewState, mojarra: rows[index].pdfJsfAction!, doc: docs[index], pdfDir }, metrics)
    : downloadPdf(session, docs[index], { pdfDir, retryWaitMs: config.timing.retryWaitMs }, metrics);
};

// ─── Main batch function ──────────────────────────────────────────────────────

/**
 * Downloads all PDFs for one scraper page in concurrent batches.
 *
 * absorbCookies() inside each downloader is synchronous on promise resolution,
 * so Node's single thread guarantees no cookie-jar race condition across a batch.
 */
export const downloadPagePdfs = async (
  session: Session,
  config: SiteConfig,
  input: PdfBatchInput,
  options: PdfBatchOptions,
): Promise<PagePdfStats> => {
  const { docs } = input;
  const { pdfDir, pdfConcurrency, metrics, failedPdfs, onProgress } = options;
  const stats = emptyPdfStats();

  const candidates = buildCandidates(docs, input.rows, metrics, failedPdfs, stats);
  fs.mkdirSync(pdfDir, { recursive: true });

  let doneCount = 0;
  const total = candidates.length;

  for (let i = 0; i < candidates.length; i += pdfConcurrency) {
    const chunk = candidates.slice(i, i + pdfConcurrency);
    const results = await Promise.all(
      chunk.map(candidate => downloadCandidate(session, config, candidate, input, pdfDir, metrics)),
    );
    for (const [j, result] of results.entries()) {
      recordPdfResult(docs[chunk[j].index], result, metrics, failedPdfs);
      updatePagePdfStats(stats, result);
      onProgress?.(++doneCount, total);
    }
    if (i + pdfConcurrency < candidates.length) await jitter(...config.timing.pdfDelayMs);
  }

  return stats;
};
