import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs');

import fs from 'fs';
import { validateOutput } from '../../src/output/validator.js';

const mockedReadFileSync = vi.mocked(fs.readFileSync);

const buildJsonlLine = (id: string): string =>
  JSON.stringify({
    id,
    site: 'pj-peru',
    caseNumber: '123-2024',
    fetchedAt: '2024-01-01T00:00:00.000Z',
  });

const buildValidJsonl = (count = 10): string =>
  Array.from({ length: count }, (_, i) => buildJsonlLine(`DOC-${i + 1}`)).join('\n');

beforeEach(() => {
  vi.resetAllMocks();
});

describe('validateOutput', () => {
  it('does not read the file and does not throw when dryRun is true', () => {
    validateOutput('output/test.jsonl', 50, true);
    expect(mockedReadFileSync).not.toHaveBeenCalled();
  });

  it('throws with "VALIDATION FAILED" when total is 0', () => {
    expect(() => validateOutput('output/test.jsonl', 0, false)).toThrow('VALIDATION FAILED');
  });

  it('passes without throwing for a valid JSONL file with 10 records', () => {
    mockedReadFileSync.mockReturnValue(buildValidJsonl(10) as unknown as Buffer);
    expect(() => validateOutput('output/test.jsonl', 10, false)).not.toThrow();
    expect(mockedReadFileSync).toHaveBeenCalledWith('output/test.jsonl', 'utf8');
  });

  it('does not throw when there are duplicate IDs in the sample (only warns)', () => {
    // All lines share the same id — validator logs a warning but does not throw.
    const duplicateJsonl = Array.from({ length: 10 }, () => buildJsonlLine('SAME-ID')).join('\n');
    mockedReadFileSync.mockReturnValue(duplicateJsonl as unknown as Buffer);
    expect(() => validateOutput('output/test.jsonl', 10, false)).not.toThrow();
  });

  it('does not throw when optional fields are null (only warns per-field)', () => {
    // JudicialDocument has many nullable fields; validateOutput only checks id, site,
    // caseNumber and fetchedAt — those are all present here.
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({
        id: `DOC-${i}`,
        site: 'pj-peru',
        caseNumber: '123',
        fetchedAt: '2024-01-01T00:00:00.000Z',
        court: null,
        summary: null,
      }),
    ).join('\n');
    mockedReadFileSync.mockReturnValue(lines as unknown as Buffer);
    expect(() => validateOutput('output/test.jsonl', 10, false)).not.toThrow();
  });
});
