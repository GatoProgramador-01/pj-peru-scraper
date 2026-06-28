// Tests for src/parser/documentMapper.ts — rowToDocument()

import { describe, it, expect } from 'vitest';
import { rowToDocument } from '../../src/parser/documentMapper.js';
import type { DocumentMappingCtx } from '../../src/parser/documentMapper.js';
import type { ParsedRow } from '../../src/models/internalTypes.js';
import type { ColumnMap } from '../../src/types.js';

const columns: ColumnMap = {
  caseNumber: 1, court: 5, date: 4, summary: 2, resolution: 3,
};

const makeRow = (overrides: Partial<ParsedRow> = {}): ParsedRow => ({
  cells: [
    'Apelación',                              // 0 tipoRecurso
    '029329-2025',                            // 1 expediente
    'Acción de Amparo',                       // 2 pretension
    'Ejecutoria Suprema',                     // 3 tipoResolucion
    '19/06/2026',                             // 4 fechaResolucion
    'Quinta Sala Civil',                      // 5 sala
    'La resolución impugnada fue confirmada.', // 6 sumilla
  ],
  pdfUrl: 'https://example.com/pdf.pdf',
  pdfJsfAction: null,
  tipoRecurso: 'Apelación',
  sumilla: 'La resolución impugnada fue confirmada.',
  palabrasClave: 'debido proceso, motivación',
  ...overrides,
});

const ctx: DocumentMappingCtx = {
  site: 'pj-peru',
  pageIndex: 0,
  columns,
  sectorId: null,
  sectorName: 'CIVIL',
};

const mapper = rowToDocument(ctx);

describe('rowToDocument', () => {
  it('maps cells to correct fields via column indices', () => {
    const doc = mapper(makeRow(), 0);
    expect(doc.caseNumber).toBe('029329-2025');
    expect(doc.court).toBe('Quinta Sala Civil');
    expect(doc.summary).toBe('Acción de Amparo');
    expect(doc.resolution).toBe('Ejecutoria Suprema');
    expect(doc.site).toBe('pj-peru');
    expect(doc.sector).toBe('CIVIL');
    expect(doc.pdfUrl).toBe('https://example.com/pdf.pdf');
  });

  it('maps pj-peru specific fields: tipoRecurso, sumilla, palabrasClave', () => {
    const doc = mapper(makeRow(), 0);
    expect(doc.tipoRecurso).toBe('Apelación');
    expect(doc.sumilla).toBe('La resolución impugnada fue confirmada.');
    expect(doc.palabrasClave).toBe('debido proceso, motivación');
  });

  it('sets specific fields to null when row has no named fields', () => {
    const row = makeRow({ tipoRecurso: undefined, sumilla: undefined, palabrasClave: undefined });
    const doc = mapper(row, 0);
    expect(doc.tipoRecurso).toBeNull();
    expect(doc.sumilla).toBeNull();
    expect(doc.palabrasClave).toBeNull();
  });

  it('normalizes date from DD/MM/YYYY to ISO YYYY-MM-DD', () => {
    const doc = mapper(makeRow(), 0);
    expect(doc.date).toBe('2026-06-19');
  });

  it('sets court to null when cells[court] is empty string', () => {
    const row = makeRow();
    row.cells[5] = '';
    expect(mapper(row, 0).court).toBeNull();
  });

  it('sets date to null when cells[date] is empty string', () => {
    const row = makeRow();
    row.cells[4] = '';
    expect(mapper(row, 0).date).toBeNull();
  });

  it('produces a deterministic id — rowIndex does not affect it', () => {
    const doc1 = mapper(makeRow(), 0);
    const doc2 = mapper(makeRow(), 7);
    expect(doc1.id).toBe(doc2.id);
  });

  it('id changes when sectorId differs', () => {
    const withSector = rowToDocument({ ...ctx, sectorId: '2', sectorName: 'SUPERIOR' })(makeRow(), 0);
    const noSector   = rowToDocument({ ...ctx, sectorId: null, sectorName: 'SUPERIOR' })(makeRow(), 0);
    expect(withSector.id).not.toBe(noSector.id);
  });

  it('rawCells matches the input cells array exactly', () => {
    const row = makeRow();
    expect(mapper(row, 0).rawCells).toStrictEqual(row.cells);
  });

  it('pdfLocalPath is always null at mapping time', () => {
    expect(mapper(makeRow(), 0).pdfLocalPath).toBeNull();
  });

  it('splits juecesRaw by comma into jueces array', () => {
    const row = makeRow({ juecesRaw: 'García López, Pérez Torres, Rodríguez Díaz' });
    const doc = mapper(row, 0);
    expect(doc.jueces).toEqual(['García López', 'Pérez Torres', 'Rodríguez Díaz']);
  });

  it('sets jueces to null when juecesRaw is absent', () => {
    const row = makeRow({ juecesRaw: undefined });
    expect(mapper(row, 0).jueces).toBeNull();
  });

  it('pageIndex comes from ctx and rowIndex from position argument', () => {
    const ctxPage3: DocumentMappingCtx = { ...ctx, pageIndex: 3 };
    const doc = rowToDocument(ctxPage3)(makeRow(), 5);
    expect(doc.pageIndex).toBe(3);
    expect(doc.rowIndex).toBe(5);
  });
});
