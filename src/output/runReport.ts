import fs from 'fs';
import path from 'path';
import type { PageEvent, RunMetrics } from '../models/metrics.js';
import type { ScrapeOptions } from '../types.js';

export interface RunReportInput {
  opts: ScrapeOptions;
  metrics: RunMetrics;
  pageEvents: PageEvent[];
  elapsedMs: number;
  docsPerMinute: number;
  pdfsPerMinute: number;
  avgPdfLatencyMs: number;
  totalScraped: number;
}

const duration = (ms: number): string => {
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
};

const writeJson = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
};

const writeJsonl = (filePath: string, rows: unknown[]): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
};

export const writeRunReports = ({
  opts,
  metrics,
  pageEvents,
  elapsedMs,
  docsPerMinute,
  pdfsPerMinute,
  avgPdfLatencyMs,
  totalScraped,
}: RunReportInput): { summaryPath: string; pageEventsPath: string; markdownPath: string } => {
  const outputDir = path.dirname(opts.outputPath);
  const summaryPath = path.join(outputDir, 'run-summary.json');
  const pageEventsPath = path.join(outputDir, 'page-events.jsonl');
  const markdownPath = path.join(outputDir, 'run-report.md');
  const failedPdfPath = opts.failedPdfPath ?? path.join(outputDir, 'failed-pdfs.json');

  const summary = {
    run: {
      site: opts.site,
      outputPath: opts.outputPath,
      pdfDir: opts.pdfDir,
      failedPdfPath,
      targetDocuments: opts.limit,
      totalScraped,
      elapsedMs,
      elapsedTime: duration(elapsedMs),
      finishedAt: new Date().toISOString(),
    },
    metrics: {
      totalDocumentsCollected: metrics.totalDocumentsCollected,
      totalPdfCandidates: metrics.totalPdfCandidates,
      totalPdfDownloaded: metrics.totalPdfDownloaded,
      totalSkippedExisting: metrics.totalSkippedExisting,
      totalPdfAvailable: metrics.totalPdfDownloaded + metrics.totalSkippedExisting,
      totalPdfFailed: metrics.totalPdfFailed,
      totalPdfMissing: metrics.totalPdfMissing,
      totalPdfConfidential: metrics.totalPdfConfidential,
      total429: metrics.total429,
      totalRetries: metrics.totalRetries,
      docsPerMinute,
      pdfsPerMinute,
      avgPdfLatencyMs,
    },
    interpretation: {
      allRecordsHaveDownloadablePdf: metrics.totalPdfMissing === 0 && metrics.totalPdfFailed === 0,
      note: 'Confidential records are expected to have no downloadable PDF in OEFA and are counted separately from failed downloads.',
    },
    artifacts: {
      jsonl: opts.outputPath,
      pdfDir: opts.pdfDir,
      failedPdfs: failedPdfPath,
      pageEvents: pageEventsPath,
      markdownReport: markdownPath,
    },
  };

  writeJson(summaryPath, summary);
  writeJsonl(pageEventsPath, pageEvents);

  const md = [
    '# Scrape Run Report',
    '',
    `- Site: ${opts.site}`,
    `- Target documents: ${opts.limit ?? 'all'}`,
    `- Documents collected: ${metrics.totalDocumentsCollected}`,
    `- Elapsed: ${duration(elapsedMs)}`,
    `- Output JSONL: \`${opts.outputPath}\``,
    `- PDF directory: \`${opts.pdfDir ?? 'none'}\``,
    `- Failed/missing PDF report: \`${failedPdfPath}\``,
    '',
    '## PDF Outcome',
    '',
    `- PDF candidates: ${metrics.totalPdfCandidates}`,
    `- Downloaded now: ${metrics.totalPdfDownloaded}`,
    `- Already present: ${metrics.totalSkippedExisting}`,
    `- Available locally: ${metrics.totalPdfDownloaded + metrics.totalSkippedExisting}`,
    `- Failed downloads: ${metrics.totalPdfFailed}`,
    `- Missing/unavailable: ${metrics.totalPdfMissing}`,
    `- Confidential: ${metrics.totalPdfConfidential}`,
    '',
    'Confidential OEFA rows are expected to have no downloadable PDF. They are not treated as downloader failures.',
    '',
    '## Rate Limit',
    '',
    `- HTTP 429 observed: ${metrics.total429}`,
    `- Retries: ${metrics.totalRetries}`,
    '',
    '## Page Events',
    '',
    `Structured page events are in \`${pageEventsPath}\`.`,
    '',
  ].join('\n');

  fs.writeFileSync(markdownPath, md);

  return { summaryPath, pageEventsPath, markdownPath };
};
