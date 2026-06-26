/**
 * CLI — unified entry point for HTTP scraper, browser scraper, and recon.
 *
 * Usage:
 *   node dist/cli.js --site oefa --dry-run
 *   node dist/cli.js --site oefa --limit 100 --out output/oefa.jsonl
 *   node dist/cli.js --site oefa --sector 1
 *   node dist/cli.js --site oefa --pdfs --resume
 *   node dist/cli.js --site oefa --discover-sectors
 *   node dist/cli.js --site pj-peru --proxy http://user:pass@host:3128 --pdfs
 *   node dist/cli.js --mode browser --site oefa --headed --limit 50
 *   node dist/cli.js --mode recon --site oefa
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { scrapeAll as httpScrape, discoverSectors } from './http-scraper.js';
import { PJPeruScraper } from './scraper.js';
import { logger } from './logger.js';
import type { ScrapeOptions } from './types.js';

const argv = await yargs(hideBin(process.argv))
  .option('mode', {
    type: 'string',
    choices: ['http', 'browser', 'recon'] as const,
    default: 'http' as const,
    describe: 'http = HTTP-only (primary) | browser = Puppeteer fallback | recon = selector discovery',
  })
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
  .option('headed', {
    type: 'boolean',
    default: false,
    describe: '[browser mode] Show Chrome window',
  })
  .option('profile', {
    type: 'string',
    describe: '[browser mode] Persistent Chrome profile dir for trusted session cookies',
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
  headed: argv.headed,
  profile: argv.profile ?? null,
  resume: argv.resume,
  sectorId: argv.sector ?? null,
};

switch (argv.mode) {
  case 'http': {
    logger.info('Mode: HTTP scraper', { site: opts.site, dryRun: opts.dryRun, sectorId: opts.sectorId, limit: opts.limit });
    await httpScrape(opts);
    break;
  }

  case 'browser': {
    logger.info('Mode: Browser scraper (Puppeteer)', { site: opts.site, headed: opts.headed });
    const scraper = new PJPeruScraper(opts.site);
    try {
      await scraper.launch({ proxy: opts.proxy, headed: opts.headed, profile: opts.profile ?? null });
      await scraper.scrapeAll(opts);
    } finally {
      await scraper.close();
    }
    break;
  }

  case 'recon': {
    logger.info('Run recon directly: node dist/recon.js --site ' + opts.site);
    break;
  }
}
