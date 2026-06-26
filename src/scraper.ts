/**
 * scraper.ts — Puppeteer browser fallback (dev tool only).
 *
 * Used only with --mode browser. Primary deliverable is http-scraper.ts.
 * Puppeteer is in devDependencies; do NOT add to production bundle.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { load as cheerioLoad } from 'cheerio';
import { logger } from './logger.js';
import { SITES } from './config.js';
import type { JudicialDocument, ScrapeOptions } from './types.js';

export class PJPeruScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly site: string;

  constructor(site: string) {
    this.site = site;
  }

  async launch(opts: { proxy: string | null; headed: boolean; profile: string | null }): Promise<void> {
    const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'];
    if (opts.proxy) args.push(`--proxy-server=${opts.proxy}`);

    this.browser = await puppeteer.launch({
      headless: !opts.headed,
      args,
      userDataDir: opts.profile ?? undefined,
    });
    this.page = await this.browser.newPage();
    await this.page.setExtraHTTPHeaders({ 'Accept-Language': 'es-PE,es;q=0.9' });
  }

  async scrapeAll(opts: ScrapeOptions): Promise<void> {
    const config = SITES[this.site];
    if (!config) throw new Error(`Unknown site: ${this.site}`);
    if (!this.page) throw new Error('Browser not launched — call launch() first');

    fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
    if (opts.pdfDir) fs.mkdirSync(opts.pdfDir, { recursive: true });

    const out = opts.dryRun ? null : fs.createWriteStream(opts.outputPath, { flags: 'a' });
    let totalScraped = 0;
    let pageIndex = 0;

    logger.info('Browser scrape: navigating to start URL', { url: config.startUrl });
    await this.page.goto(config.startUrl, { waitUntil: 'networkidle2', timeout: config.timing.navigationTimeoutMs });

    while (true) {
      if (opts.limit !== null && totalScraped >= opts.limit) break;

      const html = await this.page.content();
      const $ = cheerioLoad(html);
      const rows = $(config.selectors.rows).toArray();

      if (rows.length === 0) { logger.info('No rows on page — stopping', { pageIndex }); break; }

      for (const tr of rows) {
        if (opts.limit !== null && totalScraped >= opts.limit) break;
        const cells = $(tr).find('td').toArray().map(td => $(td).text().trim());
        if (!cells.some(c => c.length > 0)) continue;

        const c = config.columns;
        const caseNumber = cells[c.caseNumber] ?? '';
        const doc: JudicialDocument = {
          id: `${this.site}_B_${caseNumber}_${pageIndex}_${totalScraped}`.replace(/[^A-Z0-9_]/gi, '_').toUpperCase(),
          site: this.site,
          sector: null,
          caseNumber,
          court: c.court !== undefined ? (cells[c.court] ?? null) : null,
          date: c.date !== undefined ? (cells[c.date] ?? null) : null,
          summary: c.summary !== undefined ? (cells[c.summary] ?? null) : null,
          resolution: c.resolution !== undefined ? (cells[c.resolution] ?? null) : null,
          pdfUrl: null,
          pdfLocalPath: null,
          pageIndex,
          rowIndex: totalScraped,
          fetchedAt: new Date().toISOString(),
          rawCells: cells,
        };

        if (opts.dryRun) {
          logger.info('[dry-run] row', { caseNumber: doc.caseNumber });
        } else {
          out!.write(JSON.stringify(doc) + '\n');
          totalScraped++;
        }
      }

      const nextBtn = await this.page.$(config.selectors.nextButton);
      if (!nextBtn) { logger.info('No next button — last page', { pageIndex }); break; }

      const disabled = await nextBtn.evaluate(el => el.classList.contains('ui-state-disabled') || el.getAttribute('aria-disabled') === 'true');
      if (disabled) { logger.info('Next button disabled — last page', { pageIndex }); break; }

      await nextBtn.click();
      await this.page.waitForNetworkIdle({ timeout: config.timing.navigationTimeoutMs }).catch(() => {});
      pageIndex++;
    }

    out?.end();
    logger.info('Browser scrape complete', { totalScraped, site: this.site });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }
}
