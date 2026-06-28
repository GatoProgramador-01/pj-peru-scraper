import { type AxiosResponse } from 'axios';
import { load as cheerioLoad } from 'cheerio';
import type { $Root, ParsedPage, Session } from '../models/internalTypes.js';
import type { PaginationRequest } from '../models/jsfTypes.js';
import { absorbCookies, cookieHeader } from '../session/cookies.js';
import { isRateLimited } from '../session/rateLimit.js';
import { extractPartialResponse } from './partialResponse.js';

const encodeFormBody = (params: [string, string][]): string =>
  params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

const dataTableIdFromPaginator = (page: ParsedPage): string => {
  const paginatorId = page.paginatorId ?? `${page.formId}:j_idt_paginator`;
  return paginatorId.replace(/_paginator(?:_[^:]+)?$/, '');
};

// PrimeFaces AJAX pagination: posts form fields that identify the DataTable component,
// the target page offset (first row index), and the number of rows per page.
const primeFacesPaginationParams = (
  page: ParsedPage,
  targetPageIndex: number,
  rowsPerPage: number,
): [string, string][] => {
  const dataTableId = dataTableIdFromPaginator(page);
  return [
    ['javax.faces.partial.ajax', 'true'],
    ['javax.faces.source', dataTableId],
    ['javax.faces.partial.execute', dataTableId],
    ['javax.faces.partial.render', dataTableId],
    [page.formId, page.formId],
    [`${dataTableId}_pagination`, 'true'],
    [`${dataTableId}_first`, String(targetPageIndex * rowsPerPage)],
    [`${dataTableId}_rows`, String(rowsPerPage)],
    [`${dataTableId}_skipChildren`, 'true'],
    [`${dataTableId}_encodeFeature`, 'true'],
    ['javax.faces.ViewState', page.viewState],
  ];
};

export const buildPaginationBody = (page: ParsedPage, targetPageIndex: number, rowsPerPage: number): string =>
  encodeFormBody(primeFacesPaginationParams(page, targetPageIndex, rowsPerPage));

const richFacesDataScroller = (): string =>
  'formBuscador:data1';

// RichFaces AJAX pagination (pj-peru): posts via a DataScroller component, identified
// by its fixed ID 'formBuscador:data1'. Page is sent as a 1-based integer, not a row offset.
const richFacesPaginationParams = (page: ParsedPage, targetPageIndex: number): [string, string][] => {
  const scroller = richFacesDataScroller();
  return [
    ['javax.faces.partial.ajax', 'true'],
    ['javax.faces.source', scroller],
    ['javax.faces.partial.execute', scroller],
    ['javax.faces.partial.render', `${scroller} formBuscador:panel`],
    ['javax.faces.behavior.event', 'action'],
    ['org.richfaces.ajax.component', scroller],
    [page.formId, page.formId],
    [scroller, scroller],
    [`${scroller}:page`, String(targetPageIndex + 1)],
    ['javax.faces.ViewState', page.viewState],
  ];
};

/** RichFaces data-scroller pagination (pj-peru). Sends page number via spinner. */
export const buildRichFacesPaginationBody = (page: ParsedPage, targetPageIndex: number): string =>
  encodeFormBody(richFacesPaginationParams(page, targetPageIndex));

const paginationPostUrl = (fallbackUrl: string, page: ParsedPage): string =>
  page.activeUrl ?? fallbackUrl;

const buildPaginationRequestBody = (req: PaginationRequest): string => {
  const { page, targetPageIndex, rowsPerPage, useRichFaces = false } = req;
  return useRichFaces
    ? buildRichFacesPaginationBody(page, targetPageIndex)
    : buildPaginationBody(page, targetPageIndex, rowsPerPage);
};

const postPaginationRequest = (
  session: Session,
  postUrl: string,
  body: string,
): Promise<AxiosResponse<string>> =>
  session.client.post(postUrl, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': postUrl,
      'Cookie': cookieHeader(session),
    },
  });

const assertNotRateLimited = (html: string, targetPageIndex: number): void => {
  if (isRateLimited(html)) throw new Error(`Rate limited at page ${targetPageIndex}`);
};

const requirePartialHtml = (html: string | null, targetPageIndex: number): string => {
  // Throw — not return null — so withRetry retries the AJAX request. Returning null here
  // would silently treat an empty partial as end-of-results and truncate the run.
  if (!html) {
    // Throw so withRetry retries the AJAX request: falling back to a full GET
    // returns the empty search form (0 rows) and silently truncates the run.
    throw new Error(`Partial AJAX response empty at page ${targetPageIndex} - retrying`);
  }
  return html;
};

// RichFaces AJAX responses sometimes return bare <tr> elements without a parent <table>.
// Cheerio cannot parse a detached <tr>, so we wrap it before loading into the DOM.
const wrapLooseTableRows = (html: string): string =>
  html.trim().startsWith('<tr')
    ? `<table><tbody>${html}</tbody></table>`
    : html;

const parsePaginationPartial = (
  xml: string,
  targetPageIndex: number,
): { $: $Root; newViewState: string | null } => {
  const { html, newViewState } = extractPartialResponse(xml);
  const fragment = wrapLooseTableRows(requirePartialHtml(html, targetPageIndex));
  return { $: cheerioLoad(fragment), newViewState };
};

// Entry point for all paginator advances. Delegates to either PrimeFaces or RichFaces
// body builders based on req.useRichFaces, then posts the AJAX request and parses
// the partial-response XML into a cheerio root + refreshed ViewState.
export const fetchNextPage = async (
  session: Session,
  url: string,
  req: PaginationRequest,
): Promise<{ $: $Root; newViewState: string | null }> => {
  const postUrl = paginationPostUrl(url, req.page);
  const resp = await postPaginationRequest(session, postUrl, buildPaginationRequestBody(req));

  absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
  assertNotRateLimited(resp.data, req.targetPageIndex);
  return parsePaginationPartial(resp.data, req.targetPageIndex);
};
