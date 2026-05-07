# Changelog

Notable changes to the `cms-vercel` package. Versions follow [SemVer]:
0.x is pre-stable, breaking changes can land on minor bumps. From 1.0
onward, breaking changes require a major bump.

[SemVer]: https://semver.org

## 0.1.0 — Unreleased

First versioned cut. Track 1 (Phases 1–12) built the proof of concept;
Track 2 (Phases 13–22) turned it into a packaged toolchain.

### Added

- `createHandler({ appDir, loaderHook, onError })` — single-line
  Vercel-Function entrypoint. ([Phase 13])
- `npm create cms-vercel my-app` scaffold. ([Phase 14])
- `cms-vercel-build` validator: reports unknown calls + qualifiers
  with `file:line:col`. ([Phase 15])
- `cms-vercel-import` migrates a CaseMaster runtime layout. ([Phase 12])
- `cms-vercel-bench` latency harness. ([Phase 11])
- `bo.create` / `bo.setAttr` / `bo.persist` / `bo.delete`,
  `sql.execute`, `sql.fetch`. ([Phase 16])
- `httpRequest.create` / `responseBody` / `responseStatus`. ([Phase 17])
- Postgres-backed sessions (`cms_session` table, `cmsv_sid` cookie),
  `qualifier.call('session/cookie:authenticate')`, `session.get/set`,
  CSRF token helpers. ([Phase 18])
- Page qualifiers: `page/data/table`, `page/form` family, every
  `page/input/*`, `page/sidebar` family, `page/icon`, `page/table/link`,
  `<@url>`. ([Phase 19])
- Auto BO maintenance pages at `/maintenance/<bo>`: list (paginated),
  edit, new, save (POST), delete (POST). ([Phase 20])
- Parity CI workflow (`workflow_dispatch`-triggered) running the
  official CaseMaster runtime on Windows alongside cms-vercel. ([Phase 21])
- API reference (`API.md`), migration guide (`MIGRATION.md`),
  package README. ([Phase 22])

### Known limitations

See [`UNSUPPORTED.md`](./UNSUPPORTED.md). The validator (`cms-vercel-build`)
is the canonical mechanism for surfacing what doesn't work in your app.

### Versioning policy

- 0.x: minor releases may break. `cms-vercel-build` is your safety net.
- 1.0: cuts when a real CaseMaster app (Axylog Integration) ships
  its read paths in production on cms-vercel.

[Phase 11]: ./ROADMAP.md#phase-11--performance
[Phase 12]: ./ROADMAP.md#phase-12--migration-tooling--parity-tests
[Phase 13]: ./ROADMAP.md#phase-13--package-extraction
[Phase 14]: ./ROADMAP.md#phase-14--scaffold-tool
[Phase 15]: ./ROADMAP.md#phase-15--build-time-validator
[Phase 16]: ./ROADMAP.md#phase-16--close-the-writer-gap
[Phase 17]: ./ROADMAP.md#phase-17--outbound-http
[Phase 18]: ./ROADMAP.md#phase-18--real-auth--sessions
[Phase 19]: ./ROADMAP.md#phase-19--more-page-qualifiers
[Phase 20]: ./ROADMAP.md#phase-20--auto-bo-maintenance
[Phase 21]: ./ROADMAP.md#phase-21--parity-ci
[Phase 22]: ./ROADMAP.md#phase-22--docs--010-release
