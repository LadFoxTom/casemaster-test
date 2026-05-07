/**
 * Public entry point for `cms-vercel`. Consumers do:
 *
 *   // api/index.ts
 *   import { createHandler } from 'cms-vercel';
 *   export default createHandler({ appDir: './app' });
 *
 * That's the entire integration. Everything else lives inside the
 * package — parser, interpreter, BO registry, page rendering, Postgres
 * pool, the lot. Upgrades happen with `npm update cms-vercel`.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadApp, AppRegistry } from './loader.js';
import { callFunction, Ctx } from './eval.js';
import { newSessionId, persistSession, buildCookie } from './session.js';
import { handleMaintenance } from './maintenance.js';

export interface CreateHandlerOptions {
  /** Absolute or process.cwd()-relative path to the .cms application. */
  appDir?: string;
  /**
   * Hook to mutate the registry after parsing — useful for plugin-style
   * extensions in later phases (custom qualifiers, alternative
   * authenticators). Phase 13 keeps it as a no-op surface.
   */
  loaderHook?: (reg: AppRegistry) => void;
  /**
   * Custom error renderer. Defaults to `text/plain` with the `Error: …`
   * message — matches what we ship today.
   */
  onError?: (err: unknown, req: VercelRequest, res: VercelResponse) => void;
}

export function createHandler(opts: CreateHandlerOptions = {}) {
  const APP_DIR = resolveAppDir(opts.appDir);

  // Module-scoped registry: parsed once per warm Vercel instance.
  let appRegistry: AppRegistry | null = null;
  let appRegistryError: Error | null = null;
  function registry(): AppRegistry {
    if (appRegistry) return appRegistry;
    try {
      appRegistry = loadApp(APP_DIR);
      opts.loaderHook?.(appRegistry);
      return appRegistry;
    } catch (e: any) {
      appRegistryError = e;
      throw e;
    }
  }

  return async function handler(req: VercelRequest, res: VercelResponse) {
    // ?diag=1 — surface registry / app-dir state without touching DB or interpreter.
    if (req.url && /[?&]diag=1/.test(req.url)) {
      res.status(200).setHeader('Content-Type', 'application/json').send(JSON.stringify({
        ok: true,
        cwd: process.cwd(),
        appDir: APP_DIR,
        appDirExists: existsSync(APP_DIR),
        hasDbUrl: Boolean(process.env.DATABASE_URL),
        registryError: appRegistryError ? String(appRegistryError) : null,
        loadedFns: appRegistry ? [...appRegistry.funcs.keys()] : null,
      }, null, 2));
      return;
    }

    // ?stats=1 — registry warmth + counts.
    if (req.url && /[?&]stats=1/.test(req.url)) {
      const tStart = Date.now();
      let buildMs: number | null = null;
      if (!appRegistry) {
        const tBuild = Date.now();
        try { registry(); } catch { /* surfaced via registryError above */ }
        buildMs = Date.now() - tBuild;
      }
      res.status(200).setHeader('Content-Type', 'application/json').send(JSON.stringify({
        ok: true,
        registryAlreadyWarm: buildMs === null,
        registryBuildMs: buildMs,
        funcs: appRegistry?.funcs.size ?? 0,
        resources: appRegistry?.resources.size ?? 0,
        bos: appRegistry?.bos.size ?? 0,
        requestTotalMs: Date.now() - tStart,
        cold: !appRegistry,
      }, null, 2));
      return;
    }

    try {
      // After Vercel's rewrite, req.url is `/api?_p=/page/foo/f/ping`.
      // Pull the original path out of `_p` so routing is consistent.
      const rawUrl = req.url ?? '/';
      const tmp = new URL(rawUrl, 'http://x');
      const proxied = tmp.searchParams.get('_p') ?? rawUrl;
      tmp.searchParams.delete('_p');
      const remainingQs = tmp.searchParams.toString();
      const url = new URL(proxied + (remainingQs ? `?${remainingQs}` : ''), 'http://x');

      const bodyStr0 = typeof req.body === 'string' ? req.body
                     : (req.body && typeof req.body === 'object') ? JSON.stringify(req.body)
                     : '';
      const ct0 = String(req.headers['content-type'] ?? '');
      const formQuery0: Record<string,string> = {};
      if (ct0.includes('application/x-www-form-urlencoded') && bodyStr0) {
        for (const [k, v] of new URLSearchParams(bodyStr0)) formQuery0[k] = v;
      }
      const mergedQuery = { ...Object.fromEntries(url.searchParams), ...formQuery0 };

      // Phase 20: auto BO maintenance pages. Returns true if the
      // request was handled.
      if (await handleMaintenance(
        { bos: registry().bos },
        req, res, url.pathname, mergedQuery, bodyStr0,
      )) return;

      const m = url.pathname.match(/^\/page\/([^/]+)\/f\/([^/]+)$/);
      if (!m) {
        res.status(404).setHeader('Content-Type', 'text/plain')
           .send(`no route for ${url.pathname}`);
        return;
      }
      const fnName = m[2]!;
      const reg = registry();
      if (!reg.funcs.has(fnName)) {
        res.status(404).setHeader('Content-Type', 'text/plain')
           .send(`function not found: ${fnName} (loaded: ${[...reg.funcs.keys()].join(', ')})`);
        return;
      }

      const ctx: Ctx = {
        funcs:     reg.funcs,
        resources: reg.resources,
        bos:       reg.bos,
        req: {
          method: req.method ?? 'GET',
          url: url.toString(),
          query: mergedQuery,
          body: bodyStr0,
          headers: req.headers as Record<string, string|undefined>,
        },
        res: { contentType: 'text/html', body: '', status: 200, headers: {} },
      };

      await callFunction(ctx, fnName, []);

      // Phase 18: write the session back if the function called session.set.
      // New sessions get a generated id + Set-Cookie header.
      if (ctx.sessionDirty) {
        if (!ctx.session?.id) {
          ctx.session = { id: newSessionId(), payload: ctx.session?.payload ?? {} };
          res.setHeader('Set-Cookie', buildCookie(ctx.session.id));
        }
        await persistSession(ctx.session.id, ctx.session.payload);
      }

      if (ctx.res.redirect) {
        res.status(302).setHeader('Location', ctx.res.redirect).send('');
        return;
      }
      res.status(ctx.res.status)
         .setHeader('Content-Type', ctx.res.contentType)
         .send(ctx.res.body);
    } catch (e: any) {
      if (opts.onError) { opts.onError(e, req, res); return; }
      res.status(500).setHeader('Content-Type', 'text/plain')
         .send(`Error: ${e?.message ?? String(e)}`);
    }
  };
}

function resolveAppDir(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.CMS_APP_DIR,
    join(process.cwd(), 'app'),
    '/var/task/app',
    join(process.cwd(), '..', 'app'),
  ].filter(Boolean) as string[];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}
