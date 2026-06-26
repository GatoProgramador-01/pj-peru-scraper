import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import type { JsfAction, Session } from '../models/internalTypes.js';
import type { JudicialDocument, SiteConfig } from '../types.js';
import { absorbCookies, cookieHeader } from '../session/cookies.js';

export const downloadPdf = async (session: Session, doc: JudicialDocument, pdfDir: string): Promise<string | null> => {
  if (!doc.pdfUrl) return null;
  const localPath = path.join(pdfDir, `${doc.id}.pdf`);
  if (fs.existsSync(localPath)) return localPath;

  try {
    const resp = await session.client.get<ArrayBuffer>(doc.pdfUrl, {
      responseType: 'arraybuffer',
      headers: { Referer: session.baseUrl, Accept: 'application/pdf,*/*', Cookie: cookieHeader(session) },
    });
    const buf = Buffer.from(resp.data);
    if (buf.length < 500) {
      logger.warn('PDF suspiciously small — skipping', { url: doc.pdfUrl, bytes: buf.length });
      return null;
    }
    fs.writeFileSync(localPath, buf);
    logger.info('PDF saved', { file: path.basename(localPath), bytes: buf.length });
    return localPath;
  } catch (err) {
    logger.error('PDF download error', { url: doc.pdfUrl, error: (err as Error).message });
    return null;
  }
};

export const downloadJsfActionPdf = async (
  session: Session,
  config: SiteConfig,
  viewState: string,
  mojarra: JsfAction,
  doc: JudicialDocument,
  pdfDir: string,
): Promise<string | null> => {
  const localPath = path.join(pdfDir, `${doc.id}.pdf`);
  if (fs.existsSync(localPath)) return localPath;

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
    if (buf.length < 500) {
      logger.warn('JSF action response too small — likely an error page', { paramUuid: mojarra.paramUuid, bytes: buf.length });
      return null;
    }
    if (buf.slice(0, 4).toString('ascii') !== '%PDF') {
      logger.warn('JSF action response is not a PDF — server returned HTML or redirect', { paramUuid: mojarra.paramUuid, magic: buf.slice(0, 4).toString('ascii') });
      return null;
    }
    fs.writeFileSync(localPath, buf);
    logger.info('PDF saved via JSF action POST', { file: path.basename(localPath), kb: Math.round(buf.length / 1024), via: 'jsf-action-post' });
    return localPath;
  } catch (err) {
    logger.error('JSF action PDF download failed', { paramUuid: mojarra.paramUuid, error: (err as Error).message });
    return null;
  }
};
