import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { lex } from 'cms-vercel';
import { parse } from 'cms-vercel';
import { loadApp } from 'cms-vercel';
import { callFunction, Ctx } from 'cms-vercel';

describe('lexer', () => {
  it('tokenises a simple set call', () => {
    const t = lex(`set('x', 1)`, 'test.cms');
    expect(t.map(x => x.kind)).toEqual(['IDENT','LPAREN','STR','COMMA','NUM','RPAREN','EOF']);
  });

  it('tokenises end-function as a single keyword', () => {
    const t = lex(`function ping()\nend-function`, 'test.cms');
    expect(t.find(x => x.kind === 'KW_END_FUNCTION')).toBeDefined();
  });

  it('preserves backticked template strings', () => {
    const t = lex('`hello {{x}} world`', 'test.cms');
    expect(t[0]!.kind).toBe('TBSTR');
    expect(t[0]!.value).toBe('hello {{x}} world');
  });
});

describe('parser', () => {
  it('parses a single function with set + return', () => {
    const src = `function f()
        set('x', 1)
        return [x]
    end-function`;
    const parsed = parse(lex(src, 'test.cms'), 'test.cms');
    expect(parsed.funcs.length).toBe(1);
    expect(parsed.funcs[0]!.name).toBe('f');
    expect(parsed.funcs[0]!.body.length).toBe(2);
    expect(parsed.funcs[0]!.body[0]!.kind).toBe('Set');
    expect(parsed.funcs[0]!.body[1]!.kind).toBe('Return');
  });

  it('parses iterate iterator.ofEntity with multi-segment qualifier path', () => {
    const src = `function f()
        iterate iterator.ofEntity(
            entities: < <@iterator/entity name: 'tt', entity: 'qr/labelTemplate', orderBy: 'id'> >,
            rows: 1
        )
            set('n', 1)
        end-iterate
    end-function`;
    const parsed = parse(lex(src, 'test.cms'), 'test.cms');
    expect(parsed.funcs.length).toBe(1);
    expect(parsed.funcs[0]!.body[0]!.kind).toBe('Iterate');
  });

  it('parses protected resource blocks', () => {
    const src = `protected resource shell
        <@page/html `+'`<!doctype html><body>{{[main]}}</body>`'+`>
    end-resource`;
    const parsed = parse(lex(src, 'test.cms'), 'test.cms');
    expect(parsed.resources.length).toBe(1);
    expect(parsed.resources[0]!.name).toBe('shell');
  });
});

describe('Phase 3 — BO registry', () => {
  it('extracts a BO declaration from a parsed resource', async () => {
    // Self-contained test — no dependency on app/bo/* contents.
    const cms = await import('cms-vercel');
    const src = `function main() return script.get('./main') end-function
      protected resource main
        <@bo
          label: 'Demo items',
          table: 'demo_items',
          primaryKey: 'id',
          attributes: <
            id:    <@bo/attribute label: 'ID',   column: 'id',   dataType: dataType.Long,   length: 9>,
            name:  <@bo/attribute label: 'Name', column: 'name', dataType: dataType.String, length: 80>
          >,
          attributeGroups: <
            list: < 'name' >
          >
        >
      end-resource`;
    const parsed = cms.parse(cms.lex(src, 'demo.cms'), 'demo.cms');
    const main = parsed.resources.find(r => r.name === 'main')!;
    expect(main).toBeDefined();
    const info = cms.tryExtractBo('demo/items', main)!;
    expect(info).toBeDefined();
    expect(info.table).toBe('demo_items');
    expect(info.primaryKey).toBe('id');
    expect(info.attributes.has('name')).toBe(true);
    expect(info.listGroup).toEqual(['name']);
  });
});

describe('Phase 4 — function calls', () => {
  it('script.call invokes a same-file function and propagates the return value', async () => {
    const src = `function entry()
        return script.call('./helper', 7, 'x')
    end-function
    function helper(a, b)
        return concat([b], '=', formatString('{0}', sum([a], 1)))
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    // Re-parse our snippet on top of the existing registry
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'GET', url:'/x', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    const result = await callFunction(ctx, 'entry');
    expect(result).toBe('x=8');
  });
});

describe('Phase 5 — standard library', () => {
  it('today/format/addDay round-trip', async () => {
    const src = `function entry()
        set('t', addDay(today(), -1))
        return format([t], 'yyyy/MM/dd')
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'GET', url:'/x', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    const out = String(await callFunction(ctx, 'entry'));
    // Yesterday in YYYY/MM/DD form
    expect(out).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });
});

describe('Phase 6 — request introspection', () => {
  it('request.isPOST + qs.getUntrusted reads form-urlencoded body', async () => {
    const src = `function entry()
        return concat(
          if(request.isPOST(), 'POST', 'GET'),
          ':',
          qs.getUntrusted('name')
        )
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'POST', url:'/x', query:{ name:'Alice' }, body:'name=Alice', headers:{ 'content-type':'application/x-www-form-urlencoded' } },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    expect(await callFunction(ctx, 'entry')).toBe('POST:Alice');
  });
});

describe('Phase 18 — real auth', () => {
  it('qualifier.call(session/cookie:authenticate) returns false when no cookie present', async () => {
    const src = `function entry()
        return qualifier.call('session/cookie:authenticate')
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'GET', url:'/x', query:{}, body:'', headers: {} },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    // No cmsv_sid cookie → not authenticated.
    expect(await callFunction(ctx, 'entry')).toBe(false);
  });

  it('session.set marks the session dirty', async () => {
    const src = `function entry()
        session.set('user', 'alice')
        return session.get('user')
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'GET', url:'/x', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    expect(await callFunction(ctx, 'entry')).toBe('alice');
    expect(ctx.sessionDirty).toBe(true);
  });
});

describe('Phase 19 — page qualifiers', () => {
  it('renders @page/form + @page/form/control + @page/input/text', async () => {
    const src = `function entry()
        page.render(<@page/form
            method: 'POST',
            action: '/page/foo/f/save',
            content: <@page/form/control
                label: 'Your name',
                input: <@page/input/text name: 'name', value: ''>
            >
        >)
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'GET', url:'/x', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    await callFunction(ctx, 'entry');
    expect(ctx.res.body).toContain('<form method="POST"');
    expect(ctx.res.body).toContain('action="/page/foo/f/save"');
    expect(ctx.res.body).toContain('<input type="text" name="name"');
    expect(ctx.res.body).toContain('Your name');
  });

  it('renders @page/sidebar/link with active state', async () => {
    const src = `function entry()
        page.render(<@page/sidebar/link
            label: 'Home', url: '/', active: true
        >)
    end-function`;
    const reg = loadApp(join(process.cwd(), 'app'));
    const tokens = (await import('cms-vercel')).lex(src, 'inline.cms');
    const parsed = (await import('cms-vercel')).parse(tokens, 'inline.cms');
    for (const fn of parsed.funcs) reg.funcs.set(fn.name, fn);

    const ctx: Ctx = {
      funcs: reg.funcs, resources: reg.resources, bos: reg.bos,
      req: { method:'GET', url:'/x', query:{}, body:'' },
      res: { contentType:'text/plain', body:'', status:200, headers:{} },
    };
    await callFunction(ctx, 'entry');
    expect(ctx.res.body).toContain('class="cms-sidebar-link active"');
    expect(ctx.res.body).toContain('href="/"');
  });
});

describe('hello.cms (Phase 2)', () => {
  it('parses + renders to HTML containing the greeting', async () => {
    const reg = loadApp(join(process.cwd(), 'app'));
    expect(reg.funcs.has('hello')).toBe(true);
    expect(reg.resources.has('helloBody')).toBe(true);
    expect(reg.resources.has('helloShell')).toBe(true);

    const ctx: Ctx = {
      funcs: reg.funcs,
      resources: reg.resources,
      bos: reg.bos,
      req: { method: 'GET', url: '/page/foo/f/hello', query: {}, body: '' },
      res: { contentType: 'text/html', body: '', status: 200, headers: {} },
    };
    await callFunction(ctx, 'hello');

    expect(ctx.res.contentType).toMatch(/text\/html/);
    expect(ctx.res.body).toContain('<!doctype html>');
    expect(ctx.res.body).toContain('Hello from cms-vercel');
    expect(ctx.res.body).toContain('Phase 2');
    // resolveTemplate substituted [subtitle] with the eval'd concat
    expect(ctx.res.body).toContain('Time on server: 2');
  });
});
