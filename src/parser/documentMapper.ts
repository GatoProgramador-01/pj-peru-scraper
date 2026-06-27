import type { ParsedRow } from '../models/internalTypes.js';
import type { JudicialDocument, SiteConfig } from '../types.js';
import { normDate } from '../utils/date.js';
import { buildId } from '../utils/fileName.js';

export const rowToDocument =
  (site: string, pageIndex: number, columns: SiteConfig['columns'], sectorId: string | null, sectorName: string | null) =>
  (row: ParsedRow, rowIndex: number): JudicialDocument => {
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
      pdfUrl: row.pdfUrl,
      pdfLocalPath: null,
      pageIndex,
      rowIndex,
      fetchedAt: new Date().toISOString(),
      rawCells: row.cells,
    } satisfies JudicialDocument;
  };
