// FRAGILE: Selectors are derived from common JSF/PrimeFaces patterns.
// Run `npm run recon -- --site <name>` first to verify selectors against the live site.

import type { SiteConfig } from './types.js';

export const SITES: Record<string, SiteConfig> = {
  'pj-peru': {
    // Column order TBD — requires VPN to Peru; run recon first.
    // Likely: [0]=Expediente [1]=Sala [2]=Fecha [3]=Sumilla [4]=PDF
    columns: { caseNumber: 0, court: 1, date: 2, summary: 3 },
    name: 'Poder Judicial del Perú — Jurisprudencia',
    baseUrl: 'https://jurisprudencia.pj.gob.pe',
    startUrl: 'https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml',
    selectors: {
      rows: 'table.ui-datatable-data tbody tr, .ui-datatable-tablewrapper tbody tr',
      cells: 'td',
      caseNumber: 'td:nth-child(1)',
      court: 'td:nth-child(2)',
      date: 'td:nth-child(3)',
      summary: 'td:nth-child(4)',
      pdfLink: 'a[href$=".pdf"], a[title*="PDF"], a[title*="Ver"], button[title*="PDF"]',
      nextButton: 'a.ui-paginator-next:not(.ui-state-disabled), .ui-paginator-next:not([aria-disabled="true"])',
      currentPage: '.ui-paginator-current, span.ui-paginator-page.ui-state-active',
      totalPages: null,
      noResults: '.ui-datatable-empty-message, .no-results',
    },
    timing: {
      pageDelayMs: [2500, 5500],
      pdfDelayMs: [1200, 3500],
      retryWaitMs: [8000, 16000, 35000],
      navigationTimeoutMs: 45_000,
      selectorTimeoutMs: 20_000,
    },
  },

  'oefa': {
    // Columns: [0]=Nro [1]=Expediente [2]=Administrado [3]=Unidad [4]=Sector [5]=Resolución [6]=Archivo(PDF)
    // Verified 2026-06-26 via HTTP recon.
    columns: { caseNumber: 1, summary: 2, court: 3, date: 5, resolution: 5, pdfColIndex: 6 },
    name: 'OEFA — Repositorio Digital: Tribunal de Fiscalización Ambiental',
    baseUrl: 'https://publico.oefa.gob.pe',
    startUrl: 'https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml',
    selectors: {
      // Row format: <tr data-ri="N" class="ui-widget-content ui-datatable-even|odd">
      rows: '[id$=":dt_data"] tr[data-ri], .ui-datatable-data tr[data-ri]',
      cells: 'td',
      caseNumber: 'td:nth-child(2)',
      court: 'td:nth-child(4)',
      date: 'td:nth-child(6)',
      summary: 'td:nth-child(3)',
      pdfLink: 'td:nth-child(7) a[href], td:last-child a[href]',
      nextButton: 'a.ui-paginator-next:not(.ui-state-disabled)',
      currentPage: '.ui-paginator-current',
      totalPages: null,
      noResults: '.ui-datatable-empty-message',
    },
    timing: {
      pageDelayMs: [200, 600],
      pdfDelayMs: [0, 100],
      retryWaitMs: [5000, 12000, 25000],
      navigationTimeoutMs: 40_000,
      selectorTimeoutMs: 20_000,
    },
    search: {
      formId: 'listarDetalleInfraccionRAAForm',
      buttonId: 'listarDetalleInfraccionRAAForm:btnBuscar',
      buttonValue: 'Buscar',
      ajax: false,
      // Static fields — all blank for wildcard search
      fields: {
        'listarDetalleInfraccionRAAForm:txtNroexp': '',
        'listarDetalleInfraccionRAAForm:j_idt21': '',
        'listarDetalleInfraccionRAAForm:j_idt25': '',
      },
      // Sector <select> — value injected per-iteration by discoverSectors() at runtime
      sectorField: 'listarDetalleInfraccionRAAForm:idsector',
      // Known sector IDs (fallback if discoverSectors() fails or for offline use)
      sectors: {
        '1': 'MINERIA',
        '2': 'ELECTRICIDAD',
        '3': 'HIDROCARBUROS',
        '8': 'PESQUERIA',
        '9': 'INDUSTRIA',
      },
    },
  },
};
