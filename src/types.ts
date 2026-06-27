// Expected record count: 1,000–50,000+ per site across all sectors
// Data source: PJ Peru jurisprudencia + OEFA TFA portals (JSF/PrimeFaces)

export interface JudicialDocument {
  id: string;              // Unique ID: <site>[_S<sectorId>]_<caseNumber>_<date>
  site: string;            // 'pj-peru' | 'oefa'
  sector: string | null;   // Sector name used in the search filter (e.g. 'MINERIA')
  caseNumber: string;      // Número de expediente
  court: string | null;    // Sala / Juzgado / Unidad fiscalizable
  date: string | null;     // ISO date or resolution number
  summary: string | null;  // Administrado / Sumilla
  resolution: string | null;
  pdfUrl: string | null;   // Absolute URL to PDF (null if confidential or JS-only)
  pdfLocalPath: string | null;
  pageIndex: number;       // 0-based page number where found
  rowIndex: number;        // Row within page
  fetchedAt: string;       // ISO timestamp
  rawCells: string[];      // All table cell text for schema discovery
}

export interface Selectors {
  rows: string;
  cells: string;
  caseNumber: string;
  court: string;
  date: string;
  summary: string;
  pdfLink: string;
  nextButton: string;
  currentPage: string | null;
  totalPages: string | null;
  noResults: string | null;
}

export interface TimingConfig {
  pageDelayMs: [number, number];          // [min, max] jitter between page turns
  pdfDelayMs: [number, number];           // jitter between PDF downloads
  retryWaitMs: [number, number, number];  // per-attempt base wait (may be overridden by Retry-After)
  navigationTimeoutMs: number;
  selectorTimeoutMs: number;
}

/**
 * Search form config — submitted once before pagination begins.
 * Required by portals that show an empty table on first load (OEFA, PJ Peru).
 *
 * - ajax: false  → regular full-page POST (submit button included in form body)
 * - ajax: true   → PrimeFaces partial AJAX POST
 * - sectorField  → form field name for sector <select>; value supplied at runtime
 * - sectors      → value → label map; populated by discoverSectors() or hardcoded
 */
export interface SearchConfig {
  buttonId: string;
  buttonValue: string;
  formId: string;
  fields: Record<string, string>;
  ajax: boolean;
  sectorField?: string;
  sectors?: Record<string, string>;
}

/** Maps semantic field names to 0-based column indices in rawCells. */
export interface ColumnMap {
  caseNumber: number;
  court?: number;
  date?: number;
  summary?: number;
  resolution?: number;
  pdfColIndex?: number;
}

export interface SiteConfig {
  name: string;
  baseUrl: string;
  startUrl: string;
  selectors: Selectors;
  timing: TimingConfig;
  search?: SearchConfig;
  columns: ColumnMap;
}

export interface ScrapeOptions {
  site: string;
  outputPath: string;
  pdfDir: string | null;
  failedPdfPath?: string | null;
  limit: number | null;
  dryRun: boolean;
  proxy: string | null;
  headed: boolean;
  profile: string | null;
  resume: boolean;         // true = load per-sector checkpoints; false = fresh start
  sectorId: string | null; // null = scrape all sectors; string = specific sector only
  pdfConcurrency?: number; // maximum concurrent PDF downloads per page
}

export interface Checkpoint {
  site: string;
  sectorId: string | null;
  lastPageIndex: number;
  totalScraped: number;
  completed: boolean;
  updatedAt: string;
}
