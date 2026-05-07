// Phase 11 — latency benchmark.
// Hits a URL N times sequentially and reports min/median/p95/max.
// Use it to compare: (1) cold-start (kill the function, hit once), (2)
// warm-start (the next 50 hits), (3) the same on the official CaseMaster
// runtime (port 5050) for relative numbers.
//
// Usage:
//   node tools/bench.mjs https://your.app/page/foo/f/ping 50
//   node tools/bench.mjs http://localhost:5050/page/axylog/f/ping 50

const url = process.argv[2];
const n = parseInt(process.argv[3] ?? '20', 10);
if (!url) { console.error('usage: node tools/bench.mjs <url> [n]'); process.exit(1); }

const samples = [];
for (let i = 0; i < n; i++) {
  const t = performance.now();
  try {
    const r = await fetch(url);
    await r.text();
    const ms = performance.now() - t;
    samples.push(ms);
    process.stdout.write(`#${String(i + 1).padStart(3)} ${r.status}  ${ms.toFixed(1)}ms\n`);
  } catch (e) {
    process.stdout.write(`#${String(i + 1).padStart(3)} ERROR ${e.message}\n`);
  }
}

samples.sort((a, b) => a - b);
const pct = (p) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))];
console.log('\n--- summary ---');
console.log(`samples: ${samples.length}`);
console.log(`min:     ${samples[0]?.toFixed(1)}ms`);
console.log(`p50:     ${pct(0.5)?.toFixed(1)}ms`);
console.log(`p95:     ${pct(0.95)?.toFixed(1)}ms`);
console.log(`max:     ${samples[samples.length - 1]?.toFixed(1)}ms`);
