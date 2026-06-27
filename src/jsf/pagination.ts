import { type AxiosResponse } from 'axios';
import { load as cheerioLoad } from 'cheerio';
import type { $Root, ParsedPage, Session } from '../models/internalTypes.js';
import { absorbCookies, cookieHeader } from '../session/cookies.js';
import { isRateLimited } from '../session/rateLimit.js';
import { extractPartialResponse } from './partialResponse.js';

export const buildPaginationBody = (page: ParsedPage, targetPageIndex: number, rowsPerPage: number): string => {
  const paginatorId = page.paginatorId ?? `${page.formId}:j_idt_paginator`;
  const dataTableId = paginatorId.replace(/_paginator(?:_[^:]+)?$/, '');
  const params: [string, string][] = [
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
  return params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
};

/** RichFaces data-scroller pagination (pj-peru). Sends page number via spinner. */
export const buildRichFacesPaginationBody = (page: ParsedPage, targetPageIndex: number): string => {
  const scroller = 'formBuscador:data1';
  const params: [string, string][] = [
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
  return params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
};

export const fetchNextPage = async (
  session: Session,
  url: string,
  page: ParsedPage,
  targetPageIndex: number,
  rowsPerPage: number,
  useRichFaces = false,
): Promise<{ $: $Root; newViewState: string | null }> => {
  const postUrl = page.activeUrl ?? url;
  const body = useRichFaces
    ? buildRichFacesPaginationBody(page, targetPageIndex)
    : buildPaginationBody(page, targetPageIndex, rowsPerPage);

  const resp: AxiosResponse<string> = await session.client.post(postUrl, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': postUrl,
      'Cookie': cookieHeader(session),
    },
  });

  absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
  if (isRateLimited(resp.data)) throw new Error(`Rate limited at page ${targetPageIndex}`);

  const { html, newViewState } = extractPartialResponse(resp.data);
  if (!html) {
    // Throw so withRetry retries the AJAX request — falling back to a full GET returns
    // the empty search form (0 rows) which silently truncates the run.
    throw new Error(`Partial AJAX response empty at page ${targetPageIndex} — retrying`);
  }
  const fragment = html.trim().startsWith('<tr')
    ? `<table><tbody>${html}</tbody></table>`
    : html;
  return { $: cheerioLoad(fragment), newViewState };
};
