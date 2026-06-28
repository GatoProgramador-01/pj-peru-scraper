import { logger } from '../logger.js';
import type { ParsedPage } from '../models/internalTypes.js';
import type { PageEvent, RunMetrics } from '../models/metrics.js';
import type { PagePdfStats } from '../models/pdfTypes.js';
import type { JudicialDocument } from '../types.js';

const buildPageEvent = (
  site: string, sectorId: string | null, sectorName: string | null,
  pageIndex: number, page: ParsedPage,
  toWrite: JudicialDocument[], metrics: RunMetrics,
  runLimit: number | null, pagePdfStats: PagePdfStats, elapsed: string,
): PageEvent => ({
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
  elapsed,
  createdAt: new Date().toISOString(),
});

const logPageScraped = (
  sectorId: string | null, sectorName: string | null,
  pageIndex: number, page: ParsedPage,
  toWrite: JudicialDocument[], totalScraped: number,
  runLimit: number | null, metrics: RunMetrics,
  pagePdfStats: PagePdfStats, pdfRate: number,
  docsPerMin: number | null, elapsed: string,
): void => {
  const remaining = page.totalRecords != null ? page.totalRecords - totalScraped : null;
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
    elapsed,
  });
};

export { buildPageEvent, logPageScraped };
