import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRunMetrics, pdfFailureFromDocument } from '../../src/models/metrics.js';
import type { JudicialDocument } from '../../src/types.js';

/** Minimal JudicialDocument stub with only the fields pdfFailureFromDocument reads. */
const makeDoc = (overrides: Partial<JudicialDocument> = {}): JudicialDocument => ({
  id: 'pj-peru_EXP001_2024-01-15',
  site: 'pj-peru',
  sector: 'PENAL',
  caseNumber: 'EXP-001/2024',
  court: null,
  date: '2024-01-15',
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
  pdfUrl: 'https://example.com/doc.pdf',
  pdfLocalPath: null,
  pageIndex: 2,
  rowIndex: 5,
  fetchedAt: new Date().toISOString(),
  rawCells: [],
  ...overrides,
});

describe('createRunMetrics', () => {
  it('all numeric counters start at zero', () => {
    const m = createRunMetrics();
    expect(m.totalDocumentsCollected).toBe(0);
    expect(m.totalPdfCandidates).toBe(0);
    expect(m.totalPdfDownloaded).toBe(0);
    expect(m.totalPdfFailed).toBe(0);
    expect(m.totalPdfMissing).toBe(0);
    expect(m.totalPdfConfidential).toBe(0);
    expect(m.totalSkippedExisting).toBe(0);
    expect(m.total429).toBe(0);
    expect(m.totalRetries).toBe(0);
  });

  it('pdfLatencySamples is an empty array', () => {
    const m = createRunMetrics();
    expect(m.pdfLatencySamples).toEqual([]);
    expect(Array.isArray(m.pdfLatencySamples)).toBe(true);
  });

  it('startedAt is a recent timestamp (within 1 second of now)', () => {
    const before = Date.now();
    const m = createRunMetrics();
    const after = Date.now();
    expect(m.startedAt).toBeGreaterThanOrEqual(before);
    expect(m.startedAt).toBeLessThanOrEqual(after);
  });

  it('each call returns an independent object', () => {
    const a = createRunMetrics();
    const b = createRunMetrics();
    a.totalDocumentsCollected = 10;
    expect(b.totalDocumentsCollected).toBe(0);
    a.pdfLatencySamples.push(99);
    expect(b.pdfLatencySamples).toHaveLength(0);
  });
});

describe('pdfFailureFromDocument', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('maps id, site, sector, caseNumber, pdfUrl from doc', () => {
    const doc = makeDoc();
    const result = pdfFailureFromDocument(doc, 'failedDownload', 'HTTP 500');
    expect(result.id).toBe(doc.id);
    expect(result.site).toBe(doc.site);
    expect(result.sector).toBe(doc.sector);
    expect(result.caseNumber).toBe(doc.caseNumber);
    expect(result.pdfUrl).toBe(doc.pdfUrl);
  });

  it('maps pageIndex and rowIndex from doc', () => {
    const doc = makeDoc({ pageIndex: 7, rowIndex: 3 });
    const result = pdfFailureFromDocument(doc, 'missingPdfUrl', 'no url');
    expect(result.pageIndex).toBe(7);
    expect(result.rowIndex).toBe(3);
  });

  it('sets status and reason from arguments', () => {
    const doc = makeDoc();
    const result = pdfFailureFromDocument(doc, 'confidential', 'marked confidential');
    expect(result.status).toBe('confidential');
    expect(result.reason).toBe('marked confidential');
  });

  it('sets error field when provided', () => {
    const doc = makeDoc();
    const result = pdfFailureFromDocument(doc, 'failedDownload', 'network error', 'ECONNRESET');
    expect(result.error).toBe('ECONNRESET');
  });

  it('error field is undefined when not provided', () => {
    const doc = makeDoc();
    const result = pdfFailureFromDocument(doc, 'missingJsfAction', 'no jsf');
    expect(result.error).toBeUndefined();
  });

  it('attemptedAt is an ISO string matching the current time', () => {
    const now = new Date('2024-06-15T12:00:00.000Z');
    vi.setSystemTime(now);
    const result = pdfFailureFromDocument(makeDoc(), 'skippedExisting', 'already exists');
    expect(result.attemptedAt).toBe('2024-06-15T12:00:00.000Z');
  });

  it('handles null sector and null pdfUrl', () => {
    const doc = makeDoc({ sector: null, pdfUrl: null });
    const result = pdfFailureFromDocument(doc, 'missingPdfUrl', 'no url');
    expect(result.sector).toBeNull();
    expect(result.pdfUrl).toBeNull();
  });
});
