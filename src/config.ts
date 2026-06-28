// FRAGILE: Selectors are derived from common JSF/PrimeFaces patterns.
// Run `npm run recon -- --site <name>` first to verify selectors against the live site.

import type { SiteConfig } from './types.js';

export const SITES: Record<string, SiteConfig> = {
  'pj-peru': {
    // Verified 2026-06-27 via live recon with Peru VPN (CyberGhost).
    // RichFaces 4.2.2 + Mojarra (NOT PrimeFaces). Results as div repeat panels.
    // cells = [0]=tipoRecurso [1]=expediente [2]=pretension [3]=tipoResolucion [4]=fechaResolucion [5]=sala [6]=sumilla
    columns: { caseNumber: 1, court: 5, date: 4, summary: 2, resolution: 3 },
    name: 'Poder Judicial del Perú — Jurisprudencia',
    baseUrl: 'https://jurisprudencia.pj.gob.pe',
    startUrl: 'https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml',
    resultsUrl: 'https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml',
    rowParser: 'richfacesRepeat',
    selectors: {
      // rowParser='richfacesRepeat' bypasses this; kept as fallback sentinel
      rows: '[id^="formBuscador:repeat:"][id$=":j_idt455"]',
      cells: 'td',
      caseNumber: 'td:nth-child(2)',
      court: 'td:nth-child(6)',
      date: 'td:nth-child(5)',
      summary: 'td:nth-child(3)',
      pdfLink: 'a[href*="ServletDescarga"]',
      nextButton: 'a.rf-ds-btn-next',
      currentPage: '.rf-ds-act',
      totalPages: null,
      noResults: '[id*="optResultado"]',
    },
    timing: {
      pageDelayMs: [0, 0],
      pdfDelayMs: [0, 0],
      retryWaitMs: [8000, 16000, 35000],
      navigationTimeoutMs: 45_000,
      selectorTimeoutMs: 20_000,
    },
    search: {
      formId: 'formBuscador',
      buttonId: 'formBuscador:j_idt31',
      buttonValue: '',
      ajax: false,
      // sectorField overrides buCorte at submit time; last occurrence wins in JSF POST body.
      // Sector 1 = Corte Suprema (207,527 docs) | Sector 2 = Corte Superior / Todos (458,909 docs)
      sectorField: 'formBuscador:buCorte',
      sectors: {
        '1': 'SUPREMA',
        '2': 'SUPERIOR',
      },
      fields: {
        'formBuscador:buCorte': '1',
        'formBuscador:buDistrito': '0',
        'formBuscador:buEspecialidad': '0',
        'formBuscador:buSala': '0',
        'formBuscador:buAnio': '',
        'formBuscador:txtBusqueda': '',
        'formBuscador:tabpanel-value': 'general',
        'forward': 'buscar',
        'busqueda': 'especializada',
        'formBuscador:j_idt34': '21',
        'formBuscador:j_idt35': 'DESC',
        'formBuscador:j_idt36': 'Principal',
        'formBuscador:j_idt37': '1',
      },
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
      pageDelayMs: [0, 0],
      pdfDelayMs: [0, 0],
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
