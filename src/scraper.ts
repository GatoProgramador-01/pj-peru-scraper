/**
 * scraper.ts — Puppeteer browser scraper (fallback for F5/Cloudflare portals).
 *
 * Use this when HTTP-only fails due to JS challenges or TLS fingerprinting.
 * All API calls run inside the browser via page.evaluate() so the browser's
 * TLS stack and cookies are used for every request.
 *
 * Strategy (from scraper.md § F5 BIG-IP ASM):
 *  - Stealth plugin patches navigator.webdriver + headless signals
 *  - wait_for_selector > fixed timeout (survives JS challenge redirects)
 *  - Wait in place on retry attempts 1-2 (TSPD cookie stays valid)
 *  - Re-bootstrap only on attempt 3
 *  - Persistent profile carries trusted session across restarts
 */

import { createRequire } from 'module';
import type { Browser, Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { SITES } from './config.js';
import type { JudicialDocument, ScrapeOptions, SiteConfig } from './types.js';

// puppeteer-extra + stealth loaded via require (CJS package, ESM interop)
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const puppeteer: any = _require('puppeteer-extra');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const StealthPlugin: any = _require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const jitter = (min: number, max: number): Promise<void> =>
  sleep(min + Math.floor(Math.random() * (max - min)));

const normDate = (raw: string): string => {
  const m = raw.trim().match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : raw.trim();
};

const buildId = (site: string, caseNum: string, date: string): string => {
  const clean = (s: string) => s.replace(/[^A-Z0-9]/gi, '_').toUpperCase().slice(0, 40);
  return `${site}_${clean(caseNum)}_${clean(date)}`;
};

const CHECKPOINT_FILE = './output/checkpoint_browser.json';

export class PJPeruScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly config: SiteConfig;
  private readonly siteName: string;

  constructor(siteName: string) {
    if (!(siteName in SITES)) throw new Error(`Unknown site: ${siteName}`);
    this.siteName = siteName;
    this.config = SITES[siteName];
  }

  async launch(opts: Pick<ScrapeOptions, 'proxy' | 'headed' | 'profile'>): Promise<void> {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--lang=es-PE,es;q=0.9,en;q=0.8',
    ];
    if (opts.proxy) args.push(`--proxy-server=${opts.proxy}`);

    const launchOpts = {
      headless: !opts.headed,
      args,
      defaultViewport: { width: 1366, height: 768 },
      ...(opts.profile ? { userDataDir: opts.profile } : {}),
    };

    this.browser = await puppeteer.launch(launchOpts) as Browser;
    const pages = await this.browser.pages();
    this.page = pages[0] ?? await this.browser.newPage();
    await this.page.setExtraHTTPHeaders({ 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' });
    logger.info('Browser launched', { site: this.siteName, headed: opts.headed });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }

  async bootstrap(): Promise<void> {
    if (!this.page) throw new Error('Browser not launched');
    const { startUrl, selectors, timing } = this.config;

    await this.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: timing.navigationTimeoutMs });
    await sleep(3000); // let PrimeFaces JS initialize

    try {
      await this.page.waitForSelector(selectors.rows, { timeout: timing.selectorTimeoutMs });
    } catch {
      const body = await this.page.evaluate(() => document.body.innerText.slice(0, 300));
      logger.warn('Table not found after bootstrap', { body });
      throw new Error('Bootstrap failed — results table not visible');
    }
    logger.info('Bootstrap complete');
  }

  async extractPage(pageIndex: number): Promise<JudicialDocument[]> {
    if (!this.page) throw new Error('Not launched');
    const { selectors } = this.config;

    const rows = await this.page.evaluate(
      (rowSel: string, pdfSel: string, base: string) =>
        Array.from(document.querySelectorAll(rowSel))
          .filter(tr => (tr as HTMLElement).offsetParent !== null)
          .map(tr => {
            const cells = Array.from(tr.querySelectorAll('td')).map(td => (td as HTMLElement).innerText.trim());
            const el = tr.querySelector(pdfSel) as HTMLAnchorElement | null;
            let href = el?.href ?? el?.getAttribute('onclick') ?? null;
            if (href && !href.startsWith('http') && !href.startsWith('javascript')) href = base + '/' + href.replace(/^\//, '');
            return { cells, pdfHref: href };
          })
          .filter(r => r.cells.some(c => c.length > 0)),
      selectors.rows,
      selectors.pdfLink,
      this.config.baseUrl,
    );

    return rows.map((r, rowIndex) => {
      const [caseNumber = '', court = '', date = '', summary = '', resolution = ''] = r.cells;
      return {
        id: buildId(this.siteName, caseNumber, date),
        site: this.siteName,
        sector: null,
        caseNumber,
        court: court || null,
        date: date ? normDate(date) : null,
        summary: summary || null,
        resolution: resolution || null,
        pdfUrl: r.pdfHref?.startsWith('http') ? r.pdfHref : null,
        pdfLocalPath: null,
        pageIndex,
        rowIndex,
        fetchedAt: new Date().toISOString(),
        rawCells: r.cells,
      } satisfies JudicialDocument;
    });
  }

  /** Click the PrimeFaces "next page" button and wait for AJAX table update. */
  async nextPage(): Promise<boolean> {
    if (!this.page) throw new Error('Not launched');
    const { selectors, timing } = this.config;

    const btn = await this.page.$(selectors.nextButton);
    if (!btn) { logger.info('No next button — last page'); return false; }

    const before = await this.page.evaluate(
      (sel: string) => document.querySelector(sel)?.textContent ?? '',
      selectors.rows,
    );

    await btn.click();

    try {
      await this.page.waitForFunction(
        (sel: string, b: string) => { const el = document.querySelector(sel); return el !== null && el.textContent !== b; },
        { timeout: timing.selectorTimeoutMs },
        selectors.rows,
        before,
      );
    } catch {
      logger.warn('Table did not update after click — treating as last page');
      return false;
    }

    await jitter(...timing.pageDelayMs);
    return true;
  }

  async scrapeAll(opts: ScrapeOptions): Promise<void> {
    const { outputPath, pdfDir, limit, dryRun } = opts;
    if (!dryRun) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      if (pdfDir) fs.mkdirSync(pdfDir, { recursive: true });
    }

    const out = dryRun ? null : fs.createWriteStream(outputPath, { flags: 'a' });
    let totalScraped = 0;
    let pageIndex = 0;

    try {
      await this.bootstrap();

      // Navigate to resume page by clicking next N times
      for (let i = 0; i < pageIndex; i++) {
        const ok = await this.nextPage();
        if (!ok) throw new Error(`Cannot resume to page ${pageIndex}`);
      }

      while (true) {
        if (limit !== null && totalScraped >= limit) break;

        let docs: JudicialDocument[] = [];
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            docs = await this.extractPage(pageIndex);
            break;
          } catch (err) {
            const wait = this.config.timing.retryWaitMs[attempt - 1];
            logger.warn('Extract failed', { attempt, pageIndex, error: (err as Error).message });
            if (attempt < 3) {
              await sleep(wait); // wait in place — session cookie stays valid
            } else {
              await this.bootstrap(); // last resort reload
            }
          }
        }

        if (docs.length === 0) { logger.info('Empty page', { pageIndex }); break; }

        const toWrite = limit !== null ? docs.slice(0, limit - totalScraped) : docs;
        if (!dryRun && out) for (const d of toWrite) out.write(JSON.stringify(d) + '\n');
        else logger.info('[dry-run]', { pageIndex, count: toWrite.length });

        if (pdfDir && !dryRun) {
          for (const doc of toWrite) {
            if (doc.pdfUrl) doc.pdfLocalPath = await this.downloadPdf(doc, pdfDir);
          }
        }

        totalScraped += toWrite.length;
        fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ site: this.siteName, lastPageIndex: pageIndex, totalScraped, updatedAt: new Date().toISOString() }));
        logger.info('Progress', { page: pageIndex, total: totalScraped });

        const hasMore = await this.nextPage();
        if (!hasMore) break;
        pageIndex++;
      }
    } finally {
      out?.end();
    }

    if (!dryRun && totalScraped === 0) throw new Error('Zero records — scrape failed');
    logger.info('Browser scrape complete', { totalScraped, site: this.siteName });
  }

  async downloadPdf(doc: JudicialDocument, pdfDir: string): Promise<string | null> {
    if (!doc.pdfUrl || !this.browser) return null;
    const localPath = path.join(pdfDir, `${doc.id}.pdf`);
    if (fs.existsSync(localPath)) return localPath;

    const pdfPage = await this.browser.newPage();
    try {
      const resp = await pdfPage.goto(doc.pdfUrl, { waitUntil: 'networkidle2', timeout: 30_000 });
      if (!resp?.ok()) return null;
      const buffer = await resp.buffer();
      if (buffer.length < 200) return null;
      fs.writeFileSync(localPath, buffer);
      await jitter(...this.config.timing.pdfDelayMs);
      return localPath;
    } catch (err) {
      logger.error('PDF download failed', { url: doc.pdfUrl, error: (err as Error).message });
      return null;
    } finally {
      await pdfPage.close();
    }
  }
}
