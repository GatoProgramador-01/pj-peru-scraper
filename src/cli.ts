/**
 * CLI — entry point for the HTTP scraper and recon tool.
 *
 * Usage:
 *   node dist/cli.js --site oefa --dry-run
 *   node dist/cli.js --site oefa --limit 100 --out output/oefa.jsonl
 *   node dist/cli.js --site oefa --sector 1
 *   node dist/cli.js --site oefa --pdfs --resume
 *   node dist/cli.js --site oefa --limit 100 --pdfs --pdf-dir output/test100/pdfs
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
  .option('pdf-dir', {
    type: 'string',
    describe: 'Directory for downloaded PDFs. Requires --pdfs.',
  })
  .option('pdf-concurrency', {
    type: 'number',
    default: Number(process.env.PDF_CONCURRENCY ?? 1),
    describe: 'Direct PDF URL download concurrency. JSF action PDFs remain sequential.',
  })
  .option('fresh-output', {
    type: 'boolean',
    default: false,
    describe: 'Remove the output JSONL and failed-pdfs report before scraping.',
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

if (argv['fresh-output']) {
  const fs = await import('fs');
  const path = await import('path');
  fs.rmSync(argv.out, { force: true });
  fs.rmSync(path.join(path.dirname(argv.out), 'failed-pdfs.json'), { force: true });
}

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
  pdfDir: argv.pdfs ? (argv['pdf-dir'] ?? './pdfs') : null,
  failedPdfPath: 'failed-pdfs.json',
  limit: argv.limit ?? null,
  dryRun: argv['dry-run'],
  proxy: argv.proxy ?? null,
  headed: false,
  profile: null,
  resume: argv.resume,
  sectorId: argv.sector ?? null,
  pdfConcurrency: Math.max(1, argv['pdf-concurrency'] ?? 1),
};

opts.failedPdfPath = `${opts.outputPath.replace(/[^/\\]+$/, '')}failed-pdfs.json`;

logger.info('Starting scrape', {
  site: opts.site,
  dryRun: opts.dryRun,
  sectorId: opts.sectorId,
  limit: opts.limit,
  pdfDir: opts.pdfDir,
  pdfConcurrency: opts.pdfConcurrency,
});
await scrapeAll(opts);
