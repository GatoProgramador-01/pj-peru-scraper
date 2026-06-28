import fs from 'fs';
import path from 'path';
import { PDF_MAGIC } from '../config/constants.js';
import { logger } from '../logger.js';
import type { JsfAction, Session } from '../models/internalTypes.js';
import type { PdfDownloadResult, RunMetrics } from '../models/metrics.js';
import type { JsfPdfTarget, PdfDownloadConfig } from '../models/pdfTypes.js';
import type { JudicialDocument, SiteConfig } from '../types.js';
import { absorbCookies, cookieHeader } from '../session/cookies.js';
import { withRetry } from '../session/retry.js';


// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Coerce an unknown thrown value to a string message. */
const pdfErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Build the absolute path for a document's local PDF file. */
const localPdfPath = (pdfDir: string, docId: string): string =>
  path.join(pdfDir, `${docId}.pdf`);

/** Return a skippedExisting result if the file already exists on disk. */
const checkAlreadyDownloaded = (filePath: string, startedAt: number): PdfDownloadResult | null =>
  fs.existsSync(filePath)
    ? { status: 'skippedExisting', localPath: filePath, latencyMs: Date.now() - startedAt }
    : null;

/** Encode a mojarra action + viewState into a URL-encoded form body. */
const buildJsfFormBody = (formId: string, mojarra: JsfAction, viewState: string): string => {
  const params: [string, string][] = [
    [formId, formId],
    ...(mojarra.componentId ? [[mojarra.componentId, mojarra.componentId] as [string, string]] : []),
    ['param_uuid', mojarra.paramUuid],
    ['javax.faces.ViewState', viewState],
  ];
  return params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
};

/** Assert the buffer starts with the `%PDF` magic bytes. */
const validatePdfBuffer = (buf: Buffer): void => {
  const magic = buf.slice(0, 4).toString('ascii');
  if (magic !== PDF_MAGIC) throw new Error(`JSF action response is not a PDF: ${magic}`);
};

// ─── Public download functions ────────────────────────────────────────────────

/**
 * Download a PDF via direct GET using the document's `pdfUrl`.
 *
 * @remarks
 * Skips the download and returns `skippedExisting` when the file already
 * exists on disk. Validates the `%PDF` magic bytes after download — a
 * successful HTTP 200 that returns an HTML error page will throw. Latency
 * is always written to `metrics` when provided.
 *
 * @param session - Active HTTP session carrying cookies and the axios client
 * @param doc - Judicial document; must have a non-null `pdfUrl`
 * @param dlConfig - Destination directory and retry timing config
 * @param metrics - Optional run-level metrics accumulator for latency tracking
 * @returns Result with status (`downloaded` | `skippedExisting` | `missingPdfUrl` | `failedDownload`) and local path
 * @throws Never — errors are caught and returned as `failedDownload` status
 */
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

/**
 * Download a PDF via JSF mojarra form POST (OEFA documents).
 *
 * @remarks
 * OEFA does not expose a direct PDF URL. Instead, each document is gated
 * behind a JSF lifecycle: the caller extracts `componentId` and `paramUuid`
 * from the row's `onclick` handler, then passes them in `target.mojarra`.
 * This function builds a `application/x-www-form-urlencoded` body that
 * triggers the mojarra action, absorbs any `Set-Cookie` response headers
 * back into the session, and validates the `%PDF` magic bytes before
 * writing the file. Skips if the file already exists on disk.
 *
 * @param session - Active HTTP session; cookies are updated in place after the POST
 * @param siteConfig - Site-level config supplying `startUrl`, form ID, and retry timing
 * @param target - PDF target containing `doc`, `pdfDir`, `viewState`, and `mojarra` action data
 * @param metrics - Optional run-level metrics accumulator for latency tracking
 * @returns Result with status (`downloaded` | `skippedExisting` | `failedDownload`) and local path
 * @throws Never — errors are caught and returned as `failedDownload` status
 */
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
