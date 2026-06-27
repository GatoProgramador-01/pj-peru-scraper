import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import type { JsfAction, Session } from '../models/internalTypes.js';
import type { PdfDownloadResult, RunMetrics } from '../models/metrics.js';
import type { JudicialDocument, SiteConfig } from '../types.js';
import { absorbCookies, cookieHeader } from '../session/cookies.js';
import { withRetry } from '../session/retry.js';

const pdfErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export const downloadPdf = async (
  session: Session,
  doc: JudicialDocument,
  pdfDir: string,
  retryWaitMs: [number, number, number],
  metrics?: RunMetrics,
): Promise<PdfDownloadResult> => {
  const startedAt = Date.now();
  if (!doc.pdfUrl) return { status: 'missingPdfUrl', localPath: null, latencyMs: 0 };

  const localPath = path.join(pdfDir, `${doc.id}.pdf`);
  if (fs.existsSync(localPath)) {
    return { status: 'skippedExisting', localPath, latencyMs: Date.now() - startedAt };
  }

  try {
    const resp = await withRetry(
      () => session.client.get<ArrayBuffer>(doc.pdfUrl!, {
        responseType: 'arraybuffer',
        headers: { Referer: session.baseUrl, Accept: 'application/pdf,*/*', Cookie: cookieHeader(session) },
      }),
      retryWaitMs,
      `pdf-${doc.id}`,
      metrics,
    );
    const buf = Buffer.from(resp.data);
    fs.writeFileSync(localPath, buf);
    logger.info('PDF saved', { file: path.basename(localPath), bytes: buf.length });
    return { status: 'downloaded', localPath, latencyMs: Date.now() - startedAt };
  } catch (err) {
    const error = pdfErrorMessage(err);
    logger.error('PDF download error', { url: doc.pdfUrl, error });
    return { status: 'failedDownload', localPath: null, latencyMs: Date.now() - startedAt, error };
  }
};

export const downloadJsfActionPdf = async (
  session: Session,
  config: SiteConfig,
  viewState: string,
  mojarra: JsfAction,
  doc: JudicialDocument,
  pdfDir: string,
  metrics?: RunMetrics,
): Promise<PdfDownloadResult> => {
  const startedAt = Date.now();
  const localPath = path.join(pdfDir, `${doc.id}.pdf`);
  if (fs.existsSync(localPath)) {
    return { status: 'skippedExisting', localPath, latencyMs: Date.now() - startedAt };
  }

  const formId = config.search?.formId ?? 'form';
  const params: [string, string][] = [
    [formId, formId],
    ...(mojarra.componentId ? [[mojarra.componentId, mojarra.componentId] as [string, string]] : []),
    ['param_uuid', mojarra.paramUuid],
    ['javax.faces.ViewState', viewState],
  ];
  const body = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  try {
    const { resp, buf } = await withRetry(
      async () => {
        const attemptResp = await session.client.post<ArrayBuffer>(config.startUrl, body, {
          responseType: 'arraybuffer',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Referer': config.startUrl,
            'Cookie': cookieHeader(session),
            'Accept': 'application/pdf,application/octet-stream,*/*',
          },
        });
        const attemptBuf = Buffer.from(attemptResp.data);
        if (attemptBuf.slice(0, 4).toString('ascii') !== '%PDF') {
          const magic = attemptBuf.slice(0, 4).toString('ascii');
          throw new Error(`JSF action response is not a PDF: ${magic}`);
        }
        return { resp: attemptResp, buf: attemptBuf };
      },
      config.timing.retryWaitMs,
      `pdf-jsf-${doc.id}`,
      metrics,
    );
    absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
    fs.writeFileSync(localPath, buf);
    logger.info('PDF saved via JSF action POST', { file: path.basename(localPath), kb: Math.round(buf.length / 1024), via: 'jsf-action-post' });
    return { status: 'downloaded', localPath, latencyMs: Date.now() - startedAt };
  } catch (err) {
    const error = pdfErrorMessage(err);
    logger.error('JSF action PDF download failed', { paramUuid: mojarra.paramUuid, error });
    return { status: 'failedDownload', localPath: null, latencyMs: Date.now() - startedAt, error };
  }
};
