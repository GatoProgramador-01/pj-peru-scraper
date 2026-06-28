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
  if (!html) {
    // Throw so withRetry retries the AJAX request: falling back to a full GET
    // returns the empty search form (0 rows) and silently truncates the run.
    throw new Error(`Partial AJAX response empty at page ${targetPageIndex} - retrying`);
  }
  return html;
};

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
