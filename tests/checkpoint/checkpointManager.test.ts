import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs');

import fs from 'fs';
import { loadCheckpoint, saveCheckpoint } from '../../src/checkpoint/checkpointManager.js';

const mockedReadFileSync = vi.mocked(fs.readFileSync);
const mockedWriteFileSync = vi.mocked(fs.writeFileSync);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('loadCheckpoint', () => {
  it('returns { startPage: 0, completed: false } when the checkpoint file does not exist', () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });
    const result = loadCheckpoint('pj-peru', 's1');
    expect(result).toEqual({ startPage: 0, completed: false });
  });

  it('returns { startPage: 0, completed: true } when the checkpoint has completed: true', () => {
    const cp = JSON.stringify({
      site: 'pj-peru',
      sectorId: 's1',
      lastPageIndex: 5,
      totalScraped: 100,
      completed: true,
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    mockedReadFileSync.mockReturnValue(cp as unknown as Buffer);
    const result = loadCheckpoint('pj-peru', 's1');
    expect(result).toEqual({ startPage: 0, completed: true });
  });

  it('returns { startPage: lastPageIndex, completed: false } when the checkpoint is incomplete', () => {
    const cp = JSON.stringify({
      site: 'pj-peru',
      sectorId: 's1',
      lastPageIndex: 3,
      totalScraped: 60,
      completed: false,
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    mockedReadFileSync.mockReturnValue(cp as unknown as Buffer);
    const result = loadCheckpoint('pj-peru', 's1');
    expect(result).toEqual({ startPage: 3, completed: false });
  });
});

describe('saveCheckpoint', () => {
  it('calls fs.writeFileSync with the correct path and JSON content', () => {
    mockedWriteFileSync.mockImplementation(() => undefined);

    // sectorId '1' → cpPath produces "checkpoint_pj-peru_s1"
    saveCheckpoint('pj-peru', '1', 7, 140, false);

    expect(mockedWriteFileSync).toHaveBeenCalledOnce();
    const [calledPath, calledContent] = mockedWriteFileSync.mock.calls[0] as [string, string];

    // Path must contain the site and sector fragment
    expect(calledPath).toContain('checkpoint_pj-peru_s1');
    expect(calledPath).toContain('output');

    const written = JSON.parse(calledContent);
    expect(written.site).toBe('pj-peru');
    expect(written.sectorId).toBe('1');
    expect(written.lastPageIndex).toBe(7);
    expect(written.totalScraped).toBe(140);
    expect(written.completed).toBe(false);
    expect(typeof written.updatedAt).toBe('string');
  });

  it('marks completed: true when the completed flag is passed', () => {
    mockedWriteFileSync.mockImplementation(() => undefined);

    saveCheckpoint('pj-peru', '1', 20, 400, true);

    const [, calledContent] = mockedWriteFileSync.mock.calls[0] as [string, string];
    const written = JSON.parse(calledContent);
    expect(written.completed).toBe(true);
  });

  it('includes districtId and checkpointId in the file path when provided', () => {
    mockedWriteFileSync.mockImplementation(() => undefined);

    // districtId '2' → cpPath produces "_d2"; checkpointId 'partition-A' → "_partition-A"
    saveCheckpoint('pj-peru', '1', 0, 0, false, '2', 'partition-A');

    const [calledPath] = mockedWriteFileSync.mock.calls[0] as [string, string];
    expect(calledPath).toContain('_d2');
    expect(calledPath).toContain('partition-A');
  });
});
