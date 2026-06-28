import type { JudicialDocument } from '../types.js';

export type PdfStatus =
  | 'downloaded'
  | 'failedDownload'
  | 'missingPdfUrl'
  | 'missingJsfAction'
  | 'confidential'
  | 'skippedExisting';

export interface PdfFailure {
  id: string;
  site: string;
  sector: string | null;
  caseNumber: string;
  pdfUrl: string | null;
  status: PdfStatus;
  reason: string;
  error?: string;
  pageIndex: number;
  rowIndex: number;
  attemptedAt: string;
}

export interface PdfDownloadResult {
  status: PdfStatus;
  localPath: string | null;
  latencyMs: number;
  error?: string;
}

export interface RunMetrics {
  totalDocumentsCollected: number;
  totalPdfCandidates: number;
  totalPdfDownloaded: number;
  totalPdfFailed: number;
  totalPdfMissing: number;
  totalPdfConfidential: number;
  totalSkippedExisting: number;
  total429: number;
  totalRetries: number;
  pdfLatencySamples: number[];
  startedAt: number;
}

export interface PageEvent {
  type: 'pageScraped' | 'soft_block_warning' | 'soft_block_abort';
  site: string;
  sectorId: string | null;
  sectorName: string | null;
  pageIndex: number;
  pageLabel: string;
  docsThisPage: number;
  totalDocs: number;
  targetDocs: number | null;
  totalRecords: number | null;
  pdfDownloadedThisPage: number;
  pdfFailedThisPage: number;
  pdfMissingThisPage: number;
  pdfConfidentialThisPage: number;
  pdfSkippedExistingThisPage: number;
  elapsed: string;
  createdAt: string;
}

/**
 * Creates a zeroed `RunMetrics` snapshot for a new scraper run.
 *
 * @returns A fresh `RunMetrics` object with all counters at zero and
 *   `startedAt` set to the current epoch milliseconds — used to track
 *   progress and produce the final run report.
 */
export const createRunMetrics = (): RunMetrics => ({
  totalDocumentsCollected: 0,
  totalPdfCandidates: 0,
  totalPdfDownloaded: 0,
  totalPdfFailed: 0,
  totalPdfMissing: 0,
  totalPdfConfidential: 0,
  totalSkippedExisting: 0,
  total429: 0,
  totalRetries: 0,
  pdfLatencySamples: [],
  startedAt: Date.now(),
});

/**
 * Constructs a `PdfFailure` record from a scraped `JudicialDocument`.
 *
 * @remarks
 * `attemptedAt` is set to `new Date().toISOString()` at call time.
 * `error` should be the raw axios or filesystem error message when available.
 *
 * @param doc - The source judicial document whose metadata is copied
 * @param status - Terminal status code for this PDF attempt
 * @param reason - Human-readable explanation of the failure
 * @param error - Optional raw error message from axios or the filesystem
 * @returns A fully populated `PdfFailure` ready to persist to the failures log
 */
export const pdfFailureFromDocument = (
  doc: JudicialDocument,
  status: PdfFailure['status'],
  reason: string,
  error?: string,
): PdfFailure => ({
  id: doc.id,
  site: doc.site,
  sector: doc.sector,
  caseNumber: doc.caseNumber,
  pdfUrl: doc.pdfUrl,
  status,
  reason,
  error,
  pageIndex: doc.pageIndex,
  rowIndex: doc.rowIndex,
  attemptedAt: new Date().toISOString(),
});
