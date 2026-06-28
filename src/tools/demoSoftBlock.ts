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
 * Structure must match what parseRichFacesRepeatRows expects:
 *   - `.rf-p-hdr span[style*="bold"]` → tipoRecurso + expediente cells
 *   - `.rf-p-b` with `.txtbold` sibling pairs → labeled field cells
 * Without these, every cell is empty and the row filter drops them all.
 */
const pageWithRows = (): string => `<!DOCTYPE html>
<html><body>
<form id="formBuscador" action="/" method="post">
  <input type="hidden" name="javax.faces.ViewState" value="${VIEWSTATE}">
  <div class="rf-p" id="formBuscador:repeat:0:j_idt455">
    <div class="rf-p-hdr">
      <span style="font-weight:bold">Apelación</span>
      <span style="font-weight:bold">00001-2024-0-5001-JR-PE-01</span>
    </div>
    <div class="rf-p-b">
      <div class="txtbold">Pretensión:</div><div>Demanda contenciosa administrativa</div>
      <div class="txtbold">Tipo Resolución:</div><div>Sentencia</div>
      <div class="txtbold">Fecha Resolución:</div><div>15/01/2024</div>
      <div class="txtbold">Sala:</div><div>Primera Sala Civil Permanente</div>
      <div class="txtbold">Sumilla:</div><div>Demo — soft-block simulation row 1</div>
    </div>
  </div>
  <div class="rf-p" id="formBuscador:repeat:1:j_idt455">
    <div class="rf-p-hdr">
      <span style="font-weight:bold">Casación</span>
      <span style="font-weight:bold">00002-2024-0-5001-JR-CI-02</span>
    </div>
    <div class="rf-p-b">
      <div class="txtbold">Pretensión:</div><div>Nulidad de acto jurídico</div>
      <div class="txtbold">Tipo Resolución:</div><div>Auto</div>
      <div class="txtbold">Fecha Resolución:</div><div>20/02/2024</div>
      <div class="txtbold">Sala:</div><div>Segunda Sala Civil Permanente</div>
      <div class="txtbold">Sumilla:</div><div>Demo — soft-block simulation row 2</div>
    </div>
  </div>
  <a class="rf-ds-btn-next">&#x203A;</a>
</form>
</body></html>`;

/**
 * JSF partial-response XML for all page-advance POSTs: zero `div.rf-p` panels
 * but the RichFaces next button is present in the CDATA fragment.
 *
 * @remarks
 * Page-advance requests are JSF partial AJAX POSTs, not full GETs. The scraper's
 * `extractPartialResponse` extracts the longest CDATA block containing a block-level
 * element (`<div>` qualifies) and uses that as the HTML fragment. A second `<update>`
 * carries the refreshed ViewState token. Without this format, `requirePartialHtml`
 * throws and the retry loop treats the failure as end-of-results instead of a
 * soft block.
 */
const partialResponseWithoutRows = (): string => {
  const fragment = `<div id="formBuscador:panel"><a class="rf-ds-btn-next">&#x203A;</a></div>`;
  return (
    `<?xml version='1.0' encoding='UTF-8'?>` +
    `<partial-response><changes>` +
    `<update id="formBuscador:panel"><![CDATA[${fragment}]]></update>` +
    `<update id="javax.faces.ViewState"><![CDATA[${VIEWSTATE}]]></update>` +
    `</changes></partial-response>`
  );
};

// ── Local demo server ─────────────────────────────────────────────────────────

/**
 * Creates a local HTTP server that mimics the two response types the scraper
 * encounters in production:
 * - GET → full HTML page with 2 result rows (the bootstrap response)
 * - POST → JSF partial-response XML with 0 rows + next-button present (soft block)
 *
 * @remarks
 * Distinguishing by HTTP method mirrors real portal behaviour: the initial page
 * load is a GET, and every subsequent page-advance is a JSF partial AJAX POST.
 */
const createDemoServer = (): http.Server =>
  http.createServer((req, res) => {
    const isPost = req.method === 'POST';
    res.writeHead(200, {
      'Content-Type': isPost ? 'text/xml; charset=utf-8' : 'text/html; charset=utf-8',
      'Set-Cookie': 'JSESSIONID=demo-session-abc; Path=/',
    });
    res.end(isPost ? partialResponseWithoutRows() : pageWithRows());
  });

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

const buildDemoOpts = (_baseUrl: string): ScrapeOptions => ({
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
