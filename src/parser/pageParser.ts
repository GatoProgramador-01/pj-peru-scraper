import type { $Root, ParsedPage } from '../models/internalTypes.js';
import type { SiteConfig } from '../types.js';
import { extractFormId, extractViewState } from '../jsf/viewState.js';
import { currentPageNum, extractPaginatorId, pageHasNext, parsePaginatorText } from './paginatorParser.js';
import { parseRows } from './rowParser.js';

export const parsePage = ($: $Root, config: SiteConfig, baseUrl: string): ParsedPage => {
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
