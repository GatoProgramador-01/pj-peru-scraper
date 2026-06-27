import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import type { JsfAction, Session } from '../models/internalTypes.js';
import type { PdfDownloadResult } from '../models/metrics.js';
import type { JudicialDocument, SiteConfig } from '../types.js';
import { absorbCookies, cookieHeader } from '../session/cookies.js';

export const downloadPdf = async (session: Session, doc: JudicialDocument, pdfDir: string): Promise<PdfDownloadResult> => {
  const startedAt = Date.now();
  if (!doc.pdfUrl) return { status: 'missingPdfUrl', localPath: null, latencyMs: 0 };

  const localPath = path.join(pdfDir, `${doc.id}.pdf`);
  if (fs.existsSync(localPath)) {
    return { status: 'skippedExisting', localPath, latencyMs: Date.now() - startedAt };
  }

  try {
    const resp = await session.client.get<ArrayBuffer>(doc.pdfUrl, {
      responseType: 'arraybuffer',
      headers: { Referer: session.baseUrl, Accept: 'application/pdf,*/*', Cookie: cookieHeader(session) },
    });
    const buf = Buffer.from(resp.data);
    fs.writeFileSync(localPath, buf);
    logger.info('PDF saved', { file: path.basename(localPath), bytes: buf.length });
    return { status: 'downloaded', localPath, latencyMs: Date.now() - startedAt };
  } catch (err) {
    const error = (err as Error).message;
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
    const resp = await session.client.post<ArrayBuffer>(config.startUrl, body, {
      responseType: 'arraybuffer',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer': config.startUrl,
        'Cookie': cookieHeader(session),
        'Accept': 'application/pdf,application/octet-stream,*/*',
      },
    });
    absorbCookies(session, resp.headers['set-cookie'] as string[] | undefined);
    const buf = Buffer.from(resp.data);
    if (buf.slice(0, 4).toString('ascii') !== '%PDF') {
      const magic = buf.slice(0, 4).toString('ascii');
      logger.warn('JSF action response is not a PDF - server returned HTML or redirect', { paramUuid: mojarra.paramUuid, magic });
      return { status: 'failedDownload', localPath: null, latencyMs: Date.now() - startedAt, error: `JSF action response is not a PDF: ${magic}` };
    }
    fs.writeFileSync(localPath, buf);
    logger.info('PDF saved via JSF action POST', { file: path.basename(localPath), kb: Math.round(buf.length / 1024), via: 'jsf-action-post' });
    return { status: 'downloaded', localPath, latencyMs: Date.now() - startedAt };
  } catch (err) {
    const error = (err as Error).message;
    logger.error('JSF action PDF download failed', { paramUuid: mojarra.paramUuid, error });
    return { status: 'failedDownload', localPath: null, latencyMs: Date.now() - startedAt, error };
  }
};
