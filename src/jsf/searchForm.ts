import { type AxiosResponse } from 'axios';
import { load as cheerioLoad } from 'cheerio';
import { logger } from '../logger.js';
import type { ParsedPage, Session } from '../models/internalTypes.js';
import type { SearchFilter, SearchTarget } from '../models/jsfTypes.js';
import { currentPageNum, pageHasNext, parsePaginatorText } from '../parser/paginatorParser.js';
import { parsePage } from '../parser/pageParser.js';
import { parseRows } from '../parser/rowParser.js';
import { absorbCookies, cookieHeader } from '../session/cookies.js';
import { isRateLimited } from '../session/rateLimit.js';
import { extractPartialResponse } from './partialResponse.js';

const encodeFormBody = (params: [string, string][]): string =>
  params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

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

const logSearchSubmit = (target: SearchTarget, filter: SearchFilter): void => {
  const { buttonId, ajax } = target.config.search!;
  logger.info('Submitting search form', {
    buttonId,
    ajax,
    sectorId: filter.sectorId ?? 'none',
    districtId: filter.districtId ?? 'none',
    searchFields: filter.searchFields ?? {},
  });
};

const buildAjaxSearchParams = (target: SearchTarget, filter: SearchFilter): [string, string][] => {
  const { page, config } = target;
  const { buttonId, formId, fields, sectorField } = config.search!;
  const params: [string, string][] = [
    ['javax.faces.partial.ajax', 'true'],
    ['javax.faces.source', buttonId],
    ['javax.faces.partial.execute', formId],
    ['javax.faces.partial.render', formId],
    [formId, formId],
    ...Object.entries(fields),
  ];
  appendSearchOverrides(params, sectorField, filter);
  params.push(['javax.faces.ViewState', page.viewState]);
  return params;
};

const buildClassicSearchParams = (target: SearchTarget, filter: SearchFilter): [string, string][] => {
  const { page, config } = target;
  const { buttonId, buttonValue, formId, fields, sectorField } = config.search!;
  const params: [string, string][] = [
    [formId, formId],
    ...Object.entries(fields),
  ];
  appendSearchOverrides(params, sectorField, filter);
  params.push([buttonId, buttonValue], ['javax.faces.ViewState', page.viewState]);
  return params;
};

const buildSearchBody = (target: SearchTarget, filter: SearchFilter): string =>
  encodeFormBody(
    target.config.search!.ajax
      ? buildAjaxSearchParams(target, filter)
      : buildClassicSearchParams(target, filter),
  );

const ajaxHeaders = (target: SearchTarget): Record<string, string> =>
  target.config.search!.ajax
    ? { 'Faces-Request': 'partial/ajax', 'X-Requested-With': 'XMLHttpRequest' }
    : {};

const shouldCaptureRedirect = (target: SearchTarget): boolean =>
  Boolean(target.config.resultsUrl);

const postSearchForm = (
  session: Session,
  target: SearchTarget,
  body: string,
): Promise<AxiosResponse<string>> =>
  session.client.post(target.url, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Referer': target.url,
      'Cookie': cookieHeader(session),
      ...ajaxHeaders(target),
    },
    ...(shouldCaptureRedirect(target) ? { maxRedirects: 0, validateStatus: (s: number) => s < 400 } : {}),
  });

const isRedirectResponse = (resp: AxiosResponse<string>): boolean =>
  resp.status === 301 || resp.status === 302 || resp.status === 303;

const redirectLocation = (resp: AxiosResponse<string>): string => {
  const location = resp.headers['location'] as string | undefined;
  if (!location) throw new Error('Search redirect missing Location header');
  return location;
};

const forceHttpsRedirect = (location: string): string =>
  location.replace(/^http:\/\//i, 'https://');

const stripUrlState = (url: string): string =>
  url.split('?')[0].split(';')[0];

const followSearchRedirect = async (
  session: Session,
  target: SearchTarget,
  location: string,
): Promise<ParsedPage> => {
  const httpsLocation = forceHttpsRedirect(location);
  logger.info('Following search redirect', { from: location, to: httpsLocation });
  const resp: AxiosResponse<string> = await session.client.get(httpsLocation, {
    headers: { 'Cookie': cookieHeader(session), 'Referer': target.url },
  });
  absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
  if (isRateLimited(resp.data)) throw new Error('Rate limited on search redirect follow');
  const parsed = parsePage(cheerioLoad(resp.data), target.config, target.config.baseUrl);
  return { ...parsed, activeUrl: stripUrlState(httpsLocation) };
};

const handleSearchRedirect = (
  session: Session,
  target: SearchTarget,
  resp: AxiosResponse<string>,
): Promise<ParsedPage> | null =>
  shouldCaptureRedirect(target) && isRedirectResponse(resp)
    ? followSearchRedirect(session, target, redirectLocation(resp))
    : null;

const parseAjaxSearchResponse = (target: SearchTarget, xml: string): ParsedPage => {
  const { page, config } = target;
  const { html, newViewState } = extractPartialResponse(xml);
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
};

const parseSearchResponse = (target: SearchTarget, html: string): ParsedPage =>
  target.config.search!.ajax
    ? parseAjaxSearchResponse(target, html)
    : parsePage(cheerioLoad(html), target.config, target.config.baseUrl);

export const submitSearch = async (
  session: Session,
  target: SearchTarget,
  filter: SearchFilter = {},
): Promise<ParsedPage> => {
  if (!target.config.search) return target.page;

  logSearchSubmit(target, filter);
  const resp = await postSearchForm(session, target, buildSearchBody(target, filter));
  absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);

  const redirectedPage = await handleSearchRedirect(session, target, resp);
  if (redirectedPage) return redirectedPage;

  if (isRateLimited(resp.data)) throw new Error('Rate limited on search submit');
  return parseSearchResponse(target, resp.data);
};
