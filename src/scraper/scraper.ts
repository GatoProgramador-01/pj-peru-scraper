import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import { SITES } from '../config.js';
import { createRunMetrics, type PageEvent, type PdfFailure } from '../models/metrics.js';
import type { SectorContext } from '../models/scraperTypes.js';
import type { ScrapeOptions } from '../types.js';
import type { JudicialDocument } from '../types.js';
import { validateOutput } from '../output/validator.js';
import { writeRunReports } from '../output/runReport.js';
import * as display from '../display/terminal.js';
import { resolveSectorsToRun, hasReachedGlobalLimit, scrapeSectorWithRetry, pauseBetweenSectors } from './sectorLoop.js';
import { formatDuration, calcRunStats, logSectorDone } from './runStats.js';
import { writeScrapeOutput } from './runOutput.js';

/**
 * Top-level orchestrator: runs a full scrape for the requested site.
 *
 * @remarks
 * Full lifecycle in order:
 * 1. **Config lookup** — throws immediately when `opts.site` is unknown.
 * 2. **Directory setup** — creates output dir and `pdfDir` (unless dry-run).
 * 3. **Sector resolution** — live discovery first; falls back to config sectors.
 * 4. **Sector loop** — calls `scrapeSectorWithRetry` per sector with a random
 *    5–10 s pause between sectors. Stops early when `opts.limit` is reached.
 * 5. **Output flush** — JSONL documents + failed-PDF report via `writeScrapeOutput`.
 * 6. **Validation** — `validateOutput` asserts non-zero results (skipped on dry-run).
 * 7. **Reports** — JSON summary, page-events JSONL, and Markdown report written.
 * 8. **Terminal summary** — throughput table rendered via `display.runSummary`.
 *
 * @param opts - Scrape options; `opts.site` must match a key in `SITES` and
 *   `opts.outputPath` determines where the JSONL is written
 * @returns `Promise<void>` — all output is written to disk as a side effect
 * @throws {Error} When `opts.site` is not a key in `SITES`
 * @throws {Error} When `validateOutput` detects zero records collected
 */
export const scrapeAll = async (opts: ScrapeOptions): Promise<void> => {
  const config = SITES[opts.site];
  if (!config) throw new Error(`Unknown site: ${opts.site}. Available: ${Object.keys(SITES).join(', ')}`);

  // ── Setup ──────────────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
  if (opts.pdfDir && !opts.dryRun) fs.mkdirSync(opts.pdfDir, { recursive: true });

  const sectorsToRun = await resolveSectorsToRun(config, opts);
  logger.info('Sectors queued', { count: sectorsToRun.length, sectors: sectorsToRun.map(([id, name]) => `${id}=${name}`).join(', ') });

  const sectorLabel = opts.sectorId != null
    ? sectorsToRun[0]?.[1] ? `${opts.sectorId}=${sectorsToRun[0][1]}` : opts.sectorId
    : null;
  display.runBanner(config.name, sectorLabel, opts.outputPath, opts.limit);

  // ── Shared state ───────────────────────────────────────────────────────────
  const failedPdfs: PdfFailure[] = [];
  const pageEvents: PageEvent[] = [];
  const metrics = createRunMetrics();
  const allDocs: JudicialDocument[] = [];
  let totalScraped = 0;
  const runStart = Date.now();

  // ── Sector loop ────────────────────────────────────────────────────────────
  for (let i = 0; i < sectorsToRun.length; i++) {
    if (hasReachedGlobalLimit(totalScraped, opts.limit)) break;

    const [sectorId, sectorName] = sectorsToRun[i];
    const sectorLimit = opts.limit !== null ? opts.limit - totalScraped : null;
    const sectorCtx: SectorContext = { sectorId, sectorName, metrics, failedPdfs, pageEvents, runLimit: opts.limit };

    logger.info(`-- Sector ${i + 1}/${sectorsToRun.length}: ${sectorName ?? sectorId} --`, { sectorId, sectorName });
    display.sectorBanner(i + 1, sectorsToRun.length, sectorId, sectorName, null);

    const result = await scrapeSectorWithRetry(config, { ...opts, limit: sectorLimit }, sectorCtx);

    allDocs.push(...result.docs);
    totalScraped += result.count;
    logSectorDone(i, sectorsToRun.length, sectorId, sectorName, result.count, totalScraped, runStart);

    if (hasReachedGlobalLimit(totalScraped, opts.limit)) break;
    if (i < sectorsToRun.length - 1) await pauseBetweenSectors(sectorsToRun[i + 1]);
  }

  // ── Output ─────────────────────────────────────────────────────────────────
  writeScrapeOutput(opts, allDocs, failedPdfs);
  validateOutput(opts.outputPath, totalScraped, opts.dryRun);

  // ── Run metrics ────────────────────────────────────────────────────────────
  const elapsedMs = Date.now() - runStart;
  const { avgPdfLatencyMs, docsPerMinute, pdfsPerMinute } = calcRunStats(metrics, elapsedMs);

  logger.info('Run metrics', {
    totalDocumentsCollected: metrics.totalDocumentsCollected,
    totalPdfCandidates: metrics.totalPdfCandidates,
    totalPdfDownloaded: metrics.totalPdfDownloaded,
    totalPdfFailed: metrics.totalPdfFailed,
    totalPdfMissing: metrics.totalPdfMissing,
    totalPdfConfidential: metrics.totalPdfConfidential,
    totalSkippedExisting: metrics.totalSkippedExisting,
    total429: metrics.total429,
    totalRetries: metrics.totalRetries,
    elapsedTime: formatDuration(elapsedMs),
    docsPerMinute,
    pdfsPerMinute,
    avgPdfLatencyMs,
    failedPdfReport: failedPdfs.length > 0
      ? (opts.failedPdfPath ?? path.join(path.dirname(opts.outputPath), 'failed-pdfs.json'))
      : null,
  });

  // ── Reports ────────────────────────────────────────────────────────────────
  const reportPaths = !opts.dryRun
    ? writeRunReports({ opts, metrics, pageEvents, elapsedMs, docsPerMinute, pdfsPerMinute, avgPdfLatencyMs, totalScraped })
    : null;

  if (reportPaths) logger.info('Run artifacts written', reportPaths);

  logger.info('Run complete', {
    site: opts.site,
    totalScraped,
    output: opts.outputPath,
    totalElapsed: formatDuration(Date.now() - runStart),
  });

  // ── Terminal summary ───────────────────────────────────────────────────────
  display.runSummary(
    [
      ['Documents collected', metrics.totalDocumentsCollected],
      ['PDFs downloaded', metrics.totalPdfDownloaded],
      ['PDFs skipped (already existed)', metrics.totalSkippedExisting],
      ['Confidential (unavailable)', metrics.totalPdfConfidential],
      ['Failed downloads', metrics.totalPdfFailed],
      ['HTTP 429 events', metrics.total429],
      ['Total retries', metrics.totalRetries],
      ['Docs / min', docsPerMinute],
      ['PDFs / min', pdfsPerMinute],
      ['Avg PDF latency', `${avgPdfLatencyMs} ms`],
      ['Duration', formatDuration(elapsedMs)],
    ],
    reportPaths ? `Artifacts → ${path.dirname(opts.outputPath)}/` : undefined,
  );
};
