import { logger } from '../logger.js';
import { SITES } from '../config.js';
import { fetchStartPage, makeSession } from '../session/session.js';

/**
 * Fetches the start page and parses all <option> values from the sector <select>.
 * Returns Record<sectorId, sectorName>. Falls back to config.search.sectors if empty.
 */
export const discoverSectors = async (site: string, proxy?: string | null): Promise<Record<string, string>> => {
  const config = SITES[site];
  if (!config.search?.sectorField) return {};

  const session = makeSession(config.baseUrl, proxy ?? undefined);
  const $ = await fetchStartPage(session, config.startUrl);

  const fieldId = config.search.sectorField;
  const fieldBase = fieldId.split(':').pop()!;

  const sectors: Record<string, string> = {};
  $(`select[id="${fieldId}"] option, select[id*="${fieldBase}"] option, select[name*="${fieldBase}"] option`)
    .each((_, el) => {
      const val = $(el).attr('value')?.trim() ?? '';
      const label = $(el).text().trim();
      if (val && label && !label.startsWith('-') && !label.startsWith('--')) {
        sectors[val] = label.toUpperCase();
      }
    });

  if (Object.keys(sectors).length > 0) {
    logger.info('Sectors discovered from live page', { site, sectors });
  } else {
    logger.warn('Sector discovery returned empty — falling back to config.sectors', { site });
    return config.search.sectors ?? {};
  }

  return sectors;
};
