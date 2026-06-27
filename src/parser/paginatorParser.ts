import type { $Root } from '../models/internalTypes.js';

export const extractPaginatorId = ($: $Root): string | null =>
  $('[id*="paginator"], [id*="pager"], .ui-paginator').first().attr('id') ?? null;

export const parsePaginatorText = ($: $Root): { currentPage: number; totalPages: number; totalRecords: number } | null => {
  // PrimeFaces paginator text: "Página N de M (K registros)"
  const text = $('.ui-paginator-current').first().text().trim();
  const m = text.match(/P[aá]gina\s+(\d+)\s+de\s+(\d+)\s*\((\d+)\s+registros?\)/i);
  if (m) return { currentPage: parseInt(m[1], 10), totalPages: parseInt(m[2], 10), totalRecords: parseInt(m[3], 10) };

  // RichFaces data scroller (pj-peru): spinner maxValue + result count text
  const spinnerScript = $('script').filter((_, el) => $(el).html()?.includes('maxValue') ?? false).first().html();
  const maxMatch = spinnerScript?.match(/"maxValue"\s*:\s*(\d+)/);
  const totalPages = maxMatch ? parseInt(maxMatch[1], 10) : null;

  const resultText = $('[id*="optResultado"]').first().text();
  const totalMatch = resultText.match(/(\d[\d,]+)\s*resultados?/i);
  const totalRecords = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) : null;

  const currentMatch = $('[id$="_ds_nmb-btn_active"], .rf-ds-act').first().text();
  const currentPage = currentMatch ? (parseInt(currentMatch.trim(), 10) || 1) : null;

  if (totalPages) return { currentPage: currentPage ?? 1, totalPages, totalRecords: totalRecords ?? totalPages * 10 };
  return null;
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
