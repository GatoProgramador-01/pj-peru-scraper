import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import { SITES } from '../config.js';
import type { ScrapeOptions } from '../types.js';
import { validateOutput } from '../output/validator.js';
import { makeSession } from '../session/session.js';
import { sleep } from '../utils/delay.js';
import { discoverSectors } from './sectorDiscovery.js';
import { scrapeSector } from './sectorScraper.js';

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
      logger.warn('No sectors found — scraping without sector filter');
      sectorsToRun = [[null, null]];
    }
  } else {
    sectorsToRun = [[null, null]];
  }

  logger.info('Sectors queued', { count: sectorsToRun.length, sectors: sectorsToRun.map(([id, name]) => `${id}=${name}`).join(', ') });

  const out = opts.dryRun ? null : fs.createWriteStream(opts.outputPath, { flags: 'a' });
  let totalScraped = 0;
  const runStart = Date.now();

  for (let i = 0; i < sectorsToRun.length; i++) {
    const [sectorId, sectorName] = sectorsToRun[i];
    logger.info(`── Sector ${i + 1}/${sectorsToRun.length}: ${sectorName ?? sectorId} ──`, { sectorId, sectorName });
    const session = makeSession(config.baseUrl, opts.proxy);
    const count = await scrapeSector(session, config, opts, sectorId, sectorName, out);
    totalScraped += count;

    const runSec = Math.round((Date.now() - runStart) / 1000);
    logger.info(`Sector ${i + 1}/${sectorsToRun.length} done`, {
      sector: `${sectorId}=${sectorName}`,
      sectorDocs: count,
      totalSoFar: totalScraped,
      runElapsed: runSec < 60 ? `${runSec}s` : `${Math.floor(runSec / 60)}m${runSec % 60}s`,
    });

    if (i < sectorsToRun.length - 1) {
      const pause = 5_000 + Math.floor(Math.random() * 5_000);
      const next = sectorsToRun[i + 1];
      logger.info(`Pausing ${Math.round(pause / 1000)}s before next sector: ${next[1] ?? next[0]}`, { pauseMs: pause });
      await sleep(pause);
    }
  }

  out?.end();
  validateOutput(opts.outputPath, totalScraped, opts.dryRun);
  const totalSec = Math.round((Date.now() - runStart) / 1000);
  logger.info('Run complete', {
    site: opts.site,
    totalScraped,
    output: opts.outputPath,
    totalElapsed: totalSec < 60 ? `${totalSec}s` : `${Math.floor(totalSec / 60)}m${totalSec % 60}s`,
  });
};
