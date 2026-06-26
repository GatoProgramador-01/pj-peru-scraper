import { type AxiosResponse } from 'axios';
import { load as cheerioLoad } from 'cheerio';
import { logger } from '../logger.js';
import type { ParsedPage, Session } from '../models/internalTypes.js';
import type { SiteConfig } from '../types.js';
import { currentPageNum, pageHasNext, parsePaginatorText } from '../parser/paginatorParser.js';
import { parsePage } from '../parser/pageParser.js';
import { parseRows } from '../parser/rowParser.js';
import { absorbCookies, cookieHeader } from '../session/cookies.js';
import { isRateLimited } from '../session/rateLimit.js';
import { extractPartialResponse } from './partialResponse.js';

export const submitSearch = async (
  session: Session,
  url: string,
  page: ParsedPage,
  config: SiteConfig,
  sectorId?: string | null,
): Promise<ParsedPage> => {
  if (!config.search) return page;

  const { buttonId, buttonValue, formId, fields, ajax, sectorField } = config.search;
  logger.info('Submitting search form', { buttonId, ajax, sectorId: sectorId ?? 'none' });

  let params: [string, string][];
  let extraHeaders: Record<string, string>;

  if (ajax) {
    params = [
      ['javax.faces.partial.ajax', 'true'],
      ['javax.faces.source', buttonId],
      ['javax.faces.partial.execute', formId],
      ['javax.faces.partial.render', formId],
      [formId, formId],
      ...Object.entries(fields),
    ];
    if (sectorId && sectorField) params.push([sectorField, sectorId]);
    params.push(['javax.faces.ViewState', page.viewState]);
    extraHeaders = { 'Faces-Request': 'partial/ajax', 'X-Requested-With': 'XMLHttpRequest' };
  } else {
    params = [
      [formId, formId],
      ...Object.entries(fields),
    ];
    if (sectorId && sectorField) params.push([sectorField, sectorId]);
    params.push([buttonId, buttonValue], ['javax.faces.ViewState', page.viewState]);
    extraHeaders = {};
  }

  const body = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const resp: AxiosResponse<string> = await session.client.post(url, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Referer': url,
      'Cookie': cookieHeader(session),
      ...extraHeaders,
    },
  });

  absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
  if (isRateLimited(resp.data)) throw new Error('Rate limited on search submit');

  if (ajax) {
    const { html, newViewState } = extractPartialResponse(resp.data);
    const $p = cheerioLoad(html ?? '<div></div>');
    const pag = parsePaginatorText($p);
    return {
      ...page,
      viewState: newViewState ?? page.viewState,
      rows: parseRows($p, config, config.baseUrl),
      hasNextPage: pageHasNext($p),
      currentPage: pag?.currentPage ?? currentPageNum($p),
      totalPages: pag?.totalPages ?? page.totalPages,
      totalRecords: pag?.totalRecords ?? page.totalRecords,
    };
  }

  const $full = cheerioLoad(resp.data);
  return parsePage($full, config, config.baseUrl);
};
