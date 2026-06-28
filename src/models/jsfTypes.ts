import type { ParsedPage } from './internalTypes.js';
import type { SiteConfig } from '../types.js';

/** Parameters that drive a single AJAX page-turn POST (target index, row size, JSF variant). */
export interface PaginationRequest {
  page: ParsedPage;
  targetPageIndex: number;
  rowsPerPage: number;
  useRichFaces?: boolean;
}

/** Identifies the portal endpoint and current page state required before submitting a search form. */
export interface SearchTarget {
  url: string;
  page: ParsedPage;
  config: SiteConfig;
}

/** Optional runtime narrowing applied on top of static SearchConfig: sector, district, and field overrides. */
export interface SearchFilter {
  sectorId?: string | null;
  districtId?: string | null;
  searchFields?: Record<string, string>;
}
