/**
 * Offline demonstration of the soft-block detection pipeline.
 *
 * @remarks
 * Spins up a local HTTP server that mimics a portal returning HTTP 200 with
 * zero result rows while the paginator still signals more pages — the "soft
 * block" pattern used by PJ Peru and OEFA when silently rate-limiting a session
 * instead of returning a proper 429.
 *
 * Expected sequence:
 *   Bootstrap GET → page 0 (2 real rows, processed normally)
 *   → page 1 (0 rows + hasNextPage=true) → soft_block_WARNING  [1/3]
 *   → page 2 (0 rows + hasNextPage=true) → soft_block_WARNING  [2/3]
 *   → page 3 (0 rows + hasNextPage=true) → soft_block_ABORT    [3/3]
 *
 * No VPN required. All traffic stays on 127.0.0.1.
 * Run via: npm run demo:soft-block
 */

import http from 'http';
import { makeSession } from '../session/session.js';
import { scrapeSector } from '../scraper/sectorScraper.js';
import { createRunMetrics } from '../models/metrics.js';
import type { ScrapeOptions, SiteConfig } from '../types.js';
import type { SectorContext } from '../models/scraperTypes.js';

// ── Fake HTML pages ───────────────────────────────────────────────────────────

const VIEWSTATE = 'demo-viewstate-token-abc123';

/**
 * First response: two `div.rf-p` panels so page 0 has real rows.
 * The "next" button keeps hasNextPage=true, pushing the scraper into page 1.
 */
const pageWithRows = (): string => `<!DOCTYPE html>
<html><body>
<form id="formBuscador" action="/" method="post">
  <input type="hidden" name="javax.faces.ViewState" value="${VIEWSTATE}">
  <div class="rf-p" id="formBuscador:repeat:0:j_idt455">
    <div class="rf-p-hdr">EXP-001-2024-DEMO</div>
    <div class="rf-p-b">Demo judicial document 1</div>
  </div>
  <div class="rf-p" id="formBuscador:repeat:1:j_idt455">
    <div class="rf-p-hdr">EXP-002-2024-DEMO</div>
    <div class="rf-p-b">Demo judicial document 2</div>
  </div>
  <a class="rf-ds-btn-next">&#x203A;</a>
</form>
</body></html>`;

/**
 * All subsequent responses: zero `div.rf-p` panels but the "next" button
 * is still present — this is the exact soft-block signature that triggers
 * the detection logic in handleSoftBlock.
 */
const pageWithoutRows = (): string => `<!DOCTYPE html>
<html><body>
<form id="formBuscador" action="/" method="post">
  <input type="hidden" name="javax.faces.ViewState" value="${VIEWSTATE}">
  <!-- zero div.rf-p panels: parseRows returns [] -->
  <!-- a.rf-ds-btn-next present: pageHasNext returns true -->
  <a class="rf-ds-btn-next">&#x203A;</a>
</form>
</body></html>`;

// ── Local demo server ─────────────────────────────────────────────────────────

/**
 * Creates a one-shot HTTP server that serves `pageWithRows` for the first
 * request and `pageWithoutRows` for every subsequent request.
 */
const createDemoServer = (): http.Server => {
  let requestCount = 0;
  return http.createServer((_req, res) => {
    requestCount++;
    const html = requestCount === 1 ? pageWithRows() : pageWithoutRows();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': 'JSESSIONID=demo-session-abc; Path=/',
    });
    res.end(html);
  });
};

// ── Demo config & context ─────────────────────────────────────────────────────

/** Minimal SiteConfig pointing to the local demo server. */
const buildDemoConfig = (baseUrl: string): SiteConfig => ({
  name: 'Demo — soft-block simulation',
  baseUrl,
  startUrl: `${baseUrl}/`,
  rowParser: 'richfacesRepeat',
  columns: { caseNumber: 0 },
  selectors: {
    rows: '.rf-p',
    cells: '.rf-p-hdr',
    caseNumber: '.rf-p-hdr',
    court: '.rf-p-b',
    date: '.rf-p-b',
    summary: '.rf-p-b',
    pdfLink: 'a[href$=".pdf"]',
    nextButton: 'a.rf-ds-btn-next',
    currentPage: null,
    totalPages: null,
    noResults: null,
  },
  timing: {
    pageDelayMs: [0, 0],      // no jitter — keep the demo fast
    pdfDelayMs: [0, 0],
    retryWaitMs: [50, 100, 200],
    navigationTimeoutMs: 5_000,
    selectorTimeoutMs: 5_000,
  },
});

const buildDemoOpts = (baseUrl: string): ScrapeOptions => ({
  site: 'demo',
  outputPath: './output/demo-soft-block.jsonl',
  pdfDir: null,
  limit: null,
  dryRun: true,   // no files written to disk
  proxy: null,
  headed: false,
  profile: null,
  resume: false,
  sectorId: 'DEMO',
});

const buildDemoCtx = (): SectorContext => ({
  sectorId: 'DEMO',
  sectorName: 'Soft-Block Demo',
  metrics: createRunMetrics(),
  failedPdfs: [],
  pageEvents: [],
  runLimit: null,
});

// ── Entry point ───────────────────────────────────────────────────────────────

const server = createDemoServer();
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address() as { port: number };
const baseUrl = `http://127.0.0.1:${port}`;

console.log('\n══════════════════════════════════════════════════');
console.log('  SOFT-BLOCK DEMO  ·  pj-peru-scraper');
console.log('══════════════════════════════════════════════════');
console.log(`  Server  : ${baseUrl}  (127.0.0.1 only)`);
console.log('  Page 0  : 2 result rows  →  processed normally');
console.log('  Page 1  : 0 rows + hasNextPage=true  →  WARNING [1/3]');
console.log('  Page 2  : 0 rows + hasNextPage=true  →  WARNING [2/3]');
console.log('  Page 3  : 0 rows + hasNextPage=true  →  ABORT   [3/3]');
console.log('══════════════════════════════════════════════════\n');

const session = makeSession(baseUrl);
const config  = buildDemoConfig(baseUrl);
const opts    = buildDemoOpts(baseUrl);
const ctx     = buildDemoCtx();

try {
  const result = await scrapeSector(session, config, opts, ctx);

  console.log('\n══════════════════════════════════════════════════');
  console.log('  DEMO COMPLETE');
  console.log(`  Docs collected (page 0 only) : ${result.count}`);
  console.log(`  Page events emitted          : ${ctx.pageEvents.length}`);
  for (const e of ctx.pageEvents) {
    const label = e.type === 'pageScraped'
      ? '✓ scraped  '
      : e.type === 'soft_block_warning'
        ? '⚠ warning  '
        : '✖ ABORT    ';
    console.log(`    ${label} page ${e.pageLabel}  docs=${e.docsThisPage}`);
  }
  console.log('══════════════════════════════════════════════════\n');
} finally {
  server.close();
}
