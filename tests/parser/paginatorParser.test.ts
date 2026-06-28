// Tests for src/parser/paginatorParser.ts
// parsePaginatorText, pageHasNext, currentPageNum — all pure functions, no network.

import { describe, it, expect } from 'vitest';
import { load } from 'cheerio';
import {
  parsePaginatorText,
  pageHasNext,
  currentPageNum,
} from '../../src/parser/paginatorParser.js';

// ---------------------------------------------------------------------------
// HTML fixtures
// ---------------------------------------------------------------------------

/** PrimeFaces paginator: mid-range page */
const primeFacesMidHtml = `
<div class="ui-paginator ui-paginator-bottom" id="formBuscador:tablaCasos_paginator_bottom">
  <span class="ui-paginator-current">Página 3 de 47 (465 registros)</span>
  <a class="ui-paginator-next ui-state-default" role="button" aria-label="Next Page">›</a>
</div>
`;

/** PrimeFaces paginator: last page — next button disabled */
const primeFacesLastHtml = `
<div class="ui-paginator ui-paginator-bottom" id="formBuscador:tablaCasos_paginator_bottom">
  <span class="ui-paginator-current">Página 47 de 47 (465 registros)</span>
  <a class="ui-paginator-next ui-state-disabled" role="button" aria-disabled="true">›</a>
</div>
`;

/** PrimeFaces paginator: first page (1 of 1) — single page result set */
const primeFacesSingleHtml = `
<div class="ui-paginator">
  <span class="ui-paginator-current">Página 1 de 1 (7 registros)</span>
  <a class="ui-paginator-next ui-state-disabled" role="button" aria-disabled="true">›</a>
</div>
`;

/** PrimeFaces: alternate accent form "Pagina" (no accent) */
const primeFacesNoAccentHtml = `
<span class="ui-paginator-current">Pagina 2 de 10 (100 registros)</span>
`;

/** RichFaces DataScroller: maxValue in script, result count in optResultado span, active page button */
const richFacesHtml = `
<html><body>
  <span id="formBuscador:optResultado">Se encontraron 248 resultados</span>
  <script type="text/javascript">
    RichFaces.ui.DataScroller.initScript({"maxValue":25,"page":2,"id":"formBuscador:scroller"});
  </script>
  <a id="formBuscador:scroller_ds_nmb-btn_active" class="rf-ds-act">2</a>
  <a class="rf-ds-btn-next" href="#">Next</a>
</body></html>
`;

/** RichFaces: last page — no rf-ds-btn-next */
const richFacesLastHtml = `
<html><body>
  <span id="formBuscador:optResultado">248 resultados</span>
  <script>RichFaces.ui.DataScroller.initScript({"maxValue":25});</script>
  <a id="formBuscador:scroller_ds_nmb-btn_active" class="rf-ds-act">25</a>
</body></html>
`;

/** Empty HTML — no paginator at all */
const emptyHtml = '<html><body></body></html>';

// ---------------------------------------------------------------------------
// parsePaginatorText
// ---------------------------------------------------------------------------

describe('parsePaginatorText — PrimeFaces', () => {
  it('parses mid-range page correctly', () => {
    const result = parsePaginatorText(load(primeFacesMidHtml));
    expect(result).toEqual({ currentPage: 3, totalPages: 47, totalRecords: 465 });
  });

  it('parses last page correctly', () => {
    const result = parsePaginatorText(load(primeFacesLastHtml));
    expect(result).toEqual({ currentPage: 47, totalPages: 47, totalRecords: 465 });
  });

  it('parses single-page result set', () => {
    const result = parsePaginatorText(load(primeFacesSingleHtml));
    expect(result).toEqual({ currentPage: 1, totalPages: 1, totalRecords: 7 });
  });

  it('handles "Pagina" without accent', () => {
    const result = parsePaginatorText(load(primeFacesNoAccentHtml));
    expect(result).toEqual({ currentPage: 2, totalPages: 10, totalRecords: 100 });
  });

  it('returns null for HTML with no paginator', () => {
    expect(parsePaginatorText(load(emptyHtml))).toBeNull();
  });
});

describe('parsePaginatorText — RichFaces DataScroller', () => {
  it('extracts totalPages from maxValue in script and totalRecords from optResultado', () => {
    const result = parsePaginatorText(load(richFacesHtml));
    expect(result).not.toBeNull();
    expect(result!.totalPages).toBe(25);
    expect(result!.totalRecords).toBe(248);
  });

  it('extracts currentPage from active scroller button', () => {
    const result = parsePaginatorText(load(richFacesHtml));
    expect(result!.currentPage).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// pageHasNext
// ---------------------------------------------------------------------------

describe('pageHasNext', () => {
  it('returns true when currentPage < totalPages (PrimeFaces mid)', () => {
    expect(pageHasNext(load(primeFacesMidHtml))).toBe(true);
  });

  it('returns false when currentPage === totalPages (PrimeFaces last)', () => {
    expect(pageHasNext(load(primeFacesLastHtml))).toBe(false);
  });

  it('returns false on single-page result set', () => {
    expect(pageHasNext(load(primeFacesSingleHtml))).toBe(false);
  });

  it('returns true when RichFaces rf-ds-btn-next exists', () => {
    expect(pageHasNext(load(richFacesHtml))).toBe(true);
  });

  it('returns false on last RichFaces page (no rf-ds-btn-next)', () => {
    expect(pageHasNext(load(richFacesLastHtml))).toBe(false);
  });

  it('returns false for empty HTML', () => {
    expect(pageHasNext(load(emptyHtml))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// currentPageNum
// ---------------------------------------------------------------------------

describe('currentPageNum', () => {
  it('returns current page number from PrimeFaces paginator', () => {
    expect(currentPageNum(load(primeFacesMidHtml))).toBe(3);
  });

  it('returns 0 when no paginator present', () => {
    expect(currentPageNum(load(emptyHtml))).toBe(0);
  });
});
