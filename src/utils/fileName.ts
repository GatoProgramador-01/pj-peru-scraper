export const buildId = (site: string, caseNum: string, date: string, sectorId: string | null): string => {
  const clean = (s: string) => s.replace(/[^A-Z0-9]/gi, '_').toUpperCase().slice(0, 40);
  const sectorPart = sectorId ? `_S${sectorId}` : '';
  return `${site}${sectorPart}_${clean(caseNum)}_${clean(date)}`;
};
