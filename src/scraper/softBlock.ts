import { logger } from '../logger.js';
import { CONSECUTIVE_EMPTY_ABORT } from '../config/constants.js';
import type { ParsedPage } from '../models/internalTypes.js';
import type { PageEvent, RunMetrics } from '../models/metrics.js';

const buildSoftBlockEvent = (
  type: 'soft_block_abort' | 'soft_block_warning',
  site: string, sectorId: string | null, sectorName: string | null,
  pageIndex: number, page: ParsedPage, metrics: RunMetrics,
  runLimit: number | null, elapsed: string,
): PageEvent => ({
  type,
  site, sectorId, sectorName, pageIndex,
  pageLabel: `${pageIndex + 1}${page.totalPages != null ? `/${page.totalPages}` : '/?'}`,
  docsThisPage: 0, totalDocs: metrics.totalDocumentsCollected, targetDocs: runLimit,
  totalRecords: page.totalRecords,
  pdfDownloadedThisPage: 0, pdfFailedThisPage: 0, pdfMissingThisPage: 0,
  pdfConfidentialThisPage: 0, pdfSkippedExistingThisPage: 0,
  elapsed, createdAt: new Date().toISOString(),
});

const handleSoftBlock = (
  consecutiveEmptyPages: number,
  page: ParsedPage, pageIndex: number,
  ctx: { site: string; sectorId: string | null; sectorName: string | null; metrics: RunMetrics; pageEvents: PageEvent[]; runLimit: number | null; totalScraped: number },
  elapsed: string,
): 'abort' | 'continue' => {
  const reachedAbortThreshold = consecutiveEmptyPages >= CONSECUTIVE_EMPTY_ABORT;
  const blockType: 'soft_block_abort' | 'soft_block_warning' = reachedAbortThreshold ? 'soft_block_abort' : 'soft_block_warning';
  logger.warn(`${blockType} [${consecutiveEmptyPages}/${CONSECUTIVE_EMPTY_ABORT}]: 0 rows on page with hasNextPage=true`, { sectorId: ctx.sectorId, pageIndex, totalScraped: ctx.totalScraped });
  ctx.pageEvents.push(buildSoftBlockEvent(blockType, ctx.site, ctx.sectorId, ctx.sectorName, pageIndex, page, ctx.metrics, ctx.runLimit, elapsed));
  return reachedAbortThreshold ? 'abort' : 'continue';
};

export { buildSoftBlockEvent, handleSoftBlock };
