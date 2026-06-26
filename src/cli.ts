/**
 * CLI — entry point for the HTTP scraper and recon tool.
 *
 * Usage:
 *   node dist/cli.js --site oefa --dry-run
 *   node dist/cli.js --site oefa --limit 100 --out output/oefa.jsonl
 *   node dist/cli.js --site oefa --sector 1
 *   node dist/cli.js --site oefa --pdfs --resume
 *   node dist/cli.js --site oefa --discover-sectors
 *   node dist/cli.js --site pj-peru --proxy http://user:pass@host:3128 --pdfs
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { scrapeAll, discoverSectors } from './http-scraper.js';
import { logger } from './logger.js';
import type { ScrapeOptions } from './types.js';

const argv = await yargs(hideBin(process.argv))
  .option('site', {
    type: 'string',
    choices: ['pj-peru', 'oefa'] as const,
    default: 'oefa' as const,
    describe: 'Portal to scrape',
  })
  .option('sector', {
    type: 'string',
    describe: 'Sector ID to scrape (e.g. 1=MINERIA). Omit to scrape all sectors.',
  })
  .option('discover-sectors', {
    type: 'boolean',
    default: false,
    describe: 'Print available sectors from the live page and exit',
  })
  .option('out', {
    type: 'string',
    default: 'output/results.jsonl',
    describe: 'Output JSONL file (append-safe — crash-resumable)',
  })
  .option('pdfs', {
    type: 'boolean',
    default: false,
    describe: 'Download PDFs to ./pdfs/',
  })
  .option('limit', {
    type: 'number',
    describe: 'Max documents to scrape (omit for all)',
  })
  .option('proxy', {
    type: 'string',
    describe: 'Proxy URL: http://[user:pass@]host:port',
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    describe: 'Log without writing output files',
  })
  .option('resume', {
    type: 'boolean',
    default: false,
    describe: 'Resume from last per-sector checkpoint',
  })
  .help()
  .parseAsync();

if (argv['discover-sectors']) {
  logger.info('Discovering sectors...', { site: argv.site });
  const sectors = await discoverSectors(argv.site, argv.proxy ?? null);
  console.log('\nAvailable sectors:');
  Object.entries(sectors).forEach(([id, name]) => console.log(`  ${id} → ${name}`));
  process.exit(0);
}

const opts: ScrapeOptions = {
  site: argv.site,
  outputPath: argv.out,
  pdfDir: argv.pdfs ? './pdfs' : null,
  limit: argv.limit ?? null,
  dryRun: argv['dry-run'],
  proxy: argv.proxy ?? null,
  headed: false,
  profile: null,
  resume: argv.resume,
  sectorId: argv.sector ?? null,
};

logger.info('Starting scrape', { site: opts.site, dryRun: opts.dryRun, sectorId: opts.sectorId, limit: opts.limit });
await scrapeAll(opts);
