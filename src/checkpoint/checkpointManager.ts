import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import type { Checkpoint } from '../types.js';

const cpPath = (site: string, sectorId: string | null): string =>
  path.join('./output', sectorId ? `checkpoint_${site}_s${sectorId}.json` : `checkpoint_${site}.json`);

export const loadCheckpoint = (site: string, sectorId: string | null): { startPage: number; completed: boolean } => {
  try {
    const cp = JSON.parse(fs.readFileSync(cpPath(site, sectorId), 'utf8')) as Checkpoint;
    if (cp.completed) { logger.info('Sector already completed — skipping', { sectorId }); return { startPage: 0, completed: true }; }
    logger.info('Resuming from checkpoint', { sectorId, page: cp.lastPageIndex, scraped: cp.totalScraped });
    return { startPage: cp.lastPageIndex, completed: false };
  } catch {
    return { startPage: 0, completed: false };
  }
};

export const saveCheckpoint = (site: string, sectorId: string | null, pageIndex: number, total: number, completed = false): void => {
  const cp: Checkpoint = { site, sectorId, lastPageIndex: pageIndex, totalScraped: total, completed, updatedAt: new Date().toISOString() };
  fs.writeFileSync(cpPath(site, sectorId), JSON.stringify(cp, null, 2));
};
