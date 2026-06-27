import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import type { Checkpoint } from '../types.js';

const safePartition = (checkpointId?: string | null): string =>
  checkpointId ? `_${checkpointId.replace(/[^A-Za-z0-9_-]/g, '_')}` : '';

const cpPath = (site: string, sectorId: string | null, districtId?: string | null, checkpointId?: string | null): string => {
  const base = sectorId ? `checkpoint_${site}_s${sectorId}` : `checkpoint_${site}`;
  return path.join('./output', `${base}${districtId ? `_d${districtId}` : ''}${safePartition(checkpointId)}.json`);
};

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
