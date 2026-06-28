/**
 * Rate-limit probe for OEFA (and any JSF portal).
 *
 * Sends a configurable number of concurrent requests and records how many
 * trigger HTTP 429. Use this to find the concurrency threshold before the
 * portal starts blocking, so you can tune PDF_CONCURRENCY and pdfDelayMs.
 *
 * Run via: npm run probe:oefa:429
 *
 * Configure with env vars (see .env.example for descriptions and defaults):
 *   PROBE_429_URL, PROBE_429_TOTAL, PROBE_429_CONCURRENCY,
 *   PROBE_429_STOP_ON_FIRST, PROBE_429_OUT, PROBE_429_MODE
 *
 * Exit codes:
 *   0 — at least one 429 detected (rate limiting confirmed)
 *   2 — no 429 seen (either portal has no limit or total/concurrency were too low)
 */
import axios from 'axios';
import { load as cheerioLoad } from 'cheerio';
import fs from 'fs';
import path from 'path';

interface ProbeResult {
  url: string;
  mode: string;
  totalPlanned: number;
  concurrency: number;
  totalSent: number;
  statusCounts: Record<string, number>;
  total429: number;
  retryAfterValues: string[];
  first429AtRequest: number | null;
  elapsedMs: number;
}

// All config is optional — sensible defaults let the probe run without any setup.
const url           = process.env.PROBE_429_URL          ?? 'https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml';
const totalPlanned  = Number(process.env.PROBE_429_TOTAL ?? 500);
const concurrency   = Math.max(1, Number(process.env.PROBE_429_CONCURRENCY ?? 20));
const stopOnFirst429 = process.env.PROBE_429_STOP_ON_FIRST !== 'false';
const outputPath    = process.env.PROBE_429_OUT           ?? 'output/test429/probe429.json';
const mode          = process.env.PROBE_429_MODE          ?? 'search';

const client = axios.create({
  timeout: 20_000,
  maxRedirects: 5,
  validateStatus: () => true,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
  },
});

const encodeForm = (params: [string, string][]): string =>
  params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

const cookieHeader = (setCookieHeader: string[] | undefined): string =>
  (setCookieHeader ?? []).map(raw => raw.split(';')[0]).join('; ');

const result: ProbeResult = {
  url,
  mode,
  totalPlanned,
  concurrency,
  totalSent: 0,
  statusCounts: {},
  total429: 0,
  retryAfterValues: [],
  first429AtRequest: null,
  elapsedMs: 0,
};

const requestOnce = async (): Promise<void> => {
  const requestNumber = ++result.totalSent;
  try {
    const resp = mode === 'search'
      ? await requestSearch()
      : await client.get(url);
    const status = String(resp.status);
    result.statusCounts[status] = (result.statusCounts[status] ?? 0) + 1;
    if (resp.status === 429) {
      result.total429++;
      if (result.first429AtRequest === null) result.first429AtRequest = requestNumber;
      const retryAfter = resp.headers['retry-after'];
      if (retryAfter) result.retryAfterValues.push(Array.isArray(retryAfter) ? retryAfter.join(',') : String(retryAfter));
    }
  } catch (err) {
    const key = `error:${(err as Error).message}`;
    result.statusCounts[key] = (result.statusCounts[key] ?? 0) + 1;
  }
};

async function requestSearch() {
  const start = await client.get<string>(url);
  if (start.status === 429) return start;

  const $ = cheerioLoad(start.data);
  const viewState = $('input[name="javax.faces.ViewState"]').first().val();
  if (!viewState) return start;

  const cookie = cookieHeader(start.headers['set-cookie'] as string[] | undefined);
  const body = encodeForm([
    ['listarDetalleInfraccionRAAForm', 'listarDetalleInfraccionRAAForm'],
    ['listarDetalleInfraccionRAAForm:txtNroexp', ''],
    ['listarDetalleInfraccionRAAForm:j_idt21', ''],
    ['listarDetalleInfraccionRAAForm:j_idt25', ''],
    ['listarDetalleInfraccionRAAForm:idsector', '1'],
    ['listarDetalleInfraccionRAAForm:btnBuscar', 'Buscar'],
    ['javax.faces.ViewState', String(viewState)],
  ]);

  return client.post(url, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Referer': url,
      'Cookie': cookie,
    },
  });
}

console.log(`\n[probe:oefa:429] Starting rate-limit probe`);
console.log(`  URL:         ${url}`);
console.log(`  Mode:        ${mode} (${mode === 'search' ? 'POST JSF search form — realistic' : 'GET only — lightweight'})`);
console.log(`  Total:       ${totalPlanned} requests at concurrency ${concurrency}`);
console.log(`  Stop early:  ${stopOnFirst429 ? 'yes (first 429)' : 'no (collect all)'}`);
console.log('');

const startedAt = Date.now();

while (result.totalSent < totalPlanned) {
  const remaining = totalPlanned - result.totalSent;
  const batchSize = Math.min(concurrency, remaining);
  await Promise.all(Array.from({ length: batchSize }, () => requestOnce()));

  // Human-readable progress line per batch.
  const pct = Math.round((result.totalSent / totalPlanned) * 100);
  const statusSummary = Object.entries(result.statusCounts)
    .map(([s, n]) => `${s}×${n}`)
    .join(' ');
  const first429Note = result.first429AtRequest != null ? `  ← first 429 at request #${result.first429AtRequest}` : '';
  console.log(`  [${result.totalSent}/${totalPlanned} ${pct}%] 429s=${result.total429}  ${statusSummary}${first429Note}`);

  if (stopOnFirst429 && result.total429 > 0) break;
}

result.elapsedMs = Date.now() - startedAt;

// ── Verdict ────────────────────────────────────────────────────────────────────
console.log('');
if (result.total429 > 0) {
  console.log(`[PASS] Rate limit confirmed: ${result.total429} out of ${result.totalSent} requests triggered 429`);
  console.log(`       First 429 at request #${result.first429AtRequest} (concurrency=${concurrency})`);
  if (result.retryAfterValues.length > 0) {
    console.log(`       Retry-After values seen: ${result.retryAfterValues.join(', ')} s`);
  }
} else {
  console.log(`[WARN] No 429 detected after ${result.totalSent} requests at concurrency=${concurrency}`);
  console.log(`       Either the portal has no rate limit, or try a higher PROBE_429_TOTAL / PROBE_429_CONCURRENCY`);
}
console.log(`       Elapsed: ${Math.round(result.elapsedMs / 1000)}s  |  report → ${outputPath}\n`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

if (result.total429 === 0) {
  process.exitCode = 2;
}
