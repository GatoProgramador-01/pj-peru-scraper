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
