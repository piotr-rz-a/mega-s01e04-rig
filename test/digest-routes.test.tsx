import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { DigestRow, NightDigest } from '../src/digest/types.js';

const NIGHT = '2026-10-29';

type Line = Record<string, string | null> | string;

// Synthetic night: 11 valid events over 6 jobs, one malformed line (kept as a raw string).
const MAIN_NIGHT: Line[] = [
  { at: '2026-10-29T01:00:00+02:00', job: 'sync/users', status: 'ok', owner: 'ana' },
  { at: '2026-10-29T01:05:00+05:30', job: 'backup/db', status: 'retry', owner: null, error: 'disk busy' },
  'not json at all',
  { at: '2026-10-29T01:10:00+05:30', job: 'backup/db', status: 'retry', owner: null, error: 'disk busy' },
  { at: '2026-10-29T01:15:00+05:30', job: 'backup/db', status: 'retry', owner: null, error: 'disk busy' },
  { at: '2026-10-29T01:20:00+05:30', job: 'backup/db', status: 'ok', owner: null },
  { at: '2026-10-29T02:00:00+02:00', job: 'mail/digest', status: 'fail', owner: 'ben', error: 'smtp 421' },
  { at: '2026-10-29T02:30:00Z', job: 'cache/warm', status: 'ok', owner: 'ana' },
  { at: '2026-10-29T02:45:00-03:00', job: 'alpha/report', status: 'retry', owner: 'ben', error: 'x' },
  { at: '2026-10-29T02:50:00+02:00', job: 'nightly/tidy', status: 'retry', owner: 'ana', error: 'lock' },
  { at: '2026-10-29T03:00:00+02:00', job: 'nightly/tidy', status: 'retry', owner: 'ana', error: 'lock' },
  { at: '2026-10-29T03:10:00+02:00', job: 'nightly/tidy', status: 'ok', owner: 'ana' },
];

// What the reader must produce for MAIN_NIGHT, sorted by job.
const EXPECTED_ROWS: DigestRow[] = [
  {
    job: 'alpha/report', owner: 'ben', runs: 1, retries: 1, failures: 0, lastStatus: 'retry', lastError: 'x',
    firstAt: '2026-10-29T02:45:00-03:00', lastAt: '2026-10-29T02:45:00-03:00',
  },
  {
    job: 'backup/db', owner: null, runs: 4, retries: 3, failures: 0, lastStatus: 'ok', lastError: 'disk busy',
    firstAt: '2026-10-29T01:05:00+05:30', lastAt: '2026-10-29T01:20:00+05:30',
  },
  {
    job: 'cache/warm', owner: 'ana', runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null,
    firstAt: '2026-10-29T02:30:00Z', lastAt: '2026-10-29T02:30:00Z',
  },
  {
    job: 'mail/digest', owner: 'ben', runs: 1, retries: 0, failures: 1, lastStatus: 'fail', lastError: 'smtp 421',
    firstAt: '2026-10-29T02:00:00+02:00', lastAt: '2026-10-29T02:00:00+02:00',
  },
  {
    job: 'nightly/tidy', owner: 'ana', runs: 3, retries: 2, failures: 0, lastStatus: 'ok', lastError: 'lock',
    firstAt: '2026-10-29T02:50:00+02:00', lastAt: '2026-10-29T03:10:00+02:00',
  },
  {
    job: 'sync/users', owner: 'ana', runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null,
    firstAt: '2026-10-29T01:00:00+02:00', lastAt: '2026-10-29T01:00:00+02:00',
  },
];

const EXPECTED_COUNTS = { ok: 4, retry: 6, fail: 1 };

// HTML body cells after the job column: owner, runs, retries, last status, last error, first, last.
const EXPECTED_HTML_CELLS: Record<string, string[]> = {
  'alpha/report': ['ben', '1', '1', 'retry', 'x', '2026-10-29T02:45:00-03:00', '2026-10-29T02:45:00-03:00'],
  'backup/db': ['—', '4', '3', 'ok', 'disk busy', '2026-10-29T01:05:00+05:30', '2026-10-29T01:20:00+05:30'],
  'cache/warm': ['ana', '1', '0', 'ok', '—', '2026-10-29T02:30:00Z', '2026-10-29T02:30:00Z'],
  'mail/digest': ['ben', '1', '0', 'fail', 'smtp 421', '2026-10-29T02:00:00+02:00', '2026-10-29T02:00:00+02:00'],
  'nightly/tidy': ['ana', '3', '2', 'ok', 'lock', '2026-10-29T02:50:00+02:00', '2026-10-29T03:10:00+02:00'],
  'sync/users': ['ana', '1', '0', 'ok', '—', '2026-10-29T01:00:00+02:00', '2026-10-29T01:00:00+02:00'],
};

// Only retries >= 3 or any failure is flagged. nightly/tidy (2 retries) is the just-below case.
const EXPECTED_FLAGGED = new Set(['backup/db', 'mail/digest']);

const SORTED_JOBS = ['alpha/report', 'backup/db', 'cache/warm', 'mail/digest', 'nightly/tidy', 'sync/users'];

const ROW_KEYS = ['failures', 'firstAt', 'job', 'lastAt', 'lastError', 'lastStatus', 'owner', 'retries', 'runs'];

type HtmlRow = { job: string; flagged: boolean; cells: string[] };

// Reads tbody rows from the rendered page. The page is self-contained, so this is enough.
function bodyRows(html: string): HtmlRow[] {
  const body = html.split('<tbody>')[1]?.split('</tbody>')[0];
  if (body === undefined) throw new Error('page has no table body');
  return [...body.matchAll(/<tr( class="warn")?>([\s\S]*?)<\/tr>/g)].map((row) => {
    const cells = [...row[2].matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/g)].map((cell) => cell[2]);
    return { job: cells[0], flagged: row[1] !== undefined, cells: cells.slice(1) };
  });
}

describe('digest routes', () => {
  let runsDir: string;

  const config = (): RigConfig => ({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });

  const app = () => createApp(config());

  function writeNight(lines: Line[], night = NIGHT) {
    const text = lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n');
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.length > 0 ? `${text}\n` : '');
  }

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  describe('GET /digest/:night', () => {
    it('renders one row per job, sorted, with the reader values', async () => {
      writeNight(MAIN_NIGHT);
      const res = await app().request(`/digest/${NIGHT}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain(`<h1>digest · ${NIGHT}</h1>`);

      const rows = bodyRows(html);
      expect(rows.map((row) => row.job)).toEqual(SORTED_JOBS);
      for (const row of rows) {
        expect(row.cells).toEqual(EXPECTED_HTML_CELLS[row.job]);
      }
    });

    it('shows the malformed-line count and keeps the valid rows', async () => {
      writeNight(MAIN_NIGHT);
      const html = await (await app().request(`/digest/${NIGHT}`)).text();
      expect(html).toContain('<p class="warn">1 malformed line</p>');
      expect(bodyRows(html)).toHaveLength(SORTED_JOBS.length);
    });

    it('returns 404 for a night with no file and for an invalid night name', async () => {
      writeNight(MAIN_NIGHT);
      for (const night of ['2026-10-27', '2026-99-99', 'tomorrow']) {
        const res = await app().request(`/digest/${night}`);
        expect(res.status, night).toBe(404);
      }
    });

    it('renders "nothing ran" and no table for an empty file', async () => {
      writeNight([]);
      const res = await app().request(`/digest/${NIGHT}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<p class="mute">nothing ran</p>');
      expect(html).not.toContain('<table>');
      expect(html).toContain('<p class="mute">0 malformed lines</p>');
    });

    it('renders "nothing ran" when every line is malformed and counts them', async () => {
      writeNight(['garbage', '{"nope":1}']);
      const html = await (await app().request(`/digest/${NIGHT}`)).text();
      expect(html).toContain('nothing ran');
      expect(html).not.toContain('<table>');
      expect(html).toContain('<p class="warn">2 malformed lines</p>');
    });

    it('renders null owner and null error as —', async () => {
      writeNight(MAIN_NIGHT);
      const rows = bodyRows(await (await app().request(`/digest/${NIGHT}`)).text());
      const backup = rows.find((row) => row.job === 'backup/db');
      const cache = rows.find((row) => row.job === 'cache/warm');
      expect(backup?.cells[0]).toBe('—');
      expect(cache?.cells[4]).toBe('—');
    });

    it('flags retries >= 3 and any failure, and nothing else', async () => {
      writeNight(MAIN_NIGHT);
      const html = await (await app().request(`/digest/${NIGHT}`)).text();
      expect(html.match(/<tr class="warn">/g)).toHaveLength(EXPECTED_FLAGGED.size);
      for (const row of bodyRows(html)) {
        expect(row.flagged, row.job).toBe(EXPECTED_FLAGGED.has(row.job));
      }
    });

    it('keeps original offsets, never converted to UTC', async () => {
      writeNight(MAIN_NIGHT);
      const html = await (await app().request(`/digest/${NIGHT}`)).text();
      for (const row of EXPECTED_ROWS) {
        expect(html).toContain(row.firstAt);
        expect(html).toContain(row.lastAt);
      }
      expect(html).not.toContain('2026-10-28T19:35');
    });
  });

  describe('GET /api/digest/:night', () => {
    it('returns the NightDigest shape with the reader values', async () => {
      writeNight(MAIN_NIGHT);
      const res = await app().request(`/api/digest/${NIGHT}`);
      expect(res.status).toBe(200);
      const body: NightDigest = await res.json();
      expect(Object.keys(body).sort()).toEqual(['badLines', 'counts', 'night', 'rows']);
      expect(body.night).toBe(NIGHT);
      expect(body.badLines).toBe(1);
      expect(body.counts).toEqual(EXPECTED_COUNTS);
      expect(body.rows).toEqual(EXPECTED_ROWS);
      for (const row of body.rows) {
        expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
      }
    });

    it('keeps every valid event in the rows, not just the malformed count', async () => {
      writeNight(MAIN_NIGHT);
      const body: NightDigest = await (await app().request(`/api/digest/${NIGHT}`)).json();
      const runs = body.rows.reduce((sum, row) => sum + row.runs, 0);
      const counted = body.counts.ok + body.counts.retry + body.counts.fail;
      expect(runs).toBe(11);
      expect(counted).toBe(11);
    });

    it('returns 404 for a night with no file and for an invalid night name', async () => {
      writeNight(MAIN_NIGHT);
      for (const night of ['2026-10-27', '2026-99-99', 'tomorrow']) {
        const res = await app().request(`/api/digest/${night}`);
        expect(res.status, night).toBe(404);
      }
    });

    it('returns empty rows and zero counts for an empty file', async () => {
      writeNight([]);
      const res = await app().request(`/api/digest/${NIGHT}`);
      expect(res.status).toBe(200);
      const body: NightDigest = await res.json();
      expect(body).toEqual({
        night: NIGHT, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
      });
    });

    it('counts malformed lines and returns no rows when all lines are bad', async () => {
      writeNight(['garbage', '{"nope":1}']);
      const body: NightDigest = await (await app().request(`/api/digest/${NIGHT}`)).json();
      expect(body.badLines).toBe(2);
      expect(body.rows).toEqual([]);
    });

    it('keeps null owner and null error as null, not —', async () => {
      writeNight(MAIN_NIGHT);
      const body: NightDigest = await (await app().request(`/api/digest/${NIGHT}`)).json();
      const backup = body.rows.find((row) => row.job === 'backup/db');
      const cache = body.rows.find((row) => row.job === 'cache/warm');
      expect(backup?.owner).toBeNull();
      expect(cache?.lastError).toBeNull();
    });

    it('sorts rows by job name', async () => {
      writeNight(MAIN_NIGHT);
      const body: NightDigest = await (await app().request(`/api/digest/${NIGHT}`)).json();
      expect(body.rows.map((row) => row.job)).toEqual(SORTED_JOBS);
    });

    it('keeps original offsets in firstAt and lastAt', async () => {
      writeNight(MAIN_NIGHT);
      const body: NightDigest = await (await app().request(`/api/digest/${NIGHT}`)).json();
      const backup = body.rows.find((row) => row.job === 'backup/db');
      expect(backup?.firstAt).toBe('2026-10-29T01:05:00+05:30');
      expect(backup?.lastAt).toBe('2026-10-29T01:20:00+05:30');
    });
  });

  describe('HTML/JSON parity', () => {
    it('agrees on job order, cell values, and flags', async () => {
      writeNight(MAIN_NIGHT);
      const html = await (await app().request(`/digest/${NIGHT}`)).text();
      const body: NightDigest = await (await app().request(`/api/digest/${NIGHT}`)).json();
      const rows = bodyRows(html);

      expect(rows.map((row) => row.job)).toEqual(body.rows.map((row) => row.job));
      body.rows.forEach((row, i) => {
        expect(rows[i].cells, row.job).toEqual([
          row.owner ?? '—',
          String(row.runs),
          String(row.retries),
          row.lastStatus,
          row.lastError ?? '—',
          row.firstAt,
          row.lastAt,
        ]);
        expect(rows[i].flagged, row.job).toBe(row.retries >= 3 || row.failures > 0);
      });
    });
  });
});
