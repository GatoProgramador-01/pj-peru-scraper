import type { ParsedRow } from '../models/internalTypes.js';
import type { JudicialDocument, SiteConfig } from '../types.js';
import { normDate } from '../utils/date.js';
import { buildId } from '../utils/fileName.js';

/** Carry-along context injected into every row-to-document mapping call (site, position, column layout). */
export interface DocumentMappingCtx {
  site: string;
  pageIndex: number;
  columns: SiteConfig['columns'];
  sectorId: string | null;
  sectorName: string | null;
}

/**
 * Curried mapper: binds page-level context then converts a row to a document.
 *
 * @remarks
 * Call pattern: `rows.map(rowToDocument(ctx))`. The outer call captures the
 * `DocumentMappingCtx` — site identifier, zero-based page index, column index
 * map, and the optional sector id/name from the search form — and returns a
 * `(row, idx) => JudicialDocument` function that is passed directly to
 * `Array.map`. Currying avoids threading the context through every iteration
 * and keeps call sites readable.
 *
 * Column values are read positionally from `row.cells` via the `columns` map;
 * an out-of-range index returns an empty string (never throws). Date strings
 * are normalised to ISO-8601 via `normDate`; the unique document `id` is
 * deterministic and built from site + caseNumber + date + sectorId so that
 * re-scraping the same page is idempotent. RichFaces-only fields
 * (`tipoRecurso`, `sumilla`, `palabrasClave`, `fallo`, `jueces`, `proceso`,
 * `distritoJudicialProcedencia`, `expedienteProcedencia`,
 * `fechaResolucionProcedencia`, `falloProcedencia`) are coerced to `null`
 * when absent so the MongoDB schema stays uniform across portal variants.
 *
 * @param ctx - Page-level context: site, pageIndex, columns, sectorId, sectorName
 * @returns A `(row: ParsedRow, rowIndex: number) => JudicialDocument` mapper
 *   ready to be passed to `Array.map`
 */
export const rowToDocument =
  (ctx: DocumentMappingCtx) =>
  (row: ParsedRow, rowIndex: number): JudicialDocument => {
    const { site, pageIndex, columns, sectorId, sectorName } = ctx;
    const c = (idx: number | undefined) => (idx !== undefined ? row.cells[idx] ?? '' : '');
    const caseNumber = c(columns.caseNumber);
    const date = c(columns.date);
    return {
      id: buildId(site, caseNumber, date, sectorId),
      site,
      sector: sectorName,
      caseNumber,
      court: c(columns.court) || null,
      date: date ? normDate(date) : null,
      summary: c(columns.summary) || null,
      resolution: c(columns.resolution) || null,
      tipoRecurso: row.tipoRecurso || null,
      sumilla: row.sumilla || null,
      palabrasClave: row.palabrasClave || null,
      fallo: row.fallo || null,
      jueces: row.juecesRaw ? row.juecesRaw.split(',').map(j => j.trim()).filter(Boolean) : null,
      proceso: row.proceso || null,
      distritoJudicialProcedencia: row.distritoJudicialProcedencia || null,
      expedienteProcedencia: row.expedienteProcedencia || null,
      fechaResolucionProcedencia: row.fechaResolucionProcedencia || null,
      falloProcedencia: row.falloProcedencia || null,
      pdfUrl: row.pdfUrl,
      pdfLocalPath: null,
      pageIndex,
      rowIndex,
      fetchedAt: new Date().toISOString(),
      rawCells: row.cells,
    } satisfies JudicialDocument;
  };
