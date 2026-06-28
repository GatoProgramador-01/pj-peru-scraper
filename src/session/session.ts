import https from 'https';
import http from 'http';
import axios, { type AxiosResponse } from 'axios';
import { load as cheerioLoad } from 'cheerio';
import { logger } from '../logger.js';
import type { $Root, Session } from '../models/internalTypes.js';
import { absorbCookies, cookieHeader } from './cookies.js';
import { isRateLimited } from './rateLimit.js';

// Enough sockets to support 34 parallel district workers without queuing.
// Node.js default of 5 per host serializes workers behind a tiny connection pool.
const MAX_SOCKETS = 64;
const SESSION_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
// Chrome 125 on Windows — matches expected traffic from Peru-based users.
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const parseProxy = (url: string) => {
  const u = new URL(url);
  return {
    protocol: u.protocol.replace(':', '') as 'http' | 'https',
    host: u.hostname,
    port: parseInt(u.port, 10),
    auth: u.username ? { username: u.username, password: u.password } : undefined,
  };
};

const makeAgents = () => ({
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS }),
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS }),
});

/**
 * Creates a reusable axios client with a shared cookie jar and keep-alive agents.
 * MAX_SOCKETS=64 prevents Node's 5-socket-per-host default from serializing
 * parallel workers (Suprema uses 12, Superior up to 34) behind a queue.
 * The Chrome 125 UA matches the user-agent profile expected by the Peru judiciary
 * portal — requests with a bot-looking UA are rejected before hitting the JSF layer.
 */
export const makeSession = (baseUrl: string, proxy?: string | null): Session => ({
  client: axios.create({
    baseURL: baseUrl,
    timeout: SESSION_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    },
    ...makeAgents(),
    ...(proxy ? { proxy: parseProxy(proxy) } : {}),
  }),
  cookies: new Map(),
  baseUrl,
});

/**
 * GETs the portal start page, absorbs session cookies, and returns a Cheerio root.
 * This must run before any search POST — the server uses this request to allocate
 * a JSF ViewState slot and issue the JSESSIONID cookie.
 */
export const fetchStartPage = async (session: Session, url: string): Promise<$Root> => {
  logger.info('GET start page', { url });
  const resp: AxiosResponse<string> = await session.client.get(url, {
    headers: { Referer: session.baseUrl, Cookie: cookieHeader(session) },
  });
  absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
  if (isRateLimited(resp.data)) throw new Error('Rate limited on initial GET');
  return cheerioLoad(resp.data);
};
