import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import type { JsfAction, Session } from '../models/internalTypes.js';
import type { PdfDownloadResult, RunMetrics } from '../models/metrics.js';
import type { JudicialDocument, SiteConfig } from '../types.js';
import { absorbCookies, cookieHeader } from '../session/cookies.js';
import { withRetry } from '../session/retry.js';

const PDF_MAGIC = '%PDF';

/** Output directory and retry timing for a direct URL PDF download. */
export interface PdfDownloadConfig {
  pdfDir: string;
  retryWaitMs: readonly number[];
}

/** All inputs needed to POST a JSF form action and receive the PDF binary response. */
export interface JsfPdfTarget {
  viewState: string;
  mojarra: JsfAction;
  doc: JudicialDocument;
  pdfDir: string;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

const pdfErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const localPdfPath = (pdfDir: string, docId: string): string =>
  path.join(pdfDir, `${docId}.pdf`);

const checkAlreadyDownloaded = (filePath: string, startedAt: number): PdfDownloadResult | null =>
  fs.existsSync(filePath)
    ? { status: 'skippedExisting', localPath: filePath, latencyMs: Date.now() - startedAt }
    : null;

const buildJsfFormBody = (formId: string, mojarra: JsfAction, viewState: string): string => {
  const params: [string, string][] = [
    [formId, formId],
    ...(mojarra.componentId ? [[mojarra.componentId, mojarra.componentId] as [string, string]] : []),
    ['param_uuid', mojarra.paramUuid],
    ['javax.faces.ViewState', viewState],
  ];
  return params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
};

const validatePdfBuffer = (buf: Buffer): void => {
  const magic = buf.slice(0, 4).toString('ascii');
  if (magic !== PDF_MAGIC) throw new Error(`JSF action response is not a PDF: ${magic}`);
};

// ─── Public download functions ────────────────────────────────────────────────

export const downloadPdf = async (
  session: Session,
  doc: JudicialDocument,
  dlConfig: PdfDownloadConfig,
  metrics?: RunMetrics,
): Promise<PdfDownloadResult> => {
  const startedAt = Date.now();
  if (!doc.pdfUrl) return { status: 'missingPdfUrl', localPath: null, latencyMs: 0 };

  const filePath = localPdfPath(dlConfig.pdfDir, doc.id);
  const existing = checkAlreadyDownloaded(filePath, startedAt);
  if (existing) return existing;

  try {
    const resp = await withRetry(
      () => session.client.get<ArrayBuffer>(doc.pdfUrl!, {
        responseType: 'arraybuffer',
        headers: { Referer: session.baseUrl, Accept: 'application/pdf,*/*', Cookie: cookieHeader(session) },
      }),
      dlConfig.retryWaitMs,
      `pdf-${doc.id}`,
      metrics,
    );
    const buf = Buffer.from(resp.data);
    fs.writeFileSync(filePath, buf);
    logger.info('PDF saved', { file: path.basename(filePath), bytes: buf.length });
    return { status: 'downloaded', localPath: filePath, latencyMs: Date.now() - startedAt };
  } catch (err) {
    const error = pdfErrorMessage(err);
    logger.error('PDF download error', { url: doc.pdfUrl, error });
    return { status: 'failedDownload', localPath: null, latencyMs: Date.now() - startedAt, error };
  }
};

export const downloadJsfActionPdf = async (
  session: Session,
  siteConfig: SiteConfig,
  target: JsfPdfTarget,
  metrics?: RunMetrics,
): Promise<PdfDownloadResult> => {
  const { viewState, mojarra, doc, pdfDir } = target;
  const startedAt = Date.now();
  const filePath = localPdfPath(pdfDir, doc.id);
  const existing = checkAlreadyDownloaded(filePath, startedAt);
  if (existing) return existing;

  const formId = siteConfig.search?.formId ?? 'form';
  const body = buildJsfFormBody(formId, mojarra, viewState);

  try {
    const { resp, buf } = await withRetry(
      async () => {
        const attemptResp = await session.client.post<ArrayBuffer>(siteConfig.startUrl, body, {
          responseType: 'arraybuffer',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Referer': siteConfig.startUrl,
            'Cookie': cookieHeader(session),
            'Accept': 'application/pdf,application/octet-stream,*/*',
          },
        });
        const attemptBuf = Buffer.from(attemptResp.data);
        validatePdfBuffer(attemptBuf);
        return { resp: attemptResp, buf: attemptBuf };
      },
      siteConfig.timing.retryWaitMs,
      `pdf-jsf-${doc.id}`,
      metrics,
    );
    absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
    fs.writeFileSync(filePath, buf);
    logger.info('PDF saved via JSF action POST', { file: path.basename(filePath), kb: Math.round(buf.length / 1024) });
    return { status: 'downloaded', localPath: filePath, latencyMs: Date.now() - startedAt };
  } catch (err) {
    const error = pdfErrorMessage(err);
    logger.error('JSF action PDF download failed', { paramUuid: mojarra.paramUuid, error });
    return { status: 'failedDownload', localPath: null, latencyMs: Date.now() - startedAt, error };
  }
};
