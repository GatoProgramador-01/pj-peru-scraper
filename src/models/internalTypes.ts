import type { AxiosInstance } from 'axios';
import { load as cheerioLoad } from 'cheerio';

export type $Root = ReturnType<typeof cheerioLoad>;

/** Shared HTTP client state: Axios instance, live cookie jar, and the portal's base URL. */
export interface Session {
  client: AxiosInstance;
  cookies: Map<string, string>;
  baseUrl: string;
}

/** JSF onclick action parameters needed to POST a PDF download through a form submission. */
export interface JsfAction {
  componentId: string;
  paramUuid: string;
}

/** A single result row after HTML parsing: raw cell text plus any resolved PDF reference. */
export interface ParsedRow {
  cells: string[];
  pdfUrl: string | null;
  pdfJsfAction: JsfAction | null;
  tipoRecurso?: string;
  sumilla?: string;
  palabrasClave?: string;
  fallo?: string;
  juecesRaw?: string;
  proceso?: string;
  distritoJudicialProcedencia?: string;
  expedienteProcedencia?: string;
  fechaResolucionProcedencia?: string;
  falloProcedencia?: string;
}

/** State snapshot of a JSF page: ViewState, parsed rows, paginator position, and active URL. */
export interface ParsedPage {
  viewState: string;
  formId: string;
  rows: ParsedRow[];
  hasNextPage: boolean;
  currentPage: number;
  totalPages: number | null;
  totalRecords: number | null;
  paginatorId: string | null;
  /** Active URL to use for pagination POSTs (may differ from startUrl after redirect). */
  activeUrl?: string;
}
