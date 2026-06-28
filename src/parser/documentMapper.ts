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
