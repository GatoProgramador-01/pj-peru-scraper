// Tests for src/parser/rowParser.ts — parseRows() with richfacesRepeat config.
// Key invariant: selector is div.rf-p (stable class) — works with ANY j_idt suffix.

import { describe, it, expect } from 'vitest';
import { load } from 'cheerio';
import { parseRows } from '../../src/parser/rowParser.js';
import type { SiteConfig } from '../../src/types.js';

const BASE_URL = 'https://jurisprudencia.pj.gob.pe';

const mockConfig: SiteConfig = {
  name: 'pj-peru',
  baseUrl: BASE_URL,
  startUrl: `${BASE_URL}/inicio`,
  rowParser: 'richfacesRepeat',
  columns: { caseNumber: 1, court: 5, date: 4, summary: 2, resolution: 3 },
  timing: { pageDelayMs: [0,0], pdfDelayMs: [0,0], retryWaitMs: [0,0,0], navigationTimeoutMs: 0, selectorTimeoutMs: 0 },
  selectors: { rows: '', cells: 'td', caseNumber: 'td', court: 'td', date: 'td', summary: 'td',
    pdfLink: 'a[href*="ServletDescarga"]', nextButton: '', currentPage: null, totalPages: null, noResults: null },
} as SiteConfig;

// Fixture uses j_idt999 — the stable div.rf-p selector must find it regardless of suffix
const fullPanelHtml = `
<div class="rf-p" id="formBuscador:repeat:0:j_idt999">
  <div class="rf-p-hdr">
    <span style="font-weight:bold">Apelación</span>
    <span style="font-weight:bold">029329-2025</span>
  </div>
  <div class="rf-p-b" id="formBuscador:repeat:0:j_idt999_body">
    <div class="col-md-12 txtbold">Pretensión/Delito:</div>
    <div class="col-md-12">Acción de Amparo</div>
    <div class="col-md-12 txtbold">Tipo Resolución:</div>
    <div class="col-md-12">Ejecutoria Suprema</div>
    <div class="col-md-12 txtbold">Fecha Resolución:</div>
    <div class="col-md-12">19/06/2026</div>
    <div class="col-md-12 txtbold">Sala:</div>
    <div class="col-md-12">Quinta Sala Civil</div>
    <div class="col-md-12 txtbold">Sumilla:</div>
    <div class="col-md-12">La resolución impugnada fue confirmada.</div>
    <div class="col-md-12 txtbold">Palabras Clave:</div>
    <div class="col-md-12">debido proceso, motivación</div>
    <a href="/jurisprudenciaweb/ServletDescarga?uuid=abc-123">Ver Resolución</a>
  </div>
</div>
`;

describe('parseRows — richfacesRepeat', () => {
  it('extracts all cells from a valid RF panel', () => {
    const $ = load(fullPanelHtml);
    const rows = parseRows($, mockConfig, BASE_URL);

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.cells[0]).toBe('Apelación');        // tipoRecurso
    expect(row.cells[1]).toBe('029329-2025');       // expediente
    expect(row.cells[2]).toBe('Acción de Amparo'); // pretension
    expect(row.cells[3]).toBe('Ejecutoria Suprema');
    expect(row.cells[4]).toBe('19/06/2026');
    expect(row.cells[5]).toBe('Quinta Sala Civil');
    expect(row.cells[6]).toBe('La resolución impugnada fue confirmada.');
  });

  it('populates named fields tipoRecurso, sumilla, palabrasClave', () => {
    const $ = load(fullPanelHtml);
    const [row] = parseRows($, mockConfig, BASE_URL);

    expect(row.tipoRecurso).toBe('Apelación');
    expect(row.sumilla).toBe('La resolución impugnada fue confirmada.');
    expect(row.palabrasClave).toBe('debido proceso, motivación');
  });

  it('finds panels via stable div.rf-p class — any j_idt suffix works', () => {
    // Our selector is div.rf-p[id^="formBuscador:repeat:"] — suffix is irrelevant
    const html999  = fullPanelHtml; // uses j_idt999
    const html123  = fullPanelHtml.replace(/:j_idt999/g, ':j_idt123');
    const html9999 = fullPanelHtml.replace(/:j_idt999/g, ':j_idt9999');

    expect(parseRows(load(html999),  mockConfig, BASE_URL)).toHaveLength(1);
    expect(parseRows(load(html123),  mockConfig, BASE_URL)).toHaveLength(1);
    expect(parseRows(load(html9999), mockConfig, BASE_URL)).toHaveLength(1);
  });

  it('returns empty array given empty HTML', () => {
    const $ = load('<html><body></body></html>');
    expect(parseRows($, mockConfig, BASE_URL)).toHaveLength(0);
  });

  it('sets pdfUrl to null when panel has no ServletDescarga link', () => {
    const html = fullPanelHtml.replace(/<a href.*<\/a>/, '');
    const [row] = parseRows(load(html), mockConfig, BASE_URL);
    expect(row.pdfUrl).toBeNull();
  });

  it('builds absolute URL from a relative href', () => {
    const [row] = parseRows(load(fullPanelHtml), mockConfig, BASE_URL);
    expect(row.pdfUrl).toBe(`${BASE_URL}/jurisprudenciaweb/ServletDescarga?uuid=abc-123`);
  });

  it('preserves an already-absolute href unchanged', () => {
    const abs = 'https://cdn.example.com/ServletDescarga?uuid=xyz';
    const html = fullPanelHtml.replace('/jurisprudenciaweb/ServletDescarga?uuid=abc-123', abs);
    const [row] = parseRows(load(html), mockConfig, BASE_URL);
    expect(row.pdfUrl).toBe(abs);
  });
});
