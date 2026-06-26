/**
 * http-scraper.ts — Pure HTTP scraper for JSF/PrimeFaces judicial portals.
 *
 * NO browser automation. All requests use axios with manual cookie handling.
 * HTML parsed with cheerio. JSF ViewState replayed across POST requests.
 *
 * JSF pagination pattern:
 *   1. GET start page → extract javax.faces.ViewState + table data
 *   2. POST search form with ViewState + sector filter → first page of results
 *   3. POST same URL with ViewState + PrimeFaces paginator params → next pages
 *   4. Parse partial-response XML → extract updated table HTML
 *   5. Repeat until last page or limit reached
 *
 * 429 handling:
 *   - withRetry() detects HTTP 429 and reads Retry-After header
 *   - Waits max(Retry-After, configured base wait) before each retry
 *   - 3 attempts total; exponential base waits in config.timing.retryWaitMs
 *
 * Sector iteration (OEFA):
 *   - discoverSectors() parses the sector <select> from the live page
 *   - scrapeAll() loops each sector with a fresh session, merging to one JSONL
 *   - Per-sector checkpoints allow resuming a specific sector after crash
 */

import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { load as cheerioLoad } from 'cheerio';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { SITES } from './config.js';
import type { Checkpoint, JudicialDocument, SiteConfig, ScrapeOptions } from './types.js';

// ──────────────────────────────────────────────────────────────────────────────
// Internal types
// ──────────────────────────────────────────────────────────────────────────────

type $Root = ReturnType<typeof cheerioLoad>;

interface Session {
  client: AxiosInstance;
  cookies: Map<string, string>;
  baseUrl: string;
}

interface ParsedPage {
  viewState: string;
  formId: string;
  rows: ParsedRow[];
  hasNextPage: boolean;
  currentPage: number;
  totalPages: number | null;
  totalRecords: number | null;
  paginatorId: string | null;
}

interface ParsedRow {
  cells: string[];
  pdfUrl: string | null;
  pdfJsfAction: { componentId: string; paramUuid: string } | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Session — manual cookie jar
// ──────────────────────────────────────────────────────────────────────────────

const makeSession = (baseUrl: string, proxy?: string | null): Session => ({
  client: axios.create({
    baseURL: baseUrl,
    timeout: 30_000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    },
    ...(proxy ? { proxy: parseProxy(proxy) } : {}),
  }),
  cookies: new Map(),
  baseUrl,
});

const parseProxy = (url: string) => {
  const u = new URL(url);
  return {
    protocol: u.protocol.replace(':', '') as 'http' | 'https',
    host: u.hostname,
    port: parseInt(u.port, 10),
    auth: u.username ? { username: u.username, password: u.password } : undefined,
  };
};

const absorbCookies = (session: Session, setCookieHeader: string[] | string | undefined): void => {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader
    : setCookieHeader ? [setCookieHeader] : [];
  for (const raw of headers) {
    const [nameVal] = raw.split(';');
    const eqIdx = nameVal.indexOf('=');
    if (eqIdx > 0) {
      session.cookies.set(nameVal.slice(0, eqIdx).trim(), nameVal.slice(eqIdx + 1).trim());
    }
  }
};

const cookieHeader = (session: Session): string =>
  [...session.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

// ──────────────────────────────────────────────────────────────────────────────
// HTML parsing — pure functions
// ──────────────────────────────────────────────────────────────────────────────

const extractViewState = ($: $Root): string => {
  const vs = $('input[name="javax.faces.ViewState"]').first().val();
  if (!vs) throw new Error('javax.faces.ViewState not found — page may require JS rendering');
  return String(vs);
};

const extractFormId = ($: $Root): string =>
  $('form').first().attr('id') ?? 'form';

const extractPaginatorId = ($: $Root): string | null =>
  $('[id*="paginator"], [id*="pager"], .ui-paginator').first().attr('id') ?? null;

const parsePaginatorText = ($: $Root): { currentPage: number; totalPages: number; totalRecords: number } | null => {
  const text = $('.ui-paginator-current').first().text().trim();
  const m = text.match(/P[aá]gina\s+(\d+)\s+de\s+(\d+)\s*\((\d+)\s+registros?\)/i);
  if (!m) return null;
  return { currentPage: parseInt(m[1], 10), totalPages: parseInt(m[2], 10), totalRecords: parseInt(m[3], 10) };
};

const pageHasNext = ($: $Root): boolean => {
  const info = parsePaginatorText($);
  if (info) return info.currentPage < info.totalPages;
  const btn = $('a.ui-paginator-next, [id*="next"]:not([disabled])').first();
  if (!btn.length) return false;
  return !btn.hasClass('ui-state-disabled') && btn.attr('aria-disabled') !== 'true';
};

const currentPageNum = ($: $Root): number => {
  const info = parsePaginatorText($);
  if (info) return info.currentPage;
  const text = $('.ui-paginator-page.ui-state-active, .paginacion-actual').first().text().trim();
  return text ? (parseInt(text, 10) || 0) : 0;
};

const parseJsfActionLink = (onclick: string | undefined): { componentId: string; paramUuid: string } | null => {
  if (!onclick || !onclick.includes('mojarra.jsfcljs')) return null;
  const m = onclick.match(/mojarra\.jsfcljs\s*\([^,]+,\s*\{([^}]+)\}/);
  if (!m) return null;
  const pairs = [...m[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)];
  const map: Record<string, string> = {};
  for (const [, k, v] of pairs) map[k] = v;
  const paramUuid = map['param_uuid'];
  if (!paramUuid) return null;
  const componentId = Object.entries(map).find(([k, v]) => k === v)?.[0] ?? '';
  return { componentId, paramUuid };
};

const parseRows = ($: $Root, config: SiteConfig, baseUrl: string): ParsedRow[] =>
  $(config.selectors.rows)
    .toArray()
    .map(tr => {
      const cells = $(tr).find('td').toArray().map(td => $(td).text().trim());
      const pdfEl = $(tr).find(config.selectors.pdfLink).first();
      const rawHref = pdfEl.attr('href') ?? null;
      const isAnchorOrVoid = !rawHref || rawHref === '#' || rawHref.startsWith('javascript');
      const pdfUrl = isAnchorOrVoid
        ? null
        : rawHref.startsWith('http')
          ? rawHref
          : `${baseUrl}/${rawHref.replace(/^\//, '')}`;
      const pdfJsfAction = isAnchorOrVoid ? parseJsfActionLink(pdfEl.attr('onclick')) : null;
      return { cells, pdfUrl, pdfJsfAction } satisfies ParsedRow;
    })
    .filter(row => row.cells.some(c => c.length > 0));

const parsePage = ($: $Root, config: SiteConfig, baseUrl: string): ParsedPage => {
  const pag = parsePaginatorText($);
  return {
    viewState: extractViewState($),
    formId: extractFormId($),
    rows: parseRows($, config, baseUrl),
    hasNextPage: pageHasNext($),
    currentPage: pag?.currentPage ?? currentPageNum($),
    totalPages: pag?.totalPages ?? null,
    totalRecords: pag?.totalRecords ?? null,
    paginatorId: extractPaginatorId($),
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// Document transformation — pure functions
// ──────────────────────────────────────────────────────────────────────────────

const normDate = (raw: string): string => {
  const m = raw.trim().match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : raw.trim();
};

const buildId = (site: string, caseNum: string, date: string, sectorId: string | null): string => {
  const clean = (s: string) => s.replace(/[^A-Z0-9]/gi, '_').toUpperCase().slice(0, 40);
  const sectorPart = sectorId ? `_S${sectorId}` : '';
  return `${site}${sectorPart}_${clean(caseNum)}_${clean(date)}`;
};

const rowToDocument =
  (site: string, pageIndex: number, columns: SiteConfig['columns'], sectorId: string | null, sectorName: string | null) =>
  (row: ParsedRow, rowIndex: number): JudicialDocument => {
    const c = (idx: number | undefined) => (idx !== undefined ? row.cells[idx] ?? '' : '');
    const caseNumber = c(columns.caseNumber);
    const date = c(columns.date);
    return {
      id: buildId(site, caseNumber, date, sectorId),
      site,
      sector: sectorName,
      caseNumber,
      court: c(columns.court) || null,
      date: date ? normDate(date) : null,
      summary: c(columns.summary) || null,
      resolution: c(columns.resolution) || null,
      pdfUrl: row.pdfUrl,
      pdfLocalPath: null,
      pageIndex,
      rowIndex,
      fetchedAt: new Date().toISOString(),
      rawCells: row.cells,
    } satisfies JudicialDocument;
  };

// ──────────────────────────────────────────────────────────────────────────────
// Rate limit / 429 detection
// ──────────────────────────────────────────────────────────────────────────────

const RATE_LIMIT_SIGNALS = [
  'demasiadas solicitudes', 'too many requests', 'acceso denegado',
  'access denied', 'rate limit', 'por favor espere', 'please wait',
];

const isRateLimited = (html: string): boolean =>
  RATE_LIMIT_SIGNALS.some(s => html.toLowerCase().includes(s));

/**
 * Returns the number of ms to wait if this is a 429 error, 0 otherwise.
 * Reads Retry-After header (seconds or HTTP-date format).
 */
const extract429WaitMs = (err: unknown): number => {
  const axiosErr = err as { response?: { status?: number; headers?: Record<string, string | string[]> } };
  if (axiosErr?.response?.status !== 429) return 0;
  const ra = axiosErr.response?.headers?.['retry-after'];
  if (!ra) return 60_000;
  const val = Array.isArray(ra) ? ra[0] : ra;
  const seconds = Number(val);
  if (!isNaN(seconds)) return seconds * 1_000;
  const httpDate = new Date(val);
  if (!isNaN(httpDate.getTime())) return Math.max(0, httpDate.getTime() - Date.now());
  return 60_000;
};

// ──────────────────────────────────────────────────────────────────────────────
// HTTP utilities
// ──────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

const jitter = (min: number, max: number): Promise<void> =>
  sleep(min + Math.floor(Math.random() * (max - min)));

/**
 * Retries fn up to 3 times.
 * On HTTP 429: waits max(Retry-After, configured base wait).
 * On other errors: waits configured base wait.
 */
const withRetry = async <T>(
  fn: () => Promise<T>,
  waits: [number, number, number],
  label: string,
): Promise<T> => {
  let lastErr: Error = new Error('No attempts made');
  for (let i = 0; i < 3; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err as Error;
      const waitFrom429 = extract429WaitMs(err);
      const is429 = waitFrom429 > 0;
      const waitMs = is429 ? Math.max(waitFrom429, waits[i]) : waits[i];
      logger.warn(is429 ? '429 rate limit — backing off' : 'Request failed, retrying', {
        attempt: i + 1, of: 3, label, waitMs, error: lastErr.message,
      });
      await sleep(waitMs);
    }
  }
  throw lastErr;
};

const fetchStartPage = async (session: Session, url: string): Promise<$Root> => {
  logger.info('GET start page', { url });
  const resp: AxiosResponse<string> = await session.client.get(url, {
    headers: { Referer: session.baseUrl, Cookie: cookieHeader(session) },
  });
  absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
  if (isRateLimited(resp.data)) throw new Error('Rate limited on initial GET');
  return cheerioLoad(resp.data);
};

// ──────────────────────────────────────────────────────────────────────────────
// Sector discovery
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the start page and parses all <option> values from the sector <select>.
 * Returns Record<sectorId, sectorName>. Falls back to config.search.sectors if empty.
 */
export const discoverSectors = async (site: string, proxy?: string | null): Promise<Record<string, string>> => {
  const config = SITES[site];
  if (!config.search?.sectorField) return {};

  const session = makeSession(config.baseUrl, proxy ?? undefined);
  const $ = await fetchStartPage(session, config.startUrl);

  const fieldId = config.search.sectorField;
  const fieldBase = fieldId.split(':').pop()!;

  const sectors: Record<string, string> = {};
  $(`select[id="${fieldId}"] option, select[id*="${fieldBase}"] option, select[name*="${fieldBase}"] option`)
    .each((_, el) => {
      const val = $(el).attr('value')?.trim() ?? '';
      const label = $(el).text().trim();
      if (val && label && !label.startsWith('-') && !label.startsWith('--')) {
        sectors[val] = label.toUpperCase();
      }
    });

  if (Object.keys(sectors).length > 0) {
    logger.info('Sectors discovered from live page', { site, sectors });
  } else {
    logger.warn('Sector discovery returned empty — falling back to config.sectors', { site });
    return config.search.sectors ?? {};
  }

  return sectors;
};

// ──────────────────────────────────────────────────────────────────────────────
// PrimeFaces search submit + pagination
// ──────────────────────────────────────────────────────────────────────────────

const buildPaginationBody = (page: ParsedPage, targetPageIndex: number, rowsPerPage: number): string => {
  const paginatorId = page.paginatorId ?? `${page.formId}:j_idt_paginator`;
  const params: [string, string][] = [
    ['javax.faces.partial.ajax', 'true'],
    ['javax.faces.source', paginatorId],
    ['javax.faces.partial.execute', paginatorId],
    ['javax.faces.partial.render', page.formId],
    ['javax.faces.behavior.event', 'page'],
    [`${paginatorId}_pagination`, 'true'],
    [`${paginatorId}_first`, String(targetPageIndex * rowsPerPage)],
    [`${paginatorId}_rows`, String(rowsPerPage)],
    [`${paginatorId}_page`, String(targetPageIndex)],
    [page.formId, page.formId],
    ['javax.faces.ViewState', page.viewState],
  ];
  return params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
};

const extractPartialResponse = (xml: string): { html: string | null; newViewState: string | null } => {
  const vsMatch = xml.match(/<update[^>]+id="javax\.faces\.ViewState[^"]*"[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/update>/);
  const newViewState = vsMatch ? vsMatch[1].trim() : null;
  const allCdata = [...xml.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)]
    .map(m => m[1])
    .filter(s => s.trim().length > 100);
  const html = allCdata.sort((a, b) => b.length - a.length)[0] ?? null;
  return { html, newViewState };
};

const submitSearch = async (
  session: Session,
  url: string,
  page: ParsedPage,
  config: SiteConfig,
  sectorId?: string | null,
): Promise<ParsedPage> => {
  if (!config.search) return page;

  const { buttonId, buttonValue, formId, fields, ajax, sectorField } = config.search;
  logger.info('Submitting search form', { buttonId, ajax, sectorId: sectorId ?? 'none' });

  let params: [string, string][];
  let extraHeaders: Record<string, string>;

  if (ajax) {
    params = [
      ['javax.faces.partial.ajax', 'true'],
      ['javax.faces.source', buttonId],
      ['javax.faces.partial.execute', formId],
      ['javax.faces.partial.render', formId],
      [formId, formId],
      ...Object.entries(fields),
    ];
    if (sectorId && sectorField) params.push([sectorField, sectorId]);
    params.push(['javax.faces.ViewState', page.viewState]);
    extraHeaders = { 'Faces-Request': 'partial/ajax', 'X-Requested-With': 'XMLHttpRequest' };
  } else {
    params = [
      [formId, formId],
      ...Object.entries(fields),
    ];
    if (sectorId && sectorField) params.push([sectorField, sectorId]);
    params.push([buttonId, buttonValue], ['javax.faces.ViewState', page.viewState]);
    extraHeaders = {};
  }

  const body = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const resp: AxiosResponse<string> = await session.client.post(url, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Referer': url,
      'Cookie': cookieHeader(session),
      ...extraHeaders,
    },
  });

  absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
  if (isRateLimited(resp.data)) throw new Error('Rate limited on search submit');

  if (ajax) {
    const { html, newViewState } = extractPartialResponse(resp.data);
    const $p = cheerioLoad(html ?? '<div></div>');
    const pag = parsePaginatorText($p);
    return {
      ...page,
      viewState: newViewState ?? page.viewState,
      rows: parseRows($p, config, config.baseUrl),
      hasNextPage: pageHasNext($p),
      currentPage: pag?.currentPage ?? currentPageNum($p),
      totalPages: pag?.totalPages ?? page.totalPages,
      totalRecords: pag?.totalRecords ?? page.totalRecords,
    };
  }

  const $full = cheerioLoad(resp.data);
  return parsePage($full, config, config.baseUrl);
};

const fetchNextPage = async (
  session: Session,
  url: string,
  page: ParsedPage,
  targetPageIndex: number,
  rowsPerPage: number,
): Promise<{ $: $Root; newViewState: string | null }> => {
  const body = buildPaginationBody(page, targetPageIndex, rowsPerPage);

  const resp: AxiosResponse<string> = await session.client.post(url, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': url,
      'Cookie': cookieHeader(session),
    },
  });

  absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
  if (isRateLimited(resp.data)) throw new Error(`Rate limited at page ${targetPageIndex}`);

  const { html, newViewState } = extractPartialResponse(resp.data);
  if (!html) {
    logger.warn('Partial response empty — falling back to full GET', { targetPage: targetPageIndex });
    return { $: await fetchStartPage(session, url), newViewState: null };
  }
  return { $: cheerioLoad(html), newViewState };
};

// ──────────────────────────────────────────────────────────────────────────────
// PDF download
// ──────────────────────────────────────────────────────────────────────────────

const downloadPdf = async (session: Session, doc: JudicialDocument, pdfDir: string): Promise<string | null> => {
  if (!doc.pdfUrl) return null;
  const localPath = path.join(pdfDir, `${doc.id}.pdf`);
  if (fs.existsSync(localPath)) return localPath;

  try {
    const resp = await session.client.get<ArrayBuffer>(doc.pdfUrl, {
      responseType: 'arraybuffer',
      headers: { Referer: session.baseUrl, Accept: 'application/pdf,*/*', Cookie: cookieHeader(session) },
    });
    const buf = Buffer.from(resp.data);
    if (buf.length < 500) {
      logger.warn('PDF suspiciously small — skipping', { url: doc.pdfUrl, bytes: buf.length });
      return null;
    }
    fs.writeFileSync(localPath, buf);
    logger.info('PDF saved', { file: path.basename(localPath), bytes: buf.length });
    return localPath;
  } catch (err) {
    logger.error('PDF download error', { url: doc.pdfUrl, error: (err as Error).message });
    return null;
  }
};

const downloadJsfActionPdf = async (
  session: Session,
  config: SiteConfig,
  viewState: string,
  mojarra: { componentId: string; paramUuid: string },
  doc: JudicialDocument,
  pdfDir: string,
): Promise<string | null> => {
  const localPath = path.join(pdfDir, `${doc.id}.pdf`);
  if (fs.existsSync(localPath)) return localPath;

  const formId = config.search?.formId ?? 'form';
  const params: [string, string][] = [
    [formId, formId],
    ...(mojarra.componentId ? [[mojarra.componentId, mojarra.componentId] as [string, string]] : []),
    ['param_uuid', mojarra.paramUuid],
    ['javax.faces.ViewState', viewState],
  ];
  const body = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  try {
    const resp = await session.client.post<ArrayBuffer>(config.startUrl, body, {
      responseType: 'arraybuffer',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer': config.startUrl,
        'Cookie': cookieHeader(session),
        'Accept': 'application/pdf,application/octet-stream,*/*',
      },
    });
    absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
    const buf = Buffer.from(resp.data);
    if (buf.length < 500) {
      logger.warn('JSF action response too small — likely an error page', { paramUuid: mojarra.paramUuid, bytes: buf.length });
      return null;
    }
    if (buf.slice(0, 4).toString('ascii') !== '%PDF') {
      logger.warn('JSF action response is not a PDF — server returned HTML or redirect', { paramUuid: mojarra.paramUuid, magic: buf.slice(0, 4).toString('ascii') });
      return null;
    }
    fs.writeFileSync(localPath, buf);
    logger.info('PDF saved via JSF action POST', { file: path.basename(localPath), kb: Math.round(buf.length / 1024), via: 'jsf-action-post' });
    return localPath;
  } catch (err) {
    logger.error('JSF action PDF download failed', { paramUuid: mojarra.paramUuid, error: (err as Error).message });
    return null;
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────────────────────────────────────

const validateOutput = (outputPath: string, total: number, dryRun: boolean): void => {
  if (dryRun) { logger.info('[dry-run] Skipping output validation'); return; }
  if (total === 0) throw new Error('VALIDATION FAILED: zero records scraped');

  const lines = fs.readFileSync(outputPath, 'utf8').trim().split('\n');
  const samples = lines.slice(0, 10).map(l => JSON.parse(l) as JudicialDocument);

  const required: (keyof JudicialDocument)[] = ['id', 'site', 'caseNumber', 'fetchedAt'];
  for (const f of required) {
    const nullCount = samples.filter(s => !s[f]).length;
    if (nullCount) logger.warn(`Field '${f}' null in ${nullCount}/10 samples`);
  }

  const ids = samples.map(s => s.id);
  const dupes = ids.length - new Set(ids).size;
  if (dupes) logger.warn(`${dupes} duplicate IDs in sample`);

  logger.info(`✓ Validation passed — total: ${total} | sample: ${samples.length} | schema OK`);
};

// ──────────────────────────────────────────────────────────────────────────────
// Checkpointing — per sector
// ──────────────────────────────────────────────────────────────────────────────

const cpPath = (site: string, sectorId: string | null): string =>
  path.join('./output', sectorId ? `checkpoint_${site}_s${sectorId}.json` : `checkpoint_${site}.json`);

const loadCheckpoint = (site: string, sectorId: string | null): { startPage: number; completed: boolean } => {
  try {
    const cp = JSON.parse(fs.readFileSync(cpPath(site, sectorId), 'utf8')) as Checkpoint;
    if (cp.completed) { logger.info('Sector already completed — skipping', { sectorId }); return { startPage: 0, completed: true }; }
    logger.info('Resuming from checkpoint', { sectorId, page: cp.lastPageIndex, scraped: cp.totalScraped });
    return { startPage: cp.lastPageIndex, completed: false };
  } catch {
    return { startPage: 0, completed: false };
  }
};

const saveCheckpoint = (site: string, sectorId: string | null, pageIndex: number, total: number, completed = false): void => {
  const cp: Checkpoint = { site, sectorId, lastPageIndex: pageIndex, totalScraped: total, completed, updatedAt: new Date().toISOString() };
  fs.writeFileSync(cpPath(site, sectorId), JSON.stringify(cp, null, 2));
};

// ──────────────────────────────────────────────────────────────────────────────
// Single-sector pagination loop
// ──────────────────────────────────────────────────────────────────────────────

const ROWS_PER_PAGE = 10;

const scrapeSector = async (
  session: Session,
  config: SiteConfig,
  opts: ScrapeOptions,
  sectorId: string | null,
  sectorName: string | null,
  out: fs.WriteStream | null,
): Promise<number> => {
  const { site, pdfDir, limit, dryRun } = opts;

  const { startPage, completed } = opts.resume
    ? loadCheckpoint(site, sectorId)
    : { startPage: 0, completed: false };

  if (completed) return 0;

  let totalScraped = 0;
  let pageIndex = startPage;
  const sectorStart = Date.now();

  const elapsed = (): string => {
    const sec = Math.round((Date.now() - sectorStart) / 1000);
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
  };

  const $initial = await withRetry(
    () => fetchStartPage(session, config.startUrl),
    config.timing.retryWaitMs,
    `bootstrap-sector-${sectorId}`,
  );
  let page = parsePage($initial, config, config.baseUrl);

  if (config.search) {
    page = await withRetry(
      () => submitSearch(session, config.startUrl, page, config, sectorId),
      config.timing.retryWaitMs,
      `search-sector-${sectorId}`,
    );
    logger.info('Search submitted — first page received', {
      sector: `${sectorId}=${sectorName}`,
      rowsFound: page.rows.length,
      totalRecords: page.totalRecords ?? '?',
      totalPages: page.totalPages ?? '?',
      elapsed: elapsed(),
    });

    if (page.rows.length === 0) {
      logger.warn('Zero results for sector — skipping', { sectorId, sectorName });
      return 0;
    }
  }

  // Fast-forward to resume page by replaying page-turn POSTs
  for (let i = 0; i < pageIndex; i++) {
    const { $: next$, newViewState } = await withRetry(
      () => fetchNextPage(session, config.startUrl, page, i + 1, ROWS_PER_PAGE),
      config.timing.retryWaitMs,
      `resume-nav-${i + 1}`,
    );
    const pag = parsePaginatorText(next$);
    page = { ...page, viewState: newViewState ?? page.viewState, rows: parseRows(next$, config, config.baseUrl), hasNextPage: pageHasNext(next$), currentPage: pag?.currentPage ?? currentPageNum(next$), totalPages: pag?.totalPages ?? page.totalPages, totalRecords: pag?.totalRecords ?? page.totalRecords };
  }

  // Main pagination loop
  while (true) {
    if (limit !== null && totalScraped >= limit) { logger.info('Limit reached', { limit }); break; }

    const docs = page.rows.map(rowToDocument(site, pageIndex, config.columns, sectorId, sectorName));
    if (docs.length === 0) { logger.info('Empty page — end of results', { sectorId, pageIndex }); break; }

    const toWrite = limit !== null ? docs.slice(0, limit - totalScraped) : docs;

    if (dryRun) {
      logger.info('[dry-run]', { sectorId, pageIndex, count: toWrite.length, sample: toWrite[0]?.caseNumber });
    } else {
      for (const doc of toWrite) out!.write(JSON.stringify(doc) + '\n');
    }

    if (pdfDir && !dryRun) {
      for (let j = 0; j < toWrite.length; j++) {
        const doc = toWrite[j];
        const row = page.rows[j];
        if (doc.pdfUrl) {
          doc.pdfLocalPath = await downloadPdf(session, doc, pdfDir);
          await jitter(...config.timing.pdfDelayMs);
        } else if (row.pdfJsfAction) {
          doc.pdfLocalPath = await downloadJsfActionPdf(session, config, page.viewState, row.pdfJsfAction, doc, pdfDir);
          await jitter(...config.timing.pdfDelayMs);
        }
      }
    }

    const pdfDownloaded = toWrite.filter(d => d.pdfLocalPath).length;
    const pdfAvailable = toWrite.filter((doc, j) => doc.pdfUrl || page.rows[j]?.pdfJsfAction).length;

    totalScraped += toWrite.length;
    if (!dryRun) saveCheckpoint(site, sectorId, pageIndex, totalScraped);

    const elapsedSec = (Date.now() - sectorStart) / 1000;
    const docsPerMin = elapsedSec > 5 ? Math.round((totalScraped / elapsedSec) * 60) : null;
    const remaining = page.totalRecords != null ? page.totalRecords - totalScraped : null;

    logger.info('Page scraped', {
      sector: `${sectorId}=${sectorName}`,
      page: `${pageIndex + 1}${page.totalPages != null ? `/${page.totalPages}` : ''}`,
      docsThisPage: docs.length,
      totalScraped,
      totalRecords: page.totalRecords ?? '?',
      remaining: remaining != null ? remaining : '?',
      pdfs: `${pdfDownloaded}/${pdfAvailable} downloaded`,
      rate: docsPerMin != null ? `${docsPerMin} docs/min` : '—',
      elapsed: elapsed(),
    });

    if (!page.hasNextPage) {
      logger.info('Last page — sector complete', { sector: `${sectorId}=${sectorName}`, pagesProcessed: pageIndex + 1, totalScraped, elapsed: elapsed() });
      break;
    }

    await jitter(...config.timing.pageDelayMs);

    const { $: next$, newViewState } = await withRetry(
      () => fetchNextPage(session, config.startUrl, page, pageIndex + 1, ROWS_PER_PAGE),
      config.timing.retryWaitMs,
      `page-${pageIndex + 1}-sector-${sectorId}`,
    );
    const nextPag = parsePaginatorText(next$);
    page = {
      ...page,
      viewState: newViewState ?? page.viewState,
      rows: parseRows(next$, config, config.baseUrl),
      hasNextPage: pageHasNext(next$),
      currentPage: nextPag?.currentPage ?? currentPageNum(next$),
      totalPages: nextPag?.totalPages ?? page.totalPages,
      totalRecords: nextPag?.totalRecords ?? page.totalRecords,
    };
    pageIndex++;
  }

  if (!dryRun) saveCheckpoint(site, sectorId, pageIndex, totalScraped, true);
  logger.info('Sector done', { sector: `${sectorId}=${sectorName}`, totalScraped, elapsed: elapsed() });
  return totalScraped;
};

// ──────────────────────────────────────────────────────────────────────────────
// Public entrypoint
// ──────────────────────────────────────────────────────────────────────────────

export const scrapeAll = async (opts: ScrapeOptions): Promise<void> => {
  const config = SITES[opts.site];
  if (!config) throw new Error(`Unknown site: ${opts.site}. Available: ${Object.keys(SITES).join(', ')}`);

  fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
  if (opts.pdfDir && !opts.dryRun) fs.mkdirSync(opts.pdfDir, { recursive: true });

  // Determine sectors to scrape
  let sectorsToRun: Array<[string | null, string | null]>;

  if (config.search?.sectorField) {
    const discovered = await discoverSectors(opts.site, opts.proxy);
    const sectors = Object.keys(discovered).length > 0 ? discovered : (config.search.sectors ?? {});

    if (opts.sectorId !== null) {
      sectorsToRun = [[opts.sectorId, sectors[opts.sectorId] ?? opts.sectorId]];
    } else if (Object.keys(sectors).length > 0) {
      sectorsToRun = Object.entries(sectors);
    } else {
      logger.warn('No sectors found — scraping without sector filter');
      sectorsToRun = [[null, null]];
    }
  } else {
    sectorsToRun = [[null, null]];
  }

  logger.info('Sectors queued', { count: sectorsToRun.length, sectors: sectorsToRun.map(([id, name]) => `${id}=${name}`).join(', ') });

  const out = opts.dryRun ? null : fs.createWriteStream(opts.outputPath, { flags: 'a' });
  let totalScraped = 0;
  const runStart = Date.now();

  for (let i = 0; i < sectorsToRun.length; i++) {
    const [sectorId, sectorName] = sectorsToRun[i];
    logger.info(`── Sector ${i + 1}/${sectorsToRun.length}: ${sectorName ?? sectorId} ──`, { sectorId, sectorName });
    const session = makeSession(config.baseUrl, opts.proxy);
    const count = await scrapeSector(session, config, opts, sectorId, sectorName, out);
    totalScraped += count;

    const runSec = Math.round((Date.now() - runStart) / 1000);
    logger.info(`Sector ${i + 1}/${sectorsToRun.length} done`, {
      sector: `${sectorId}=${sectorName}`,
      sectorDocs: count,
      totalSoFar: totalScraped,
      runElapsed: runSec < 60 ? `${runSec}s` : `${Math.floor(runSec / 60)}m${runSec % 60}s`,
    });

    if (i < sectorsToRun.length - 1) {
      const pause = 5_000 + Math.floor(Math.random() * 5_000);
      const next = sectorsToRun[i + 1];
      logger.info(`Pausing ${Math.round(pause / 1000)}s before next sector: ${next[1] ?? next[0]}`, { pauseMs: pause });
      await sleep(pause);
    }
  }

  out?.end();
  validateOutput(opts.outputPath, totalScraped, opts.dryRun);
  const totalSec = Math.round((Date.now() - runStart) / 1000);
  logger.info('Run complete', {
    site: opts.site,
    totalScraped,
    output: opts.outputPath,
    totalElapsed: totalSec < 60 ? `${totalSec}s` : `${Math.floor(totalSec / 60)}m${totalSec % 60}s`,
  });
};
