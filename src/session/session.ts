import https from 'https';
import http from 'http';
import axios, { type AxiosResponse } from 'axios';
import { load as cheerioLoad } from 'cheerio';
import { logger } from '../logger.js';
import type { $Root, Session } from '../models/internalTypes.js';
import { absorbCookies, cookieHeader } from './cookies.js';
import { isRateLimited } from './rateLimit.js';

const parseProxy = (url: string) => {
  const u = new URL(url);
  return {
    protocol: u.protocol.replace(':', '') as 'http' | 'https',
    host: u.hostname,
    port: parseInt(u.port, 10),
    auth: u.username ? { username: u.username, password: u.password } : undefined,
  };
};

// Node.js default HTTPS agent allows only 5 sockets per host.
// With 20+ parallel district workers all hitting the same host,
// that queues 15+ workers behind 5 open connections. Use per-session
// agents with keepAlive and high socket ceiling instead.
const makeAgents = () => ({
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 64 }),
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 64 }),
});

export const makeSession = (baseUrl: string, proxy?: string | null): Session => ({
  client: axios.create({
    baseURL: baseUrl,
    timeout: 30_000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
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

export const fetchStartPage = async (session: Session, url: string): Promise<$Root> => {
  logger.info('GET start page', { url });
  const resp: AxiosResponse<string> = await session.client.get(url, {
    headers: { Referer: session.baseUrl, Cookie: cookieHeader(session) },
  });
  absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
  if (isRateLimited(resp.data)) throw new Error('Rate limited on initial GET');
  return cheerioLoad(resp.data);
};
