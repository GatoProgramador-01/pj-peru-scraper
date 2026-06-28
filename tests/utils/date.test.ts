import { describe, it, expect } from 'vitest';
import { normDate } from '../../src/utils/date.js';

describe('normDate', () => {
  describe('slash separator (DD/MM/YYYY)', () => {
    it('converts 01/15/2024 to 2024-15-01 (day=01, month=15)', () => {
      // regex captures (\d{1,2})/(\d{1,2})/(\d{4}) → group1=day group2=month
      expect(normDate('01/15/2024')).toBe('2024-15-01');
    });

    it('converts 15/01/2024 to 2024-01-15 with zero-padding', () => {
      expect(normDate('15/01/2024')).toBe('2024-01-15');
    });

    it('zero-pads single-digit day and month', () => {
      expect(normDate('5/3/2022')).toBe('2022-03-05');
    });
  });

  describe('dash separator (DD-MM-YYYY)', () => {
    it('converts 5-3-2022 to 2022-03-05', () => {
      expect(normDate('5-3-2022')).toBe('2022-03-05');
    });

    it('converts 12-06-2020 to 2020-06-12', () => {
      expect(normDate('12-06-2020')).toBe('2020-06-12');
    });
  });

  describe('dot separator (DD.MM.YYYY)', () => {
    it('converts 20.11.2019 to 2019-11-20', () => {
      expect(normDate('20.11.2019')).toBe('2019-11-20');
    });

    it('zero-pads single-digit values with dot separator', () => {
      expect(normDate('1.2.2023')).toBe('2023-02-01');
    });
  });

  describe('no-match fallback', () => {
    it('returns the trimmed input when no date pattern is found', () => {
      expect(normDate('  no-date-here  ')).toBe('no-date-here');
    });

    it('returns empty string trimmed when input is blank', () => {
      expect(normDate('   ')).toBe('');
    });

    it('returns trimmed input for an already-ISO-formatted date', () => {
      expect(normDate('  2024-01-15  ')).toBe('2024-01-15');
    });
  });

  describe('leading and trailing whitespace', () => {
    it('trims surrounding spaces before matching', () => {
      expect(normDate('  7/8/2021  ')).toBe('2021-08-07');
    });
  });
});
