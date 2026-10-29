import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const tempDirs: string[] = [];
function fixture(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, '2026-10-28.jsonl'), text);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true });
});

describe('readNight', () => {
  it('reads the real night without dropping an unowned job or malformed line', () => {
    const digest = readNight('runs', '2026-10-28')!;
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest.rows[0].owner).toBeNull();
    expect(digest.rows[1]).toMatchObject({
      runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest.rows[3]).toMatchObject({ failures: 1, lastStatus: 'fail' });
    expect(readNight('runs', '2026-10-27')!.counts).toEqual({ ok: 7, retry: 0, fail: 0 });
  });

  it('keeps chronological bounds, latest owner/status/error, and original offsets', () => {
    const dir = fixture([
      { at: '2026-10-29T03:00:00+02:00', job: 'a', status: 'ok', owner: null },
      { at: '2026-10-29T02:00:00+02:00', job: 'a', status: 'retry', owner: 'old', error: 'newer error' },
      { at: '2026-10-29T00:00:00+01:00', job: 'a', status: 'fail', owner: 'old', error: 'older error' },
    ].map((run) => JSON.stringify(run)).join('\n') + '\n');
    expect(readNight(dir, '2026-10-28')!.rows[0]).toEqual({
      job: 'a', owner: null, runs: 3, retries: 1, failures: 1,
      lastStatus: 'ok', lastError: 'newer error',
      firstAt: '2026-10-29T00:00:00+01:00', lastAt: '2026-10-29T03:00:00+02:00',
    });
  });

  it('counts invalid JSON and invalid event shapes without throwing', () => {
    const valid = { at: '2026-10-28T01:00:00Z', job: 'a', status: 'ok', owner: null };
    const lines = [
      '{', 'null', '[]', '{}', '', JSON.stringify({ ...valid, owner: 4 }),
      JSON.stringify({ ...valid, status: 'other' }),
      JSON.stringify({ ...valid, status: ['ok'] }),
      JSON.stringify({ ...valid, at: 'not a date' }),
      JSON.stringify({ ...valid, error: 4 }), JSON.stringify(valid),
    ];
    const digest = readNight(fixture(lines.join('\r\n') + '\r\n'), '2026-10-28')!;
    expect(digest.badLines).toBe(10);
    expect(digest.rows).toHaveLength(1);
  });

  it('distinguishes missing, invalid, and empty nights', () => {
    const dir = fixture('');
    expect(readNight(dir, '2026-10-27')).toBeNull();
    expect(readNight(dir, '../2026-10-28')).toBeNull();
    expect(readNight(dir, '2026-10-28')).toEqual({
      night: '2026-10-28', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('does not disguise other filesystem errors as missing data', () => {
    const dir = fixture('');
    mkdirSync(join(dir, '2026-10-27.jsonl'));
    expect(() => readNight(dir, '2026-10-27')).toThrow();
  });
});
