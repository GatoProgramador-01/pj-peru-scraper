// Expected record count: 1,000–50,000+ per site across all sectors
// Data source: PJ Peru jurisprudencia + OEFA TFA portals (JSF/PrimeFaces)
// Known fragile selectors: none — this module has no DOM selectors; all
// HTML coupling lives in sectorDiscovery.ts and sectorScraper.ts

import { logger } from '../logger.js';
import type { SectorContext, SectorResult } from '../models/scraperTypes.js';
import type { ScrapeOptions, SiteConfig } from '../types.js';
import { makeSession } from '../session/session.js';
import { sleep } from '../utils/delay.js';
import { discoverSectors } from './sectorDiscovery.js';
import { scrapeSector } from './sectorScraper.js';

/**
 * Resolves the ordered list of `[sectorId, sectorName]` pairs to scrape.
 *
 * @remarks
 * Sites without a sector dropdown are treated as a single unnamed sector
 * represented as `[null, null]`. Live discovery runs first against the portal;
 * `config.search.sectors` acts as the fallback when the live call returns
 * nothing (e.g. the portal is temporarily unreachable). If the caller passed
 * `opts.sectorId`, only that one sector is returned and discovery is still
 * attempted so the sector label can be resolved.
 *
 * @param config - Static site configuration; `config.search.sectorField`
 *   controls whether sector filtering is applicable
 * @param opts - Runtime scrape options; `opts.site`, `opts.proxy`, and
 *   `opts.sectorId` are consumed here
 * @returns Ordered pairs of `[sectorId, sectorName]` ready for sequential
 *   iteration; entries where the site has no sector filter are `[null, null]`
 */
export const resolveSectorsToRun = async (
  config: SiteConfig,
  opts: ScrapeOptions,
): Promise<Array<[string | null, string | null]>> => {
  // Sites without a sector dropdown are treated as a single unnamed sector.
  if (!config.search?.sectorField) return [[null, null]];

  const discovered = await discoverSectors(opts.site, opts.proxy);
  const sectors = Object.keys(discovered).length > 0 ? discovered : (config.search.sectors ?? {});

  if (opts.sectorId !== null) {
    // Caller requested one specific sector — ignore the rest.
    return [[opts.sectorId, sectors[opts.sectorId] ?? opts.sectorId]];
  }

  if (Object.keys(sectors).length > 0) {
    return Object.entries(sectors);
  }

  // Discovery returned nothing and config has no fallback — proceed without filter.
  logger.warn('No sectors found - scraping without sector filter');
  return [[null, null]];
};

/**
 * Returns `true` when the caller-requested document limit is already satisfied.
 *
 * @remarks
 * Called at the top of each sector-loop iteration so the orchestrator never
 * starts a new sector (and its warm-up HTTP roundtrips) when the global quota
 * is already met. A `null` limit means "no cap", so the function always returns
 * `false` in that case.
 *
 * @param totalScraped - Cumulative document count collected across all sectors
 *   so far in the current run
 * @param limit - Caller-requested maximum; `null` means unlimited
 * @returns `true` when `limit` is non-null and `totalScraped >= limit`
 *
 * @example
 * // Stop before launching a new sector when the cap is reached
 * if (hasReachedGlobalLimit(totalScraped, opts.limit)) break;
 *
 * @example
 * // Unlimited run — always returns false
 * hasReachedGlobalLimit(9999, null); // → false
 */
export const hasReachedGlobalLimit = (totalScraped: number, limit: number | null): boolean =>
  limit !== null && totalScraped >= limit;

/**
 * Runs `scrapeSector` for a single sector, retrying once if the first attempt
 * returns zero documents.
 *
 * @remarks
 * Transient JSF search POST sometimes returns 0 rows on the first attempt even
 * when results exist — a server-side race between the viewstate store and the
 * search handler. A single 5 s cooldown followed by a fresh session recovers in
 * practice. The retry is skipped when `opts.dryRun` is `true` to avoid false
 * negatives during dry-run validation (an empty result in dry-run is expected
 * and should not be masked by a retry).
 *
 * @param config - Static site configuration forwarded to `scrapeSector`
 * @param opts - Runtime scrape options; `opts.dryRun` gates the retry path
 * @param sectorCtx - Mutable sector-level context (metrics, events, limits)
 *   shared across all pages of this sector
 * @returns The aggregated `SectorResult` — either from the first attempt or
 *   from the retry if the first returned zero documents
 */
export const scrapeSectorWithRetry = async (
  config: SiteConfig,
  opts: ScrapeOptions,
  sectorCtx: SectorContext,
): Promise<SectorResult> => {
  const session = makeSession(config.baseUrl, opts.proxy);
  let result = await scrapeSector(session, config, opts, sectorCtx);

  if (result.count === 0 && !opts.dryRun) {
    logger.warn('Zero docs on first attempt — waiting 5s and retrying with fresh session', {
      sectorId: sectorCtx.sectorId,
      sectorName: sectorCtx.sectorName,
    });
    await sleep(5_000);
    const retrySession = makeSession(config.baseUrl, opts.proxy);
    result = await scrapeSector(retrySession, config, opts, sectorCtx);
  }

  return result;
};

/**
 * Inserts a random 5–10 s pause before the next sector begins scraping.
 *
 * @remarks
 * Back-to-back sector scrapes without any cooldown can exhaust the portal's
 * server-side session pool, triggering transient 429 or soft-block responses
 * for the first page of the following sector. Random jitter in the 5–10 s
 * window avoids a fixed, detectable inter-sector interval that some WAF
 * rate-limiters pattern-match on.
 *
 * @param next - The `[sectorId, sectorName]` pair that will be scraped after
 *   the pause; used only for the log message so operators can track progress
 * @returns A promise that resolves after the random pause completes
 */
export const pauseBetweenSectors = async (next: [string | null, string | null]): Promise<void> => {
  const pause = 5_000 + Math.floor(Math.random() * 5_000);
  logger.info(`Pausing ${Math.round(pause / 1000)}s before next sector: ${next[1] ?? next[0]}`, { pauseMs: pause });
  await sleep(pause);
};
