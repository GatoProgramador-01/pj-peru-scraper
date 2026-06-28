import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import { SITES } from '../config.js';
import { createRunMetrics, type PageEvent, type PdfFailure } from '../models/metrics.js';
import type { SectorContext, SectorResult } from '../models/scraperTypes.js';
import type { ScrapeOptions, SiteConfig } from '../types.js';
import { validateOutput } from '../output/validator.js';
import { writeRunReports } from '../output/runReport.js';
import { makeSession } from '../session/session.js';
import { sleep } from '../utils/delay.js';
import { discoverSectors } from './sectorDiscovery.js';
import { scrapeSector } from './sectorScraper.js';
import type { JudicialDocument } from '../types.js';
import * as display from '../display/terminal.js';

const formatDuration = (ms: number): string => {
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
};

const writeFailedPdfReport = (failedPdfPath: string, failedPdfs: PdfFailure[]): void => {
  fs.mkdirSync(path.dirname(failedPdfPath), { recursive: true });
  fs.writeFileSync(failedPdfPath, JSON.stringify(failedPdfs, null, 2));
};

// ── Extracted helpers ────────────────────────────────────────────────────────

/**
 * Resolves the ordered list of [sectorId, sectorName] pairs to scrape.
 * Discovery runs live against the site; config.search.sectors acts as a
 * fallback when the live call returns nothing (e.g. site is down).
 */
const resolveSectorsToRun = async (
  config: SiteConfig,
  opts: ScrapeOptions,
): Promise<Array<[string | null, string | null]>> => {
  // Sites without a sector dropdown are treated as a single unnamed sector.
  if (!config.search?.sectorField) return [[null, null]];

  const discovered = await discoverSectors(opts.site, opts.proxy);
  const sectors = Object.keys(discovered).length > 0 ? discovered : (config.search.sectors ?? {});

  if (opts.sectorId !== null) {
    // Caller requested one specific sector — ignore the rest.
    return [[opts.sectorId, sectors[opts.sectorId] ?? opts.sectorId]];
  }

  if (Object.keys(sectors).length > 0) {
    return Object.entries(sectors);
  }

  // Discovery returned nothing and config has no fallback — proceed without filter.
  logger.warn('No sectors found - scraping without sector filter');
  return [[null, null]];
};

/** Returns true when we have already collected as many docs as the caller requested. */
const hasReachedGlobalLimit = (totalScraped: number, limit: number | null): boolean =>
  limit !== null && totalScraped >= limit;

/**
 * Runs scrapeSector for a single sector, retrying once if the first attempt
 * returns zero documents.
 * Transient server glitch (JSF search POST returns 0 rows) — retry once with fresh session.
 */
const scrapeSectorWithRetry = async (
  config: SiteConfig,
  opts: ScrapeOptions,
  sectorCtx: SectorContext,
): Promise<SectorResult> => {
  const session = makeSession(config.baseUrl, opts.proxy);
  let result = await scrapeSector(session, config, opts, sectorCtx);

  if (result.count === 0 && !opts.dryRun) {
    logger.warn('Zero docs on first attempt — waiting 5s and retrying with fresh session', {
      sectorId: sectorCtx.sectorId,
      sectorName: sectorCtx.sectorName,
    });
    await sleep(5_000);
    const retrySession = makeSession(config.baseUrl, opts.proxy);
    result = await scrapeSector(retrySession, config, opts, sectorCtx);
  }

  return result;
};

/** Logs a one-line summary once a sector finishes, including cumulative progress. */
const logSectorDone = (
  i: number,
  total: number,
  sectorId: string | null,
  sectorName: string | null,
  sectorCount: number,
  totalSoFar: number,
  runStart: number,
): void => {
  const runSec = Math.round((Date.now() - runStart) / 1000);
  logger.info(`Sector ${i + 1}/${total} done`, {
    sector: `${sectorId}=${sectorName}`,
    sectorDocs: sectorCount,
    totalSoFar,
    runElapsed: runSec < 60 ? `${runSec}s` : `${Math.floor(runSec / 60)}m${runSec % 60}s`,
  });
};

/**
 * Inserts a random 5–10 s pause before the next sector to avoid hammering
 * the server with back-to-back requests.
 */
const pauseBetweenSectors = async (next: [string | null, string | null]): Promise<void> => {
  const pause = 5_000 + Math.floor(Math.random() * 5_000);
  logger.info(`Pausing ${Math.round(pause / 1000)}s before next sector: ${next[1] ?? next[0]}`, { pauseMs: pause });
  await sleep(pause);
};

/** Derives the human-readable stats shown in the final run summary. */
const calcRunStats = (
  metrics: ReturnType<typeof createRunMetrics>,
  elapsedMs: number,
): { elapsedMin: number; totalPdfCompleted: number; avgPdfLatencyMs: number; docsPerMinute: number; pdfsPerMinute: number } => {
  const elapsedMin = Math.max(elapsedMs / 60_000, 0.001);
  const totalPdfCompleted = metrics.totalPdfDownloaded + metrics.totalSkippedExisting;
  const avgPdfLatencyMs = metrics.pdfLatencySamples.length > 0
    ? Math.round(metrics.pdfLatencySamples.reduce((sum, ms) => sum + ms, 0) / metrics.pdfLatencySamples.length)
    : 0;
  return {
    elapsedMin,
    totalPdfCompleted,
    avgPdfLatencyMs,
    docsPerMinute: Math.round(metrics.totalDocumentsCollected / elapsedMin),
    pdfsPerMinute: Math.round(totalPdfCompleted / elapsedMin),
  };
};

/**
 * Flushes all collected documents to JSONL and, if any PDFs failed,
 * writes a structured failure report alongside the main output.
 */
const writeScrapeOutput = (
  opts: ScrapeOptions,
  allDocs: JudicialDocument[],
  failedPdfs: PdfFailure[],
): void => {
  if (!opts.dryRun && allDocs.length > 0) {
    fs.writeFileSync(opts.outputPath, allDocs.map(d => JSON.stringify(d)).join('\n') + '\n');
  }
  if (failedPdfs.length > 0 && !opts.dryRun) {
    const failedPdfPath = opts.failedPdfPath ?? path.join(path.dirname(opts.outputPath), 'failed-pdfs.json');
    writeFailedPdfReport(failedPdfPath, failedPdfs);
  }
};

// ── Orchestrator ─────────────────────────────────────────────────────────────

export const scrapeAll = async (opts: ScrapeOptions): Promise<void> => {
  const config = SITES[opts.site];
  if (!config) throw new Error(`Unknown site: ${opts.site}. Available: ${Object.keys(SITES).join(', ')}`);

  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
  if (opts.pdfDir && !opts.dryRun) fs.mkdirSync(opts.pdfDir, { recursive: true });

  const sectorsToRun = await resolveSectorsToRun(config, opts);

  logger.info('Sectors queued', { count: sectorsToRun.length, sectors: sectorsToRun.map(([id, name]) => `${id}=${name}`).join(', ') });

  const sectorLabel = opts.sectorId != null
    ? sectorsToRun[0]?.[1] ? `${opts.sectorId}=${sectorsToRun[0][1]}` : opts.sectorId
    : null;
  display.runBanner(config.name, sectorLabel, opts.outputPath, opts.limit);

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

  // ── Write output ───────────────────────────────────────────────────────────
  writeScrapeOutput(opts, allDocs, failedPdfs);
  validateOutput(opts.outputPath, totalScraped, opts.dryRun);

  // ── Run metrics ────────────────────────────────────────────────────────────
  const elapsedMs = Date.now() - runStart;
  const { elapsedMin, totalPdfCompleted, avgPdfLatencyMs, docsPerMinute, pdfsPerMinute } = calcRunStats(metrics, elapsedMs);

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
    failedPdfReport: failedPdfs.length > 0 ? (opts.failedPdfPath ?? path.join(path.dirname(opts.outputPath), 'failed-pdfs.json')) : null,
  });

  const reportPaths = !opts.dryRun
    ? writeRunReports({
      opts,
      metrics,
      pageEvents,
      elapsedMs,
      docsPerMinute,
      pdfsPerMinute,
      avgPdfLatencyMs,
      totalScraped,
    })
    : null;

  if (reportPaths) {
    logger.info('Run artifacts written', reportPaths);
  }

  logger.info('Run complete', {
    site: opts.site,
    totalScraped,
    output: opts.outputPath,
    totalElapsed: formatDuration(Date.now() - runStart),
  });

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
