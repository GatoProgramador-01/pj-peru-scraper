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

import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { scrapeAll, discoverSectors } from './http-scraper.js';
import { logger } from './logger.js';
import type { ScrapeOptions } from './types.js';

// Force synchronous (unbuffered) stdout writes on Windows pipes.
// Without this, process.stdout.write() buffers in ~64 KB chunks when stdout
// is redirected to a file (non-TTY), so Get-Content -Wait sees nothing until
// the buffer fills or the process exits.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(process.stdout as any)._handle?.setBlocking?.(true);

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
  .option('district', {
    type: 'string',
    describe: 'pj-peru only: district ID to filter buDistrito (e.g. 18=Lima). Used by parallel-districts.mjs.',
  })
  .option('year', {
    type: 'string',
    describe: 'pj-peru only: year filter for formBuscador:buAnio. Useful for Suprema parallel partitions.',
  })
  .option('specialty', {
    type: 'string',
    describe: 'pj-peru only: specialty ID filter for formBuscador:buEspecialidad.',
  })
  .option('checkpoint-id', {
    type: 'string',
    describe: 'Optional checkpoint partition suffix for parallel workers on the same site/sector.',
  })
  .option('discover-sectors', {
    type: 'boolean',
    default: false,
    describe: 'Print available sectors from the live page and exit',
  })
  .option('out', {
    type: 'string',
    default: 'output/results.jsonl',
    describe: 'Output JSONL file. Workers write completed partitions at the end.',
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
    describe: 'Maximum concurrent PDF downloads per page.',
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

const outputDir = path.dirname(argv.out);
const opts: ScrapeOptions = {
  site: argv.site,
  outputPath: argv.out,
  pdfDir: argv.pdfs ? (argv['pdf-dir'] ?? './pdfs') : null,
  failedPdfPath: path.join(outputDir, 'failed-pdfs.json'),
  limit: argv.limit ?? null,
  dryRun: argv['dry-run'],
  proxy: argv.proxy ?? null,
  headed: false,
  profile: null,
  resume: argv.resume,
  sectorId: argv.sector ?? null,
  districtId: argv.district ?? null,
  searchFields: {
    ...(argv.year ? { 'formBuscador:buAnio': argv.year } : {}),
    ...(argv.specialty ? { 'formBuscador:buEspecialidad': argv.specialty } : {}),
  },
  checkpointId: argv['checkpoint-id'] ?? null,
  pdfConcurrency: Math.max(1, argv['pdf-concurrency']),
};

if (Object.keys(opts.searchFields ?? {}).length === 0) delete opts.searchFields;

logger.info('Starting scrape', {
  site: opts.site,
  dryRun: opts.dryRun,
  sectorId: opts.sectorId,
  districtId: opts.districtId,
  searchFields: opts.searchFields,
  checkpointId: opts.checkpointId,
  limit: opts.limit,
  pdfDir: opts.pdfDir,
  pdfConcurrency: opts.pdfConcurrency,
});
await scrapeAll(opts);
