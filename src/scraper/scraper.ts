import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import { SITES } from '../config.js';
import { createRunMetrics, type PageEvent, type PdfFailure } from '../models/metrics.js';
import type { ScrapeOptions } from '../types.js';
import { validateOutput } from '../output/validator.js';
import { writeRunReports } from '../output/runReport.js';
import { makeSession } from '../session/session.js';
import { sleep } from '../utils/delay.js';
import { discoverSectors } from './sectorDiscovery.js';
import { scrapeSector, type SectorContext } from './sectorScraper.js';
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

export const scrapeAll = async (opts: ScrapeOptions): Promise<void> => {
  const config = SITES[opts.site];
  if (!config) throw new Error(`Unknown site: ${opts.site}. Available: ${Object.keys(SITES).join(', ')}`);

  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
  if (opts.pdfDir && !opts.dryRun) fs.mkdirSync(opts.pdfDir, { recursive: true });

  // Determine sectors to scrape
  let sectorsToRun: Array<[string | null, string | null]>;

  if (config.search?.sectorField) {
    const discovered = await discoverSectors(opts.site, opts.proxy);
    const sectors = Object.keys(discovered).length > 0 ? discovered : (config.search.sectors ?? {});

    if (opts.sectorId !== null) {
      sectorsToRun = [[opts.sectorId, sectors[opts.sectorId] ?? opts.sectorId]];
    } else if (Object.keys(sectors).length > 0) {
      sectorsToRun = Object.entries(sectors);
    } else {
      logger.warn('No sectors found - scraping without sector filter');
      sectorsToRun = [[null, null]];
    }
  } else {
    sectorsToRun = [[null, null]];
  }

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

  for (let i = 0; i < sectorsToRun.length; i++) {
    if (opts.limit !== null && totalScraped >= opts.limit) {
      logger.info('Global limit reached', { limit: opts.limit });
      break;
    }

    const [sectorId, sectorName] = sectorsToRun[i];
    const sectorLimit = opts.limit !== null ? opts.limit - totalScraped : null;
    const sectorOpts: ScrapeOptions = { ...opts, limit: sectorLimit };

    logger.info(`-- Sector ${i + 1}/${sectorsToRun.length}: ${sectorName ?? sectorId} --`, { sectorId, sectorName });
    display.sectorBanner(i + 1, sectorsToRun.length, sectorId, sectorName, null);
    const sectorCtx: SectorContext = { sectorId, sectorName, metrics, failedPdfs, pageEvents, runLimit: opts.limit };
    const session = makeSession(config.baseUrl, opts.proxy);
    let result = await scrapeSector(session, config, sectorOpts, sectorCtx);

    // Transient server glitch (JSF search POST returns 0 rows) — retry once with fresh session.
    if (result.count === 0 && !opts.dryRun) {
      logger.warn('Zero docs on first attempt — waiting 5s and retrying with fresh session', { sectorId, sectorName });
      await sleep(5_000);
      const retrySession = makeSession(config.baseUrl, opts.proxy);
      result = await scrapeSector(retrySession, config, sectorOpts, sectorCtx);
    }

    allDocs.push(...result.docs);
    totalScraped += result.count;

    const runSec = Math.round((Date.now() - runStart) / 1000);
    logger.info(`Sector ${i + 1}/${sectorsToRun.length} done`, {
      sector: `${sectorId}=${sectorName}`,
      sectorDocs: result.count,
      totalSoFar: totalScraped,
      runElapsed: runSec < 60 ? `${runSec}s` : `${Math.floor(runSec / 60)}m${runSec % 60}s`,
    });

    if (opts.limit !== null && totalScraped >= opts.limit) {
      logger.info('Global limit reached after sector', { limit: opts.limit, totalScraped });
      break;
    }

    if (i < sectorsToRun.length - 1) {
      const pause = 5_000 + Math.floor(Math.random() * 5_000);
      const next = sectorsToRun[i + 1];
      logger.info(`Pausing ${Math.round(pause / 1000)}s before next sector: ${next[1] ?? next[0]}`, { pauseMs: pause });
      await sleep(pause);
    }
  }

  if (!opts.dryRun && allDocs.length > 0) {
    fs.writeFileSync(opts.outputPath, allDocs.map(d => JSON.stringify(d)).join('\n') + '\n');
  }
  if (failedPdfs.length > 0 && !opts.dryRun) {
    writeFailedPdfReport(opts.failedPdfPath ?? path.join(path.dirname(opts.outputPath), 'failed-pdfs.json'), failedPdfs);
  }

  validateOutput(opts.outputPath, totalScraped, opts.dryRun);

  const elapsedMs = Date.now() - runStart;
  const elapsedMin = Math.max(elapsedMs / 60_000, 0.001);
  const totalPdfCompleted = metrics.totalPdfDownloaded + metrics.totalSkippedExisting;
  const avgPdfLatencyMs = metrics.pdfLatencySamples.length > 0
    ? Math.round(metrics.pdfLatencySamples.reduce((sum, ms) => sum + ms, 0) / metrics.pdfLatencySamples.length)
    : 0;

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
    docsPerMinute: Math.round(metrics.totalDocumentsCollected / elapsedMin),
    pdfsPerMinute: Math.round(totalPdfCompleted / elapsedMin),
    avgPdfLatencyMs,
    failedPdfReport: failedPdfs.length > 0 ? (opts.failedPdfPath ?? path.join(path.dirname(opts.outputPath), 'failed-pdfs.json')) : null,
  });

  const reportPaths = !opts.dryRun
    ? writeRunReports({
      opts,
      metrics,
      failedPdfs,
      pageEvents,
      elapsedMs,
      docsPerMinute: Math.round(metrics.totalDocumentsCollected / elapsedMin),
      pdfsPerMinute: Math.round(totalPdfCompleted / elapsedMin),
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
      ['Docs / min', Math.round(metrics.totalDocumentsCollected / elapsedMin)],
      ['PDFs / min', Math.round(totalPdfCompleted / elapsedMin)],
      ['Avg PDF latency', `${avgPdfLatencyMs} ms`],
      ['Duration', formatDuration(elapsedMs)],
    ],
    reportPaths ? `Artifacts → ${path.dirname(opts.outputPath)}/` : undefined,
  );
};
