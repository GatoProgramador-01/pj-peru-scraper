import type { $Root, ParsedPage } from '../models/internalTypes.js';
import type { SiteConfig } from '../types.js';
import { extractFormId, extractViewState } from '../jsf/viewState.js';
import { currentPageNum, extractPaginatorId, pageHasNext, parsePaginatorText } from './paginatorParser.js';
import { parseRows } from './rowParser.js';

/**
 * Parse a full JSF portal page into a structured `ParsedPage`.
 *
 * @remarks
 * Orchestrates all sub-parsers in one pass: extracts the JSF ViewState and
 * form ID needed for subsequent POST requests, delegates row extraction to
 * `parseRows` (which selects the table vs. RichFaces variant based on
 * `config.rowParser`), and reads paginator state to determine whether more
 * pages exist. `baseUrl` is forwarded to `parseRows` so that relative PDF
 * `href` attributes can be resolved to absolute URLs before the result
 * leaves the parser layer. `totalPages` and `totalRecords` are `null` when
 * the portal does not render a paginator summary text on the current page.
 *
 * @param $ - Cheerio root loaded from the raw HTML response body
 * @param config - Site-specific configuration: selectors, rowParser variant, column mappings
 * @param baseUrl - Origin (e.g. `https://cej.pj.gob.pe`) used to absolutize relative hrefs
 * @returns `ParsedPage` with ViewState, formId, rows, paginator position, and page-count hints
 */
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
