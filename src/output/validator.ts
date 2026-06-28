import fs from 'fs';
import { logger } from '../logger.js';
import type { JudicialDocument } from '../types.js';

/**
 * Validates the JSONL output file after a scrape run.
 *
 * @remarks
 * Reads the first 10 lines of the JSONL file and checks that each required
 * field (`id`, `site`, `caseNumber`, `fetchedAt`) is non-null. Duplicate IDs
 * within the sample are also detected. Both conditions emit `logger.warn` and
 * do NOT throw — they are advisory warnings only. Validation is skipped
 * entirely when `dryRun` is `true` because no output file is produced.
 *
 * @param outputPath - Absolute path to the JSONL file produced by the run
 * @param total - Total records scraped; must be > 0 or the function throws
 * @param dryRun - When `true` logs a skip message and returns immediately
 * @returns `void` — side effects are limited to logger calls
 * @throws {Error} When `total` is 0 (`"VALIDATION FAILED: zero records scraped"`)
 */
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
