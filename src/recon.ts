/**
 * recon.ts — Browser-based selector discovery for unknown JSF portals.
 *
 * Loads the portal in a headed browser and dumps:
 *  - All tables: selector, row count, column headers, sample row
 *  - Pagination elements with their IDs/classes
 *  - PDF link candidates (href, onclick, text)
 *  - All hidden inputs (javax.faces.ViewState, etc.)
 *  - Form action URLs
 *
 * Run FIRST before editing config.ts selectors.
 * Usage: node dist/recon.js --site oefa [--proxy http://host:port]
 * Output: ./output/recon_<site>.json
 */

import { createRequire } from 'module';
import type { Browser, Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { SITES } from './config.js';
import { logger } from './logger.js';

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const puppeteer: any = _require('puppeteer-extra');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const StealthPlugin: any = _require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

interface ReconOutput {
  url: string;
  title: string;
  tables: { selector: string; rowCount: number; headers: string[]; sampleRow: string[] }[];
  paginationElements: string[];
  pdfLinkCandidates: { text: string; href: string | null; onclick: string | null }[];
  hiddenInputs: { name: string; valueSnippet: string }[];
  formActions: string[];
  scrapedAt: string;
}

const recon = async (siteName: string, proxy?: string): Promise<void> => {
  const config = SITES[siteName];
  if (!config) throw new Error(`Unknown site: ${siteName}. Available: ${Object.keys(SITES).join(', ')}`);

  const args = ['--no-sandbox', '--lang=es-PE,es', '--disable-blink-features=AutomationControlled'];
  if (proxy) args.push(`--proxy-server=${proxy}`);

  const browser: Browser = await puppeteer.launch({
    headless: false,
    args,
    defaultViewport: { width: 1366, height: 768 },
  });

  const [page]: [Page] = await browser.pages() as [Page];
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8' });

  logger.info('Loading portal', { url: config.startUrl });
  await page.goto(config.startUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await new Promise(r => setTimeout(r, 5000)); // let PrimeFaces JS initialize

  const output: ReconOutput = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table')).map((t, i) => ({
      selector: `table:nth-of-type(${i + 1})`,
      rowCount: t.querySelectorAll('tbody tr').length,
      headers: Array.from(t.querySelectorAll('thead th, tr:first-child th'))
        .map(th => (th as HTMLElement).innerText.trim()),
      sampleRow: Array.from(t.querySelector('tbody tr')?.querySelectorAll('td') ?? [])
        .map(td => (td as HTMLElement).innerText.trim().slice(0, 80)),
    }));

    const paginationElements = Array.from(
      document.querySelectorAll('[class*="paginator"],[class*="pager"],[id*="paginator"],[id*="pager"]'),
    ).map(el => `${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].join('.')}`).slice(0, 10);

    const pdfLinkCandidates = Array.from(
      document.querySelectorAll('a,button,span[onclick]'),
    )
      .filter(el => {
        const t = (el as HTMLElement).innerText.toLowerCase();
        const h = (el as HTMLAnchorElement).href ?? '';
        const o = el.getAttribute('onclick') ?? '';
        return t.includes('pdf') || h.includes('.pdf') || o.toLowerCase().includes('pdf');
      })
      .slice(0, 20)
      .map(el => ({
        text: (el as HTMLElement).innerText.trim().slice(0, 60),
        href: (el as HTMLAnchorElement).href || null,
        onclick: el.getAttribute('onclick')?.slice(0, 100) ?? null,
      }));

    const hiddenInputs = Array.from(document.querySelectorAll('input[type="hidden"]'))
      .map(inp => ({
        name: (inp as HTMLInputElement).name,
        valueSnippet: (inp as HTMLInputElement).value.slice(0, 50) + '…',
      }));

    const formActions = Array.from(document.querySelectorAll('form[action]'))
      .map(f => (f as HTMLFormElement).action);

    return {
      url: location.href,
      title: document.title,
      tables,
      paginationElements,
      pdfLinkCandidates,
      hiddenInputs,
      formActions,
      scrapedAt: new Date().toISOString(),
    };
  });

  await browser.close();

  fs.mkdirSync('./output', { recursive: true });
  const outPath = path.join('./output', `recon_${siteName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log('\n=== RECON RESULTS ===');
  console.log('URL    :', output.url);
  console.log('Title  :', output.title);
  console.log('Tables :', output.tables.length);
  output.tables.forEach((t, i) =>
    console.log(`  [${i}] rows=${t.rowCount} | headers=[${t.headers.join(' | ')}]`),
  );
  console.log('Pagination elements:', output.paginationElements.slice(0, 3));
  console.log('PDF candidates     :', output.pdfLinkCandidates.length);
  console.log('Hidden inputs      :', output.hiddenInputs.map(h => h.name).join(', '));
  console.log('\nFull output →', outPath);
  console.log('\nCopy the correct selectors into src/config.ts and re-run the scraper.');
};

// Minimal CLI parsing for standalone execution
const siteName = process.argv.find(a => a.startsWith('--site='))?.split('=')[1]
  ?? (() => { const i = process.argv.indexOf('--site'); return i >= 0 ? process.argv[i + 1] : undefined; })()
  ?? 'oefa';
const proxyArg = process.argv.find(a => a.startsWith('--proxy='))?.split('=')[1]
  ?? (() => { const i = process.argv.indexOf('--proxy'); return i >= 0 ? process.argv[i + 1] : undefined; })();

recon(siteName, proxyArg).catch(e => { logger.error('Recon failed', { error: e.message }); process.exit(1); });
