/**
 * Normalises a date string to ISO `YYYY-MM-DD` format.
 *
 * @remarks
 * Accepts `DD/MM/YYYY`, `DD-MM-YYYY`, and `DD.MM.YYYY` separators.
 * Non-matching input is returned trimmed as-is — never throws.
 *
 * @param raw - Raw date string from a scraped cell
 * @returns `YYYY-MM-DD` on match, or the trimmed original string otherwise
 * @example
 * normDate('15/03/2024'); // '2024-03-15'
 * normDate('15-03-2024'); // '2024-03-15'
 * normDate('unknown');    // 'unknown'
 */
export const normDate = (raw: string): string => {
  const m = raw.trim().match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : raw.trim();
};
