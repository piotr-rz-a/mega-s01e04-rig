import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { NightDigest } from '../src/digest/types.js';
import { DigestPage } from '../src/views/digest.js';

const digest: NightDigest = {
  night: '2026-10-28',
  badLines: 1,
  counts: { ok: 3, retry: 1, fail: 1 },
  rows: [
    {
      job: 'backup',
      owner: null,
      runs: 2,
      retries: 3,
      failures: 0,
      lastStatus: 'retry',
      lastError: null,
      firstAt: '2026-10-28T01:00:00+01:00',
      lastAt: '2026-10-28T03:00:00+01:00',
    },
    {
      job: 'sync',
      owner: 'ana',
      runs: 1,
      retries: 0,
      failures: 1,
      lastStatus: 'fail',
      lastError: 'timeout',
      firstAt: '2026-10-28T02:00:00+01:00',
      lastAt: '2026-10-28T02:00:00+01:00',
    },
  ],
};

const empty: NightDigest = { night: '2026-10-27', badLines: 0, counts: { ok: 0, retry: 0, fail: 0 }, rows: [] };

function appWith(d: NightDigest) {
  return new Hono().get('/', (c) => c.html(<DigestPage digest={d} />));
}

describe('digest page', () => {
  it('renders a table with the header columns and keeps timestamp offsets', async () => {
    const html = await (await appWith(digest).request('/')).text();
    for (const h of ['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first time', 'last time']) {
      expect(html).toContain(`<th scope="col">${h}</th>`);
    }
    expect(html).toContain('2026-10-28T01:00:00+01:00');
    expect(html).toContain('2026-10-28T03:00:00+01:00');
  });

  it('shows missing owner and error as —', async () => {
    const html = await (await appWith(digest).request('/')).text();
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('<td>ana</td>');
    expect(html).toContain('<td>timeout</td>');
  });

  it('flags retries >= 3 and any failure, not the others', async () => {
    const html = await (await appWith(digest).request('/')).text();
    expect(html.match(/<tr class="warn">/g)).toHaveLength(2);
  });

  it('reports bad lines and nothing ran for an empty night', async () => {
    const html = await (await appWith(digest).request('/')).text();
    expect(html).toContain('1 malformed line</p>');
    const none = await (await appWith(empty).request('/')).text();
    expect(none).toContain('nothing ran');
    expect(none).not.toContain('<table>');
    expect(none).toContain('0 malformed lines');
  });
});
