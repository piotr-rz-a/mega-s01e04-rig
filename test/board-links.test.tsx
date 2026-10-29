import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

describe('status board night links', () => {
  it('links each night to its digest with explicit counts', async () => {
    const html = await (await createApp(config).request('/')).text();
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('href="/digest/2026-10-27"');
    expect(html).toMatch(/2026-10-28<\/a><\/td><td>10<\/td><td>4<\/td><td>1<\/td>/);
    expect(html).toMatch(/2026-10-27<\/a><\/td><td>7<\/td><td>0<\/td><td>0<\/td>/);
  });
});
