import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import type { Checkpoint } from '../types.js';

/** Sanitize checkpointId to a safe filename segment, or return empty string. */
const safePartition = (checkpointId?: string | null): string =>
  checkpointId ? `_${checkpointId.replace(/[^A-Za-z0-9_-]/g, '_')}` : '';

/** Resolve the checkpoint JSON file path for the given selector combination. */
const cpPath = (site: string, sectorId: string | null, districtId?: string | null, checkpointId?: string | null): string => {
  const base = sectorId ? `checkpoint_${site}_s${sectorId}` : `checkpoint_${site}`;
  return path.join('./output', `${base}${districtId ? `_d${districtId}` : ''}${safePartition(checkpointId)}.json`);
};

/**
 * Load a checkpoint file and return the page to resume from.
 *
 * @remarks
 * File path convention:
 * `output/checkpoint_<site>[_s<sectorId>][_d<districtId>][_<checkpointId>].json`
 *
 * When the file does not exist (fresh start) the catch block silently returns
 * `{ startPage: 0, completed: false }`. When `completed` is `true` in the
 * file, the sector is skipped entirely by `--resume` logic without re-scraping
 * any pages.
 *
 * @param site - Site key (e.g. `"oefa"`, `"pj"`)
 * @param sectorId - Sector identifier, or `null` for sites without sectors
 * @param districtId - Optional district identifier appended as `_d<id>`
 * @param checkpointId - Optional arbitrary partition key appended as `_<id>`
 * @returns `startPage` index to begin pagination from, and `completed` flag
 */
export const loadCheckpoint = (
  site: string,
  sectorId: string | null,
  districtId?: string | null,
  checkpointId?: string | null,
): { startPage: number; completed: boolean } => {
  try {
    const cp = JSON.parse(fs.readFileSync(cpPath(site, sectorId, districtId, checkpointId), 'utf8')) as Checkpoint;
    if (cp.completed) {
      logger.info('Sector already completed - skipping', { sectorId, districtId, checkpointId });
      return { startPage: 0, completed: true };
    }
    logger.info('Resuming from checkpoint', { sectorId, districtId, checkpointId, page: cp.lastPageIndex, scraped: cp.totalScraped });
    return { startPage: cp.lastPageIndex, completed: false };
  } catch {
    return { startPage: 0, completed: false };
  }
};

/**
 * Persist the current scraping position to a checkpoint JSON file.
 *
 * @remarks
 * Writes atomically via a single `writeFileSync` call — no partial writes.
 * Set `completed = true` after a sector finishes so that `--resume` can
 * detect and skip it without re-checking page counts. The `updatedAt` field
 * is always set to the current ISO timestamp.
 *
 * @param site - Site key matching the one used in `loadCheckpoint`
 * @param sectorId - Sector identifier, or `null` for sites without sectors
 * @param pageIndex - Last page index successfully scraped (0-based)
 * @param total - Cumulative count of documents scraped so far
 * @param completed - Pass `true` when the sector is fully done; enables `--resume` skip
 * @param districtId - Optional district identifier; must match `loadCheckpoint` call
 * @param checkpointId - Optional partition key; must match `loadCheckpoint` call
 * @returns void
 */
export const saveCheckpoint = (
  site: string,
  sectorId: string | null,
  pageIndex: number,
  total: number,
  completed = false,
  districtId?: string | null,
  checkpointId?: string | null,
): void => {
  const cp: Checkpoint = { site, sectorId, lastPageIndex: pageIndex, totalScraped: total, completed, updatedAt: new Date().toISOString() };
  fs.writeFileSync(cpPath(site, sectorId, districtId, checkpointId), JSON.stringify(cp, null, 2));
};
