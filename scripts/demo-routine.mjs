#!/usr/bin/env node
/**
 * demo-routine.mjs — Standalone demonstration of the pj-peru scraping routine.
 *
 * Shows every step with detailed output: session, search form POST, redirect handling,
 * AJAX pagination, data extraction, and PDF download.
 *
 * Usage (with Peru VPN active):
 *   node scripts/demo-routine.mjs
 *   node scripts/demo-routine.mjs --pages 5 --no-pdf
 *
 * NOT part of the scraper core — pure demonstration/audit tool.
 */

import https from 'https';
import { createWriteStream, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import { load as cheerioLoad } from 'cheerio';

// ── ANSI colors ──────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', magenta: '\x1b[35m', blue: '\x1b[34m',
};
const box = (title, color = C.cyan) =>
  `${color}${C.bold}${'─'.repeat(66)}\n  ${title}\n${'─'.repeat(66)}${C.reset}`;
const step  = (n, msg)  => console.log(`\n${C.yellow}${C.bold}[${n}]${C.reset} ${msg}`);
const ok    = msg => console.log(`  ${C.green}✓${C.reset} ${msg}`);
const info  = msg => console.log(`  ${C.dim}${msg}${C.reset}`);
const field = (k, v) => console.log(`  ${C.cyan}${k.padEnd(18)}${C.reset} ${v}`);
const warn  = msg => console.log(`  ${C.yellow}⚠ ${msg}${C.reset}`);

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const maxPages = parseInt(args[args.indexOf('--pages') + 1] ?? '3', 10) || 3;
const skipPdf  = args.includes('--no-pdf');
const outDir   = 'output/demo';
mkdirSync(outDir, { recursive: true });

// ── HTTP helpers ──────────────────────────────────────────────────────────────
const BASE = 'jurisprudencia.pj.gob.pe';
const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

let cookies = '';
let viewState = '';
let activeUrl = '';

const request = (method, path, body, extraHeaders = {}) =>
  new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': UA,
      'Cookie': cookies,
      'Accept': 'text/html,application/xhtml+xml,*/*',
      ...extraHeaders,
    };
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      headers['Content-Length'] = Buffer.byteLength(body).toString();
    }
    const req = https.request({ hostname: BASE, path, method, headers }, res => {
      // Absorb cookies
      (res.headers['set-cookie'] ?? []).forEach(c => {
        const [kv] = c.split(';');
        const [k]  = kv.split('=');
        const existing = cookies ? cookies.split('; ').filter(x => !x.startsWith(k + '=')) : [];
        cookies = [...existing, kv].join('; ');
      });
      let data = '';
      res.on('data', d => data += d);
      res.on('end',  () => resolve({ status: res.status ?? res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

const extractViewState = html => {
  const m = html.match(/id="javax\.faces\.ViewState"[^>]*value="([^"]+)"/);
  return m ? m[1] : viewState;
};


// ── MAIN DEMO ─────────────────────────────────────────────────────────────────
console.log(box('PJ PERU — SCRAPING ROUTINE DEMO', C.magenta));
console.log(`  Portal  : https://${BASE}/jurisprudenciaweb/`);
console.log(`  Paginas : ${maxPages} | PDFs: ${skipPdf ? 'NO' : 'SI'}`);
console.log(`  Salida  : ${outDir}/`);

// ── STEP 1: GET inicio.xhtml ─────────────────────────────────────────────────
step(1, 'GET inicio.xhtml — obtener cookies + ViewState');
const t0 = Date.now();
const home = await request('GET', '/jurisprudenciaweb/faces/page/inicio.xhtml');
viewState = extractViewState(home.data);
info(`HTTP ${home.status} — ${home.data.length.toLocaleString()} bytes — ${Date.now()-t0}ms`);
info(`Cookies recibidas : ${cookies.split(';').map(c=>c.trim().split('=')[0]).join(', ')}`);
info(`ViewState (inicio): ${viewState.slice(0,40)}...`);
ok('Sesion iniciada');

// ── STEP 2: POST search form → 302 ───────────────────────────────────────────
step(2, 'POST formBuscador → inicio.xhtml (Corte Suprema, sin filtros)');
const searchFields = [
  ['formBuscador', 'formBuscador'],
  ['formBuscador:buCorte', '1'],
  ['formBuscador:buDistrito', '0'],
  ['formBuscador:buEspecialidad', '0'],
  ['formBuscador:buSala', '0'],
  ['formBuscador:buAnio', ''],
  ['formBuscador:txtBusqueda', ''],
  ['formBuscador:tabpanel-value', 'general'],
  ['forward', 'buscar'],
  ['busqueda', 'especializada'],
  ['formBuscador:j_idt34', '21'],
  ['formBuscador:j_idt35', 'DESC'],
  ['formBuscador:j_idt36', 'Principal'],
  ['formBuscador:j_idt37', '1'],
  ['formBuscador:j_idt31', ''],
  ['javax.faces.ViewState', viewState],
];
const searchBody = searchFields.map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

console.log(`  ${C.dim}Campos enviados:${C.reset}`);
searchFields.slice(1, 8).forEach(([k,v]) => info(`    ${k} = "${v || '(vacío)'}"`));
info(`    ... + ViewState`);

const t1 = Date.now();
const searchResp = await request('POST', '/jurisprudenciaweb/faces/page/inicio.xhtml', searchBody, {
  'Referer': `https://${BASE}/jurisprudenciaweb/faces/page/inicio.xhtml`,
  'maxRedirects': 0,
});
info(`HTTP ${searchResp.status} — ${Date.now()-t1}ms`);

if (searchResp.status === 302 || searchResp.status === 301 || searchResp.status === 303) {
  const location = searchResp.headers['location'];
  const httpsLocation = location.replace(/^http:\/\//i, 'https://');
  warn(`302 → Location: ${location}`);
  warn(`Upgrade: ${location} → ${httpsLocation}`);

  // ── STEP 3: Follow upgraded redirect ──────────────────────────────────────
  step(3, `GET ${httpsLocation.replace('https://'+BASE, '')} (seguir redirect con https://)`);
  const t2 = Date.now();
  const resultsResp = await request('GET', httpsLocation.replace('https://'+BASE, ''), null, {
    'Referer': `https://${BASE}/jurisprudenciaweb/faces/page/inicio.xhtml`,
  });
  viewState = extractViewState(resultsResp.data);
  activeUrl = httpsLocation.split('?')[0].split(';')[0];
  info(`HTTP ${resultsResp.status} — ${resultsResp.data.length.toLocaleString()} bytes — ${Date.now()-t2}ms`);
  ok(`resultado.xhtml cargado — ViewState actualizado`);

  // Count panels in first page
  const panelMatches = [...resultsResp.data.matchAll(/id="formBuscador:repeat:(\d+):j_idt455"/g)];
  ok(`Paneles de resultado encontrados: ${panelMatches.length}`);

  // Extract data — mirrors rowParser.ts parseRichFacesRepeatRows exactly (proven in production)
  step(4, `Parsear pagina 1 — extrayendo campos de cada panel`);
  const extractPanels = html => {
    const $ = cheerioLoad(html);
    // Filter approach avoids CSS pseudo-class ambiguity with colons in attribute values
    const panels = $('[id]').filter((_, el) => {
      const id = $(el).attr('id') ?? '';
      return id.startsWith('formBuscador:repeat:') && id.endsWith(':j_idt455');
    }).toArray();

    return panels.slice(0, 3).map(panel => {
      const $el = $(panel);
      const headerSpans = $el.find('.rf-p-hdr span[style*="bold"]').toArray();
      const tipoRecurso = $(headerSpans[0])?.text().trim() ?? '';
      const expediente  = $(headerSpans[1])?.text().trim() ?? '';

      const body = $el.find('.rf-p-b').first();
      const labeled = label => {
        const block = body.find('.txtbold').filter((_, e) => $(e).text().trim().startsWith(label));
        return block.next().text().trim();
      };

      const rawHref = $el.find('a[href*="ServletDescarga"]').first().attr('href') ?? null;
      const pdfHref = rawHref
        ? (rawHref.startsWith('http') ? rawHref : `https://${BASE}${rawHref.startsWith('/') ? '' : '/'}${rawHref}`)
        : null;

      return {
        tipoRecurso,
        expediente,
        pretension: labeled('Pretensión'),
        tipoRes:    labeled('Tipo Resolución'),
        fecha:      labeled('Fecha Resolución'),
        sala:       labeled('Sala'),
        sumilla:    labeled('Sumilla'),
        pdfHref,
      };
    });
  };

  let currentHtml = resultsResp.data;
  let firstPdfUrl  = null;
  let firstPdfUuid = null;

  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    console.log(`\n${box(`PAGINA ${pageIdx + 1} de ? (total desconocido — 207,527 docs en Suprema)`, C.blue)}`);
    const docs = extractPanels(currentHtml);
    if (docs.length === 0) { warn('Sin resultados en esta pagina — fin.'); break; }
    ok(`${docs.length} documentos parseados`);
    docs.forEach((d, i) => {
      console.log(`\n  ${C.bold}Doc ${i+1}:${C.reset}`);
      field('Tipo Recurso', d.tipoRecurso || C.dim+'(vacío)'+C.reset);
      field('Expediente',  d.expediente  || C.dim+'(vacío)'+C.reset);
      field('Pretension',  (d.pretension  || '').slice(0,60) || C.dim+'(vacío)'+C.reset);
      field('Tipo Res.',   (d.tipoRes     || '').slice(0,60) || C.dim+'(vacío)'+C.reset);
      field('Fecha',       d.fecha        || C.dim+'(vacío)'+C.reset);
      field('Sala',        (d.sala        || '').slice(0,60) || C.dim+'(vacío)'+C.reset);
      if (d.pdfHref) {
        const url = d.pdfHref.startsWith('http') ? d.pdfHref : `https://${BASE}${d.pdfHref.startsWith('/') ? '' : '/jurisprudenciaweb/'}${d.pdfHref}`;
        field('PDF URL', url.slice(0,80));
        if (!firstPdfUrl) { firstPdfUrl = url; firstPdfUuid = url.match(/uuid=([^&]+)/)?.[1]; }
      } else {
        field('PDF URL', C.dim+'no encontrado'+C.reset);
      }
    });

    if (pageIdx + 1 >= maxPages) break;

    // ── AJAX pagination ──────────────────────────────────────────────────────
    const nextPage = pageIdx + 2;
    step(`4.${pageIdx+1}`, `POST AJAX → DataScroller formBuscador:data1 → pagina ${nextPage}`);
    const scroller = 'formBuscador:data1';
    const ajaxFields = [
      ['javax.faces.partial.ajax', 'true'],
      ['javax.faces.source', scroller],
      ['javax.faces.partial.execute', scroller],
      ['javax.faces.partial.render', `${scroller} formBuscador:panel`],
      ['javax.faces.behavior.event', 'action'],
      ['org.richfaces.ajax.component', scroller],
      ['formBuscador', 'formBuscador'],
      [scroller, scroller],
      [`${scroller}:page`, String(nextPage)],
      ['javax.faces.ViewState', viewState],
    ];
    const ajaxBody = ajaxFields.map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    info(`POST ${activeUrl.replace('https://'+BASE, '')}`);
    info(`Parametro clave: ${scroller}:page = ${nextPage}`);

    const tA = Date.now();
    const ajaxResp = await request('POST', activeUrl.replace('https://'+BASE, ''), ajaxBody, {
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': activeUrl,
    });
    const newVs = ajaxResp.data.match(/id="javax\.faces\.ViewState"[^>]*value="([^"]+)"/)?.[1];
    if (newVs) viewState = newVs;

    // Extract HTML from partial-response
    const updateMatch = ajaxResp.data.match(/<update id="formBuscador:panel"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/);
    if (updateMatch) {
      currentHtml = updateMatch[1];
      ok(`Respuesta AJAX: ${ajaxResp.data.length.toLocaleString()} bytes — ${Date.now()-tA}ms`);
    } else {
      warn(`Respuesta parcial sin bloque panel (${ajaxResp.data.length} bytes)`);
      currentHtml = ajaxResp.data;
    }
    const newVsShort = viewState.slice(0,30);
    info(`ViewState actualizado: ${newVsShort}...`);
  }

  // ── STEP 5: Download first PDF ───────────────────────────────────────────
  if (!skipPdf && firstPdfUrl) {
    step(5, `GET PDF → ${firstPdfUrl.slice(0, 80)}`);
    info(`UUID: ${firstPdfUuid ?? 'no extraido'}`);
    const pdfPath = `${outDir}/demo-${firstPdfUuid ?? 'sample'}.pdf`;
    try {
      const tP = Date.now();
      const pdfResp = await new Promise((resolve, reject) => {
        https.get(firstPdfUrl, { headers: { 'Cookie': cookies, 'User-Agent': UA } }, res => {
          resolve(res);
        }).on('error', reject);
      });
      const writer = createWriteStream(pdfPath);
      await pipeline(pdfResp, writer);
      const { statSync } = await import('fs');
      const kb = (statSync(pdfPath).size / 1024).toFixed(0);
      ok(`PDF descargado: ${pdfPath} (${kb} KB) — ${Date.now()-tP}ms`);
      field('Content-Type', pdfResp.headers['content-type'] ?? 'unknown');
    } catch (e) {
      warn(`PDF fallido: ${e.message}`);
    }
  } else if (!skipPdf) {
    warn('No se encontro URL de PDF en esta pagina');
  }

} else {
  warn(`Respuesta inesperada: HTTP ${searchResp.status} (esperaba 302)`);
  info(searchResp.data.slice(0, 200));
}

// ── NOTA SOBRE "?" ────────────────────────────────────────────────────────────
console.log(`\n${box('NOTA: Por que "Pagina X de ?"', C.yellow)}`);
console.log(`
  pj-peru usa RichFaces DataScroller. El componente renderiza botones
  de pagina individuales (1, 2, 3...) pero NO incluye un texto
  "Pagina X de Y" ni el valor total en las respuestas AJAX parciales.

  El fragmento <partial-response> solo contiene:
    <update id="formBuscador:panel">  → los 10 paneles de resultados
    <update id="formBuscador:data1">  → el scroller (sin total de paginas)
    <update id="javax.faces.ViewState"> → nuevo ViewState

  El total real (207,527 docs = 20,753 paginas para Corte Suprema)
  se conoce del recon manual del elemento [id*="optResultado"] en la
  pagina completa de resultado.xhtml — pero NO aparece en los fragmentos
  AJAX subsiguientes. Por eso el scraper muestra "?" y usa la heuristica
  "si la pagina tiene 10 filas, hay mas paginas" para continuar.
`);

console.log(box(`DEMO COMPLETA — ${outDir}/`, C.green));
console.log(`  Archivos generados:`);
console.log(`    ${outDir}/demo-*.pdf  (primer PDF de la pagina 1)`);
console.log(`\n  Para repetir:`);
console.log(`    node scripts/demo-routine.mjs --pages 5`);
console.log(`    node scripts/demo-routine.mjs --pages 2 --no-pdf\n`);
