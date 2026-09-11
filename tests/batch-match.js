const fs = require('fs');
const path = require('path');
const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const ENGINE_PATH = path.join(__dirname, '..', 'js', 'engine.js');
const SEED = 42;
const NOISE = 0.15;
const ROUNDS = 50;

async function testOne(data, engine, targetName, idx) {
  const targetVec = data.personalities[targetName];
  let hits = 0;
  for (let j = 0; j < ROUNDS; j++) {
    const state = engine.initState();
    const rng = engine.makeRng(SEED + idx * 10000 + j);
    const optRng = engine.makeRng(SEED + idx * 10000 + j + 100000);
    for (let loop = 0; loop < 100; loop++) {
      if (state.answeredIds.length >= 24) break;
      const q = engine.selectNext(data.questions, data.dims, data.personalities, state, rng);
      if (!q) break;
      const targetScore = targetVec[q.dim] || 0;
      let preferredIdx = 0, minDiff = Infinity;
      for (let i = 0; i < q.opts.length; i++) {
        let effectiveScore = q.opts[i].score;
        if (q.reverseCheck) effectiveScore = -effectiveScore;
        const diff = Math.abs(effectiveScore - targetScore);
        if (diff < minDiff) { minDiff = diff; preferredIdx = i; }
      }
      if (optRng() < NOISE) preferredIdx = Math.floor(optRng() * 4);
      engine.applyAnswer(state, q, preferredIdx);
      state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
      const result = engine.determineResult(state.userVector, data.personalities, data.dims);
      const term = engine.shouldTerminate(state, result, data.dims);
      if (term.terminate && state.answeredIds.length >= 12) break;
    }
    const result = engine.determineResult(state.userVector, data.personalities, data.dims);
    if (result.winner === targetName) hits++;
  }
  return { name: targetName, rate: hits / ROUNDS };
}

async function main() {
  const targets = process.argv.slice(2);
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const engine = await import(ENGINE_PATH);
  const names = Object.keys(data.personalities);
  const results = [];
  for (const t of targets) {
    const idx = names.indexOf(t);
    if (idx < 0) { console.log(`Unknown: ${t}`); continue; }
    const r = await testOne(data, engine, t, idx);
    results.push(r);
  }
  const total = results.reduce((a, r) => a + r.rate, 0);
  console.log('--- Results ---');
  for (const r of results) {
    console.log(`${r.name}: ${(r.rate * 100).toFixed(1)}%`);
  }
  console.log(`Average: ${(total / results.length * 100).toFixed(1)}%`);
}
main().catch(e => { console.error(e); process.exit(1); });
