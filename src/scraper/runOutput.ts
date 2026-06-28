import fs from 'fs';
import path from 'path';
import type { PdfFailure } from '../models/metrics.js';
import type { JudicialDocument, ScrapeOptions } from '../types.js';

/** Writes the failed-PDF report JSON to disk, creating parent directories as needed. */
const writeFailedPdfReport = (failedPdfPath: string, failedPdfs: PdfFailure[]): void => {
  fs.mkdirSync(path.dirname(failedPdfPath), { recursive: true });
  fs.writeFileSync(failedPdfPath, JSON.stringify(failedPdfs, null, 2));
};

/**
 * Flushes all collected documents to JSONL and writes the PDF-failure report when needed.
 *
 * @remarks
 * Both writes are gated on `!opts.dryRun` — dry-run callers get no disk output.
 * The JSONL write is also skipped when `allDocs` is empty (avoids creating a zero-byte file).
 * The failed-PDF path falls back to `failed-pdfs.json` alongside the main JSONL when
 * `opts.failedPdfPath` is not set.
 *
 * @param opts - Scrape options; `opts.outputPath`, `opts.failedPdfPath`, and `opts.dryRun` are read
 * @param allDocs - All documents collected across all sectors in this run
 * @param failedPdfs - PDF failures accumulated during the run; written only when non-empty
 */
export const writeScrapeOutput = (
  opts: ScrapeOptions,
  allDocs: JudicialDocument[],
  failedPdfs: PdfFailure[],
): void => {
  if (!opts.dryRun && allDocs.length > 0) {
    fs.writeFileSync(opts.outputPath, allDocs.map(d => JSON.stringify(d)).join('\n') + '\n');
  }
  if (failedPdfs.length > 0 && !opts.dryRun) {
    const failedPdfPath = opts.failedPdfPath ?? path.join(path.dirname(opts.outputPath), 'failed-pdfs.json');
    writeFailedPdfReport(failedPdfPath, failedPdfs);
  }
};
