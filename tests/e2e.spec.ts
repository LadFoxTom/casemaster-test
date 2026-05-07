import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { loadApp } from 'cms-vercel';
import { callFunction, Ctx } from 'cms-vercel';

// Live-DB e2e is gated on DATABASE_URL being present (set via .env.local
// for local runs, or the CI's secret store). Without it we skip rather
// than hard-fail, so secret-less environments still pass the suite.
const hasDb = Boolean(process.env.DATABASE_URL);
const maybe = hasDb ? describe : describe.skip;

maybe('end-to-end ping', () => {
  it('parses + executes ping.cms against live Neon and writes "ok N\\n"', async () => {
    const reg = loadApp(join(process.cwd(), 'app'));
    expect(reg.funcs.has('ping')).toBe(true);

    const ctx: Ctx = {
      funcs: reg.funcs,
      resources: reg.resources,
      bos: reg.bos,
      req: { method: 'GET', url: '/page/foo/f/ping', query: {}, body: '' },
      res: { contentType: 'text/html', body: '', status: 200, headers: {} },
    };
    await callFunction(ctx, 'ping');

    expect(ctx.res.contentType).toBe('text/plain');
    expect(ctx.res.body).toMatch(/^ok \d+\n$/);
  }, 30_000);
});
