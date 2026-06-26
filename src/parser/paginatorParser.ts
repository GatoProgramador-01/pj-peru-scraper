import type { $Root } from '../models/internalTypes.js';

export const extractPaginatorId = ($: $Root): string | null =>
  $('[id*="paginator"], [id*="pager"], .ui-paginator').first().attr('id') ?? null;

export const parsePaginatorText = ($: $Root): { currentPage: number; totalPages: number; totalRecords: number } | null => {
  const text = $('.ui-paginator-current').first().text().trim();
  const m = text.match(/P[aá]gina\s+(\d+)\s+de\s+(\d+)\s*\((\d+)\s+registros?\)/i);
  if (!m) return null;
  return { currentPage: parseInt(m[1], 10), totalPages: parseInt(m[2], 10), totalRecords: parseInt(m[3], 10) };
};

export const pageHasNext = ($: $Root): boolean => {
  const info = parsePaginatorText($);
  if (info) return info.currentPage < info.totalPages;
  const btn = $('a.ui-paginator-next, [id*="next"]:not([disabled])').first();
  if (!btn.length) return false;
  return !btn.hasClass('ui-state-disabled') && btn.attr('aria-disabled') !== 'true';
};

export const currentPageNum = ($: $Root): number => {
  const info = parsePaginatorText($);
  if (info) return info.currentPage;
  const text = $('.ui-paginator-page.ui-state-active, .paginacion-actual').first().text().trim();
  return text ? (parseInt(text, 10) || 0) : 0;
};
