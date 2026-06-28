/**
 * tests/scraper/pdfBatch.test.ts
 *
 * Unit tests for src/scraper/pdfBatch.ts
 *
 * Isolation strategy:
 *  - fs is vi.mock'd — mkdirSync never touches the real filesystem.
 *  - downloader module is vi.mock'd — no network calls.
 *  - delay module is vi.mock'd — jitter resolves immediately.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs');
vi.mock('../../src/pdf/downloader.js', () => ({
  downloadPdf: vi.fn(),
  downloadJsfActionPdf: vi.fn(),
}));
vi.mock('../../src/utils/delay.js', () => ({
  jitter: vi.fn().mockResolvedValue(undefined),
}));

import fs from 'fs';
import { downloadPdf, downloadJsfActionPdf } from '../../src/pdf/downloader.js';
import { emptyPdfStats, downloadPagePdfs } from '../../src/scraper/pdfBatch.js';
import { createRunMetrics } from '../../src/models/metrics.js';
import type { JudicialDocument, SiteConfig } from '../../src/types.js';
import type { Session, ParsedRow } from '../../src/models/internalTypes.js';
import type { PdfBatchInput, PdfBatchOptions } from '../../src/models/pdfTypes.js';
import type { PdfDownloadResult } from '../../src/models/metrics.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeDoc = (overrides: Partial<JudicialDocument> = {}): JudicialDocument => ({
  id: 'TEST_DOC_1',
  site: 'pj-peru',
  sector: null,
  caseNumber: 'EXP-001',
  court: null,
  date: '2024-01-01',
  summary: null,
  resolution: null,
  tipoRecurso: null,
  sumilla: null,
  palabrasClave: null,
  fallo: null,
  jueces: null,
  proceso: null,
  distritoJudicialProcedencia: null,
  expedienteProcedencia: null,
  fechaResolucionProcedencia: null,
  falloProcedencia: null,
  pdfUrl: null,
  pdfLocalPath: null,
  rawCells: [],
  pageIndex: 0,
  rowIndex: 0,
  fetchedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const makeRow = (overrides: Partial<ParsedRow> = {}): ParsedRow => ({
  cells: [],
  pdfUrl: null,
  pdfJsfAction: null,
  ...overrides,
});

const makeSession = (): Session => ({
  client: {} as any,
  cookies: new Map(),
  baseUrl: 'http://example.com',
});

const makeConfig = (): SiteConfig => ({
  name: 'test',
  baseUrl: 'http://example.com',
  startUrl: 'http://example.com/start',
  rowParser: 'table',
  columns: {} as any,
  selectors: {} as any,
  timing: {
    pageDelayMs: [0, 0],
    pdfDelayMs: [0, 0],
    retryWaitMs: [0, 0, 0],
    navigationTimeoutMs: 5000,
    selectorTimeoutMs: 5000,
  },
});

const makeResult = (status: PdfDownloadResult['status']): PdfDownloadResult => ({
  status,
  localPath: status === 'downloaded' || status === 'skippedExisting' ? '/pdfs/doc.pdf' : null,
  latencyMs: 0,
});

const makeBatchInput = (
  docs: JudicialDocument[],
  rows: ParsedRow[],
): PdfBatchInput => ({
  docs,
  rows,
  viewState: '__viewState__',
});

const makeBatchOptions = (
  overrides: Partial<PdfBatchOptions> = {},
): PdfBatchOptions => ({
  pdfDir: '/tmp/pdfs',
  pdfConcurrency: 10,
  metrics: createRunMetrics(),
  failedPdfs: [],
  ...overrides,
});

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
});

// ─── emptyPdfStats ────────────────────────────────────────────────────────────

describe('emptyPdfStats', () => {
  it('returns an object with all 5 counters set to 0', () => {
    const stats = emptyPdfStats();
    expect(stats.pdfDownloadedThisPage).toBe(0);
    expect(stats.pdfFailedThisPage).toBe(0);
    expect(stats.pdfMissingThisPage).toBe(0);
    expect(stats.pdfConfidentialThisPage).toBe(0);
    expect(stats.pdfSkippedExistingThisPage).toBe(0);
  });
});

// ─── downloadPagePdfs — direct URL case ───────────────────────────────────────

describe('downloadPagePdfs — direct URL', () => {
  it('calls downloadPdf (not downloadJsfActionPdf) when doc has pdfUrl', async () => {
    const doc = makeDoc({ pdfUrl: 'http://example.com/doc.pdf' });
    const row = makeRow();
    vi.mocked(downloadPdf).mockResolvedValue(makeResult('downloaded'));

    await downloadPagePdfs(
      makeSession(), makeConfig(),
      makeBatchInput([doc], [row]),
      makeBatchOptions(),
    );

    expect(downloadPdf).toHaveBeenCalledOnce();
    expect(downloadJsfActionPdf).not.toHaveBeenCalled();
  });

  it('increments pdfDownloadedThisPage and metrics.totalPdfDownloaded on downloaded result', async () => {
    const doc = makeDoc({ pdfUrl: 'http://example.com/doc.pdf' });
    vi.mocked(downloadPdf).mockResolvedValue(makeResult('downloaded'));

    const options = makeBatchOptions();
    const stats = await downloadPagePdfs(
      makeSession(), makeConfig(),
      makeBatchInput([doc], [makeRow()]),
      options,
    );

    expect(stats.pdfDownloadedThisPage).toBe(1);
    expect(options.metrics.totalPdfDownloaded).toBe(1);
  });

  it('increments pdfSkippedExistingThisPage and metrics.totalSkippedExisting on skippedExisting result', async () => {
    const doc = makeDoc({ pdfUrl: 'http://example.com/doc.pdf' });
    vi.mocked(downloadPdf).mockResolvedValue(makeResult('skippedExisting'));

    const options = makeBatchOptions();
    const stats = await downloadPagePdfs(
      makeSession(), makeConfig(),
      makeBatchInput([doc], [makeRow()]),
      options,
    );

    expect(stats.pdfSkippedExistingThisPage).toBe(1);
    expect(options.metrics.totalSkippedExisting).toBe(1);
  });

  it('increments pdfFailedThisPage, adds to failedPdfs, increments metrics.totalPdfFailed on failedDownload result', async () => {
    const doc = makeDoc({ pdfUrl: 'http://example.com/doc.pdf' });
    const failResult: PdfDownloadResult = { status: 'failedDownload', localPath: null, latencyMs: 0, error: 'timeout' };
    vi.mocked(downloadPdf).mockResolvedValue(failResult);

    const options = makeBatchOptions();
    const stats = await downloadPagePdfs(
      makeSession(), makeConfig(),
      makeBatchInput([doc], [makeRow()]),
      options,
    );

    expect(stats.pdfFailedThisPage).toBe(1);
    expect(options.failedPdfs).toHaveLength(1);
    expect(options.metrics.totalPdfFailed).toBe(1);
  });
});

// ─── downloadPagePdfs — confidential case ─────────────────────────────────────

describe('downloadPagePdfs — confidential', () => {
  it('makes no HTTP call; increments pdfMissingThisPage and pdfConfidentialThisPage; adds to failedPdfs', async () => {
    const doc = makeDoc({ pdfUrl: null, rawCells: ['EXP-001', 'Confidencial - documento reservado'] });
    const row = makeRow({ pdfJsfAction: null });

    const options = makeBatchOptions();
    const stats = await downloadPagePdfs(
      makeSession(), makeConfig(),
      makeBatchInput([doc], [row]),
      options,
    );

    expect(downloadPdf).not.toHaveBeenCalled();
    expect(downloadJsfActionPdf).not.toHaveBeenCalled();
    expect(stats.pdfMissingThisPage).toBe(1);
    expect(stats.pdfConfidentialThisPage).toBe(1);
    expect(options.failedPdfs).toHaveLength(1);
    expect(options.failedPdfs[0].status).toBe('confidential');
  });
});

// ─── downloadPagePdfs — JSF action case ───────────────────────────────────────

describe('downloadPagePdfs — JSF action', () => {
  it('calls downloadJsfActionPdf (not downloadPdf) when doc has no pdfUrl but row has pdfJsfAction', async () => {
    const doc = makeDoc({ pdfUrl: null });
    const row = makeRow({
      pdfJsfAction: { componentId: 'form:btn', paramUuid: 'abc-123' },
    });
    vi.mocked(downloadJsfActionPdf).mockResolvedValue(makeResult('downloaded'));

    await downloadPagePdfs(
      makeSession(), makeConfig(),
      makeBatchInput([doc], [row]),
      makeBatchOptions(),
    );

    expect(downloadJsfActionPdf).toHaveBeenCalledOnce();
    expect(downloadPdf).not.toHaveBeenCalled();
  });
});

// ─── downloadPagePdfs — missing source case ───────────────────────────────────

describe('downloadPagePdfs — missing source', () => {
  it('increments pdfMissingThisPage when doc has no pdfUrl, no pdfJsfAction, and rawCells contain no "confidencial"', async () => {
    const doc = makeDoc({ pdfUrl: null, rawCells: ['EXP-001', 'normal data'] });
    const row = makeRow({ pdfJsfAction: null });

    const options = makeBatchOptions();
    const stats = await downloadPagePdfs(
      makeSession(), makeConfig(),
      makeBatchInput([doc], [row]),
      options,
    );

    expect(downloadPdf).not.toHaveBeenCalled();
    expect(downloadJsfActionPdf).not.toHaveBeenCalled();
    expect(stats.pdfMissingThisPage).toBe(1);
    expect(stats.pdfConfidentialThisPage).toBe(0);
  });
});

// ─── downloadPagePdfs — onProgress callback ───────────────────────────────────

describe('downloadPagePdfs — onProgress callback', () => {
  it('calls onProgress with correct (done, total) counts as downloads complete', async () => {
    const docs = [
      makeDoc({ id: 'DOC_1', pdfUrl: 'http://example.com/1.pdf' }),
      makeDoc({ id: 'DOC_2', pdfUrl: 'http://example.com/2.pdf' }),
      makeDoc({ id: 'DOC_3', pdfUrl: 'http://example.com/3.pdf' }),
    ];
    const rows = [makeRow(), makeRow(), makeRow()];

    vi.mocked(downloadPdf).mockResolvedValue(makeResult('downloaded'));
    const onProgress = vi.fn();

    await downloadPagePdfs(
      makeSession(), makeConfig(),
      makeBatchInput(docs, rows),
      makeBatchOptions({ onProgress, pdfConcurrency: 10 }),
    );

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 3);
    expect(onProgress).toHaveBeenNthCalledWith(3, 3, 3);
  });
});

// ─── downloadPagePdfs — concurrency ───────────────────────────────────────────

describe('downloadPagePdfs — concurrency', () => {
  it('processes 3 docs in 2 chunks when pdfConcurrency is 2 (first chunk: 2, second chunk: 1)', async () => {
    const docs = [
      makeDoc({ id: 'DOC_1', pdfUrl: 'http://example.com/1.pdf' }),
      makeDoc({ id: 'DOC_2', pdfUrl: 'http://example.com/2.pdf' }),
      makeDoc({ id: 'DOC_3', pdfUrl: 'http://example.com/3.pdf' }),
    ];
    const rows = [makeRow(), makeRow(), makeRow()];

    // Track call order to verify chunked execution
    const callOrder: string[] = [];
    vi.mocked(downloadPdf).mockImplementation((_session, doc) => {
      callOrder.push(doc.id);
      return Promise.resolve(makeResult('downloaded'));
    });

    const { jitter } = await import('../../src/utils/delay.js');

    await downloadPagePdfs(
      makeSession(), makeConfig(),
      makeBatchInput(docs, rows),
      makeBatchOptions({ pdfConcurrency: 2 }),
    );

    // All 3 docs downloaded
    expect(downloadPdf).toHaveBeenCalledTimes(3);
    // jitter called once between chunks (not after the last chunk)
    expect(jitter).toHaveBeenCalledTimes(1);
    // First 2 docs processed before the third
    expect(callOrder.indexOf('DOC_1')).toBeLessThan(callOrder.indexOf('DOC_3'));
    expect(callOrder.indexOf('DOC_2')).toBeLessThan(callOrder.indexOf('DOC_3'));
  });
});
