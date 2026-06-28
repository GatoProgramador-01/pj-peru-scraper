import type { JsfAction, ParsedRow } from './internalTypes.js';
import type { PdfFailure, RunMetrics } from './metrics.js';
import type { JudicialDocument } from '../types.js';

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
export type PdfCandidate = { index: number; isJsf: boolean };

/** Output directory and retry timing for a direct URL PDF download. */
export interface PdfDownloadConfig {
  pdfDir: string;
  retryWaitMs: readonly number[];
}

/** All inputs needed to POST a JSF form action and receive the PDF binary response. */
export interface JsfPdfTarget {
  viewState: string;
  mojarra: JsfAction;
  doc: JudicialDocument;
  pdfDir: string;
}
