// Tests for src/pdf/downloader.ts — downloadPdf()
// No network calls — session.client.get is mocked with vi.fn().
// Real temp dir used so fs.existsSync / writeFileSync assertions are genuine.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

vi.mock('../../src/session/cookies.js', () => ({
  cookieHeader: vi.fn().mockReturnValue(''),
  absorbCookies: vi.fn(),
}));

import { downloadPdf } from '../../src/pdf/downloader.js';
import type { JudicialDocument } from '../../src/types.js';

const makeDoc = (overrides: Partial<JudicialDocument> = {}): JudicialDocument => ({
  id: 'doc-001', site: 'pj-peru', sector: null, caseNumber: '001-2024',
  pdfUrl: 'https://jurisprudencia.pj.gob.pe/doc/001.pdf',
  pageIndex: 0, rowIndex: 0,
  tipoRecurso: null, sumilla: null, palabrasClave: null,
  ...overrides,
} as JudicialDocument);

const makeSession = () => ({
  client: { get: vi.fn() },
  cookies: new Map<string, string>(),
  baseUrl: 'https://jurisprudencia.pj.gob.pe',
});

const WAITS: [number, number, number] = [0, 0, 0];
let pdfDir: string;

beforeEach(() => {
  vi.useFakeTimers();
  pdfDir = mkdtempSync(path.join(tmpdir(), 'pj-pdf-test-'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  rmSync(pdfDir, { recursive: true, force: true });
});

describe('downloadPdf', () => {
  it('returns missingPdfUrl when doc.pdfUrl is null — no HTTP call', async () => {
    const session = makeSession();
    const p = downloadPdf(session as any, makeDoc({ pdfUrl: null }), pdfDir, WAITS);
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.status).toBe('missingPdfUrl');
    expect(result.localPath).toBeNull();
    expect(session.client.get).not.toHaveBeenCalled();
  });

  it('returns skippedExisting when PDF already on disk — no HTTP call', async () => {
    const session = makeSession();
    const doc = makeDoc();
    const localPath = path.join(pdfDir, `${doc.id}.pdf`);
    fs.writeFileSync(localPath, Buffer.from('%PDF-existing'));

    const p = downloadPdf(session as any, doc, pdfDir, WAITS);
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.status).toBe('skippedExisting');
    expect(result.localPath).toBe(localPath);
    expect(session.client.get).not.toHaveBeenCalled();
  });

  it('returns downloaded and writes file on successful HTTP response', async () => {
    const session = makeSession();
    const doc = makeDoc();
    const pdfBytes = Buffer.from('%PDF-1.4 fake content');
    session.client.get.mockResolvedValueOnce({ data: pdfBytes.buffer });

    const p = downloadPdf(session as any, doc, pdfDir, WAITS);
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.status).toBe('downloaded');
    expect(result.localPath).toBe(path.join(pdfDir, `${doc.id}.pdf`));
    expect(fs.existsSync(result.localPath!)).toBe(true);
  });

  it('returns failedDownload when all HTTP attempts fail', async () => {
    const session = makeSession();
    session.client.get
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'));

    const p = downloadPdf(session as any, makeDoc(), pdfDir, WAITS);
    await vi.runAllTimersAsync();
    const result = await p;
    expect(result.status).toBe('failedDownload');
    expect(result.localPath).toBeNull();
    expect(result.error).toMatch(/network error/);
  });
});
