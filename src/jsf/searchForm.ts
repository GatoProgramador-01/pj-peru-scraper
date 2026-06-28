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

/** Identifies the portal endpoint and current page state required before submitting a search form. */
export interface SearchTarget {
  url: string;
  page: ParsedPage;
  config: SiteConfig;
}

/** Optional runtime narrowing applied on top of static SearchConfig: sector, district, and field overrides. */
export interface SearchFilter {
  sectorId?: string | null;
  districtId?: string | null;
  searchFields?: Record<string, string>;
}

const appendSearchOverrides = (
  params: [string, string][],
  sectorField: string | undefined,
  filter: SearchFilter,
): void => {
  const { sectorId, districtId, searchFields } = filter;
  if (sectorId && sectorField) params.push([sectorField, sectorId]);
  if (districtId) params.push(['formBuscador:buDistrito', districtId]);
  if (searchFields) params.push(...Object.entries(searchFields));
};

export const submitSearch = async (
  session: Session,
  target: SearchTarget,
  filter: SearchFilter = {},
): Promise<ParsedPage> => {
  const { url, page, config } = target;
  if (!config.search) return page;

  const { buttonId, buttonValue, formId, fields, ajax, sectorField } = config.search;
  logger.info('Submitting search form', {
    buttonId,
    ajax,
    sectorId: filter.sectorId ?? 'none',
    districtId: filter.districtId ?? 'none',
    searchFields: filter.searchFields ?? {},
  });

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
    appendSearchOverrides(params, sectorField, filter);
    params.push(['javax.faces.ViewState', page.viewState]);
    extraHeaders = { 'Faces-Request': 'partial/ajax', 'X-Requested-With': 'XMLHttpRequest' };
  } else {
    params = [
      [formId, formId],
      ...Object.entries(fields),
    ];
    appendSearchOverrides(params, sectorField, filter);
    params.push([buttonId, buttonValue], ['javax.faces.ViewState', page.viewState]);
    extraHeaders = {};
  }

  const body = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  // For sites that redirect after search (e.g. pj-peru: inicio.xhtml → resultado.xhtml),
  // suppress auto-redirect so we can upgrade the HTTP location to HTTPS before following.
  const needsRedirectUpgrade = Boolean(config.resultsUrl);
  const resp: AxiosResponse<string> = await session.client.post(url, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Referer': url,
      'Cookie': cookieHeader(session),
      ...extraHeaders,
    },
    ...(needsRedirectUpgrade ? { maxRedirects: 0, validateStatus: (s: number) => s < 400 } : {}),
  });

  absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);

  // Handle 302 redirect → upgrade http→https and follow manually
  const isRedirect = resp.status === 301 || resp.status === 302 || resp.status === 303;
  if (needsRedirectUpgrade && isRedirect) {
    const location = resp.headers['location'] as string | undefined;
    if (!location) throw new Error('Search redirect missing Location header');
    const httpsLocation = location.replace(/^http:\/\//i, 'https://');
    logger.info('Following search redirect', { from: location, to: httpsLocation });
    const r2: AxiosResponse<string> = await session.client.get(httpsLocation, {
      headers: { 'Cookie': cookieHeader(session), 'Referer': url },
    });
    absorbCookies(session, r2.headers['set-cookie'] as string[] | undefined);
    if (isRateLimited(r2.data)) throw new Error('Rate limited on search redirect follow');
    const $full = cheerioLoad(r2.data);
    const parsed = parsePage($full, config, config.baseUrl);
    return { ...parsed, activeUrl: httpsLocation.split('?')[0].split(';')[0] };
  }

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
