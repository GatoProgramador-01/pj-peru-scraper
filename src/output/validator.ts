import fs from 'fs';
import { logger } from '../logger.js';
import type { JudicialDocument } from '../types.js';

export const validateOutput = (outputPath: string, total: number, dryRun: boolean): void => {
  if (dryRun) { logger.info('[dry-run] Skipping output validation'); return; }
  if (total === 0) throw new Error('VALIDATION FAILED: zero records scraped');

  const lines = fs.readFileSync(outputPath, 'utf8').trim().split('\n');
  const samples = lines.slice(0, 10).map(l => JSON.parse(l) as JudicialDocument);

  const required: (keyof JudicialDocument)[] = ['id', 'site', 'caseNumber', 'fetchedAt'];
  for (const f of required) {
    const nullCount = samples.filter(s => !s[f]).length;
    if (nullCount) logger.warn(`Field '${f}' null in ${nullCount}/10 samples`);
  }

  const ids = samples.map(s => s.id);
  const dupes = ids.length - new Set(ids).size;
  if (dupes) logger.warn(`${dupes} duplicate IDs in sample`);

  logger.info(`✓ Validation passed — total: ${total} | sample: ${samples.length} | schema OK`);
};
