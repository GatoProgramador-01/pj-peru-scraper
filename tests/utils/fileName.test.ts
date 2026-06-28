import { describe, it, expect } from 'vitest';
import { buildId } from '../../src/utils/fileName.js';

describe('buildId', () => {
  describe('sectorId is null', () => {
    it('omits the sector segment when sectorId is null', () => {
      const result = buildId('pj-peru', 'EXP-001', '2024-01-15', null);
      expect(result).toBe('pj-peru_EXP_001_2024_01_15');
    });

    it('does not contain "_S" prefix when sectorId is null', () => {
      const result = buildId('oefa', '123/2023', '2023-06-01', null);
      expect(result).not.toContain('_S');
    });
  });

  describe('sectorId is non-null', () => {
    it('includes _S<sectorId> between site and caseNum', () => {
      const result = buildId('oefa', '123/2023', '2023-06-01', '42');
      expect(result).toContain('_S42_');
    });

    it('full format: <site>_S<sectorId>_<caseNum>_<date>', () => {
      const result = buildId('oefa', 'ABC-1', '2022-12-31', '7');
      expect(result).toBe('oefa_S7_ABC_1_2022_12_31');
    });
  });

  describe('special character replacement in caseNum', () => {
    it('replaces / with _', () => {
      const result = buildId('pj-peru', 'EXP/2024/001', '2024-01-01', null);
      expect(result).toContain('EXP_2024_001');
    });

    it('replaces spaces and hyphens with _', () => {
      const result = buildId('pj-peru', 'EXP 2024-001', '2024-01-01', null);
      expect(result).toContain('EXP_2024_001');
    });

    it('replaces dots with _', () => {
      const result = buildId('pj-peru', 'EXP.2024.001', '2024-01-01', null);
      expect(result).toContain('EXP_2024_001');
    });

    it('replaces all non-alphanumeric chars in date too', () => {
      const result = buildId('pj-peru', 'EXP001', '2024/01/15', null);
      expect(result).toContain('2024_01_15');
    });
  });

  describe('output is uppercase', () => {
    it('uppercases caseNum letters', () => {
      const result = buildId('pj-peru', 'exp-abc', '2024-01-01', null);
      expect(result).toContain('EXP_ABC');
    });

    it('uppercases the date segment (letters within date are uppercased)', () => {
      const result = buildId('pj-peru', 'X', 'abc-def-ghij', null);
      // site is not cleaned; only caseNum and date pass through clean() which calls .toUpperCase()
      // The date segment "abc-def-ghij" becomes "ABC_DEF_GHIJ"
      expect(result).toBe('pj-peru_X_ABC_DEF_GHIJ');
    });

    it('site string is passed through as-is (no upper forcing on site)', () => {
      const result = buildId('pj-peru', 'EXP001', '2024-01-01', null);
      // site is not passed through clean(), only caseNum and date are
      expect(result.startsWith('pj-peru')).toBe(true);
    });
  });

  describe('40-char truncation per cleaned segment', () => {
    it('truncates caseNum to 40 chars after cleaning', () => {
      const longCase = 'A'.repeat(60);
      const result = buildId('site', longCase, '2024-01-01', null);
      // Extract the caseNum segment (between first _ and last _)
      const parts = result.split('_');
      // caseNum part is all 'A's — confirm it's ≤ 40
      const caseSegment = parts.find(p => /^A+$/.test(p));
      expect(caseSegment).toBeDefined();
      expect(caseSegment!.length).toBeLessThanOrEqual(40);
    });

    it('truncates date segment to 40 chars after cleaning', () => {
      const longDate = '1'.repeat(60);
      const result = buildId('site', 'EXP', longDate, null);
      const parts = result.split('_');
      const dateSegment = parts[parts.length - 1];
      expect(dateSegment.length).toBeLessThanOrEqual(40);
    });
  });

  describe('combined scenarios', () => {
    it('handles typical pj-peru case with sector', () => {
      const result = buildId('pj-peru', '00007-2023-0-5001-JR-PE-01', '2023-08-14', '5001');
      expect(result).toBe('pj-peru_S5001_00007_2023_0_5001_JR_PE_01_2023_08_14');
    });

    it('handles oefa case without sector', () => {
      const result = buildId('oefa', 'TFA-001/2022', '2022-03-05', null);
      expect(result).toBe('oefa_TFA_001_2022_2022_03_05');
    });
  });
});
