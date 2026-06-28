import type { $Root } from '../models/internalTypes.js';

/** Resolved paginator state extracted from the current HTML fragment. */
export type PaginatorInfo = { currentPage: number; totalPages: number; totalRecords: number };

export const extractPaginatorId = ($: $Root): string | null =>
  $('[id*="paginator"], [id*="pager"], .ui-paginator').first().attr('id') ?? null;

/** PrimeFaces paginator text: "Página N de M (K registros)". */
const parsePrimeFacesPaginator = ($: $Root): PaginatorInfo | null => {
  const text = $('.ui-paginator-current').first().text().trim();
  const m = text.match(/P[aá]gina\s+(\d+)\s+de\s+(\d+)\s*\((\d+)\s+registros?\)/i);
  if (!m) return null;
  return { currentPage: parseInt(m[1], 10), totalPages: parseInt(m[2], 10), totalRecords: parseInt(m[3], 10) };
};

/** RichFaces DataScroller page count (pj-peru): extracted from embedded script config.
 *  Only present on initial full-page load — AJAX partial responses won't have it. */
const parseRichFacesPageCount = ($: $Root): { totalPages: number | null; totalRecords: number | null } => {
  const allScripts = $('script').map((_, el) => $(el).html() ?? '').get().join('\n');
  const maxMatch = allScripts.match(/"maxValue"\s*:\s*(\d+)/) ?? allScripts.match(/"max"\s*:\s*(\d+)/);
  const totalPages = maxMatch ? parseInt(maxMatch[1], 10) : null;

  // Try multiple selectors and text patterns used by pj-peru portal.
  const candidateText = [
    $('[id*="optResultado"]').text(),
    $('[id*="resultado"]').text(),
    $('[id*="Resultado"]').text(),
    $('[id*="total"]').text(),
  ].join(' ');
  const countPatterns = [
    /(\d[\d,.]+)\s*resultados?/i,
    /(\d[\d,.]+)\s*registros?/i,
    /total[:\s]+(\d[\d,.]+)/i,
    /encontr[ao][a-záéíóúñ]*:?\s*(\d[\d,.]+)/i,
  ];
  let totalRecords: number | null = null;
  for (const pat of countPatterns) {
    const cm = candidateText.match(pat);
    if (cm) { totalRecords = parseInt(cm[1].replace(/[,.]/g, ''), 10); break; }
  }

  return { totalPages, totalRecords };
};

/** RichFaces active page button: reads the highlighted page number from the DataScroller. */
const parseRichFacesCurrentPage = ($: $Root): number => {
  const currentMatch = $('[id$="_ds_nmb-btn_active"], .rf-ds-act').first().text();
  return currentMatch ? (parseInt(currentMatch.trim(), 10) || 1) : 1;
};

/** Combines RichFaces page count and current-page strategies into a single PaginatorInfo. */
const parseRichFacesPaginator = ($: $Root): PaginatorInfo | null => {
  const { totalPages, totalRecords } = parseRichFacesPageCount($);
  if (!totalPages) return null;
  const currentPage = parseRichFacesCurrentPage($);
  return { currentPage, totalPages, totalRecords: totalRecords ?? totalPages * 10 };
};

export const parsePaginatorText = ($: $Root): PaginatorInfo | null => {
  const primeFaces = parsePrimeFacesPaginator($);
  if (primeFaces) return primeFaces;
  return parseRichFacesPaginator($);
};

export const pageHasNext = ($: $Root): boolean => {
  const info = parsePaginatorText($);
  if (info) return info.currentPage < info.totalPages;
  // PrimeFaces next button
  const btn = $('a.ui-paginator-next, [id*="next"]:not([disabled])').first();
  if (btn.length) return !btn.hasClass('ui-state-disabled') && btn.attr('aria-disabled') !== 'true';
  // RichFaces data scroller next button
  const rfNext = $('a.rf-ds-btn-next').first();
  return rfNext.length > 0;
};

export const currentPageNum = ($: $Root): number => {
  const info = parsePaginatorText($);
  if (info) return info.currentPage;
  const text = $('.ui-paginator-page.ui-state-active, .paginacion-actual, .rf-ds-act').first().text().trim();
  return text ? (parseInt(text, 10) || 0) : 0;
};
