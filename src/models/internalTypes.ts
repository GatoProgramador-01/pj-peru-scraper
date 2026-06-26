import type { AxiosInstance } from 'axios';
import { load as cheerioLoad } from 'cheerio';

export type $Root = ReturnType<typeof cheerioLoad>;

export interface Session {
  client: AxiosInstance;
  cookies: Map<string, string>;
  baseUrl: string;
}

export interface JsfAction {
  componentId: string;
  paramUuid: string;
}

export interface ParsedRow {
  cells: string[];
  pdfUrl: string | null;
  pdfJsfAction: JsfAction | null;
}

export interface ParsedPage {
  viewState: string;
  formId: string;
  rows: ParsedRow[];
  hasNextPage: boolean;
  currentPage: number;
  totalPages: number | null;
  totalRecords: number | null;
  paginatorId: string | null;
}
