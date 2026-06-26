import { type AxiosResponse } from 'axios';
import { load as cheerioLoad } from 'cheerio';
import { logger } from '../logger.js';
import type { $Root, ParsedPage, Session } from '../models/internalTypes.js';
import { absorbCookies, cookieHeader } from '../session/cookies.js';
import { fetchStartPage } from '../session/session.js';
import { isRateLimited } from '../session/rateLimit.js';
import { extractPartialResponse } from './partialResponse.js';

export const buildPaginationBody = (page: ParsedPage, targetPageIndex: number, rowsPerPage: number): string => {
  const paginatorId = page.paginatorId ?? `${page.formId}:j_idt_paginator`;
  const params: [string, string][] = [
    ['javax.faces.partial.ajax', 'true'],
    ['javax.faces.source', paginatorId],
    ['javax.faces.partial.execute', paginatorId],
    ['javax.faces.partial.render', page.formId],
    ['javax.faces.behavior.event', 'page'],
    [`${paginatorId}_pagination`, 'true'],
    [`${paginatorId}_first`, String(targetPageIndex * rowsPerPage)],
    [`${paginatorId}_rows`, String(rowsPerPage)],
    [`${paginatorId}_page`, String(targetPageIndex)],
    [page.formId, page.formId],
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
): Promise<{ $: $Root; newViewState: string | null }> => {
  const body = buildPaginationBody(page, targetPageIndex, rowsPerPage);

  const resp: AxiosResponse<string> = await session.client.post(url, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': url,
      'Cookie': cookieHeader(session),
    },
  });

  absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
  if (isRateLimited(resp.data)) throw new Error(`Rate limited at page ${targetPageIndex}`);

  const { html, newViewState } = extractPartialResponse(resp.data);
  if (!html) {
    logger.warn('Partial response empty — falling back to full GET', { targetPage: targetPageIndex });
    return { $: await fetchStartPage(session, url), newViewState: null };
  }
  return { $: cheerioLoad(html), newViewState };
};
