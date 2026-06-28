import type { ParsedPage } from './internalTypes.js';
import type { PageEvent, PdfFailure, RunMetrics } from './metrics.js';
import type { JudicialDocument } from '../types.js';

/** Outcome of scraping one sector: document count and collected records. */
export interface SectorResult {
  count: number;
  docs: JudicialDocument[];
}

/** Mutable runtime state shared across all pages of a single sector scrape (metrics, events, limits). */
export interface SectorContext {
  sectorId: string | null;
  sectorName: string | null;
  metrics: RunMetrics;
  failedPdfs: PdfFailure[];
  pageEvents: PageEvent[];
  runLimit: number | null;
}

export interface PageMetrics {
  docsPerMin: number | null;
  pagesPerMin: number | null;
  pdfRate: number;
}

export interface AdvancePageCtx {
  page: ParsedPage;
  pageIndex: number;
  sectorId: string | null;
  useRichFaces: boolean;
}
