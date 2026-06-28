/**
 * Builds a stable document ID from site, case number, date, and sector.
 *
 * @remarks
 * Output format: `<site>[_S<sectorId>]_<CLEAN_CASENUM>_<CLEAN_DATE>`.
 * `clean()` uppercases and replaces non-alphanumeric characters with `_`,
 * then truncates to 40 characters.  `site` is used verbatim — it is NOT
 * passed through `clean()`.
 *
 * @param site - Site key used as-is at the start of the ID (e.g. `'pj'`)
 * @param caseNum - Raw case number; cleaned and uppercased
 * @param date - Normalised date string (`YYYY-MM-DD`); cleaned and uppercased
 * @param sectorId - Optional sector identifier; inserts `_S<sectorId>` when present
 * @returns Composite document ID string
 * @example
 * buildId('pj', '00123-2024-0-1801-JR-PE-01', '2024-03-15', null);
 * // 'pj_00123_2024_0_1801_JR_PE_01_2024_03_15'
 */
export const buildId = (site: string, caseNum: string, date: string, sectorId: string | null): string => {
  const clean = (s: string) => s.replace(/[^A-Z0-9]/gi, '_').toUpperCase().slice(0, 40);
  const sectorPart = sectorId ? `_S${sectorId}` : '';
  return `${site}${sectorPart}_${clean(caseNum)}_${clean(date)}`;
};
