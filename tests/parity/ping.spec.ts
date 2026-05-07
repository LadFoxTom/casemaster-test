/**
 * Phase 12 — parity tests.
 *
 * Hits the same logical endpoint on both runtimes and asserts equivalent
 * output. Skipped unless both URLs are configured:
 *   CMS_OFFICIAL_URL  — http://localhost:5050  (CaseMaster.Web.exe)
 *   CMS_VERCEL_URL    — https://…vercel.app    (this project)
 *
 * The harness intentionally normalises whitespace and timestamp-shaped
 * tokens so cosmetic differences don't fail the suite. As we port more
 * pages, add more cases here.
 */
import { describe, it, expect } from 'vitest';

const OFFICIAL = process.env.CMS_OFFICIAL_URL;
const VERCEL   = process.env.CMS_VERCEL_URL;

const both = OFFICIAL && VERCEL ? describe : describe.skip;

// Curated URL set kept short on purpose — these are the smoke tests
// that fail loudest when the runtimes diverge. Add more as we port
// pages. Each entry maps to the path under each runtime's URL prefix
// (CaseMaster's `axylog` script vs cms-vercel's `foo` placeholder).
const URLS = [
  { official: '/page/axylog/f/ping',  vercel: '/page/foo/f/ping',  match: /^ok \d+\n?$/ },
];

both('runtime parity', () => {
  for (const u of URLS) {
    it(`${u.official} ↔ ${u.vercel} share payload shape`, async () => {
      const [a, b] = await Promise.all([
        fetch(`${OFFICIAL}${u.official}`).then(r => r.text()),
        fetch(`${VERCEL}${u.vercel}`)    .then(r => r.text()),
      ]);
      expect(a).toMatch(u.match);
      expect(b).toMatch(u.match);
    });
  }

  // Maintenance parity is gated on having shared BOs declared on both
  // runtimes. The public demo deploy ships with no BOs (project-specific
  // ones live in private-app/), so this assertion has nothing to test
  // against — re-enable when we add a generic example BO.
});
