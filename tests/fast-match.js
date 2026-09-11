const fs = require('fs');
const path = require('path');
const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const ENGINE_PATH = path.join(__dirname, '..', 'js', 'engine.js');
const SEED = 42;
const NOISE = 0.15;
const ROUNDS = 50;

async function main() {
  const targetName = process.argv[2];
  if (!targetName) {
    console.error('Usage: node fast-match.js <personality-name>');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  const engine = await import(ENGINE_PATH);
  const targetVec = data.personalities[targetName];
  let hits = 0;
  for (let j = 0; j < ROUNDS; j++) {
    const state = engine.initState();
    const rng = engine.makeRng(SEED + 200000 + j);
    const optRng = engine.makeRng(SEED + 200000 + j + 100000);
    for (let loop = 0; loop < 100; loop++) {
      if (state.answeredIds.length >= 24) break;
      const q = engine.selectNext(data.questions, data.dims, data.personalities, state, rng);
      if (!q) break;
      const targetScore = targetVec[q.dim] || 0;
      let preferredIdx = 0;
      let minDiff = Infinity;
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
  console.log(`${targetName}: ${(hits/ROUNDS*100).toFixed(1)}% (${hits}/${ROUNDS})`);
}
main().catch(e => { console.error(e); process.exit(1); });
