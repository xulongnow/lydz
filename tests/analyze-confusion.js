const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const ENGINE_PATH = path.join(__dirname, '..', 'js', 'engine.js');

const SEED = 42;
const NOISE = 0.15;
const ROUNDS_PER_PERSONALITY = 50;

async function loadEngine() {
  return await import(ENGINE_PATH);
}

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
}

function simulateResponder(data, engine, targetName, noise, seedOffset) {
  const targetVec = data.personalities[targetName];
  const state = engine.initState();
  const rng = engine.makeRng(SEED + seedOffset);
  const optRng = engine.makeRng(SEED + seedOffset + 100000);

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
    if (optRng() < noise) {
      preferredIdx = Math.floor(optRng() * 4);
    }

    engine.applyAnswer(state, q, preferredIdx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);

    const result = engine.determineResult(state.userVector, data.personalities, data.dims);
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate && state.answeredIds.length >= 12) break;
  }

  const result = engine.determineResult(state.userVector, data.personalities, data.dims);
  return {
    target: targetName,
    winner: result.winner,
    steps: state.answeredIds.length,
  };
}

async function main() {
  const data = loadData();
  const engine = await loadEngine();
  const personalityNames = Object.keys(data.personalities);

  const confusion = {};
  for (const n of personalityNames) confusion[n] = {};

  for (let i = 0; i < personalityNames.length; i++) {
    const name = personalityNames[i];
    for (let j = 0; j < ROUNDS_PER_PERSONALITY; j++) {
      const seedOffset = i * 10000 + j;
      const run = simulateResponder(data, engine, name, NOISE, seedOffset);
      confusion[name][run.winner] = (confusion[name][run.winner] || 0) + 1;
    }
  }

  const rates = [];
  for (const n of personalityNames) {
    const self = confusion[n][n] || 0;
    const mis = Object.entries(confusion[n]).filter(([k,v]) => k !== n).sort((a,b) => b[1]-a[1]);
    rates.push({name: n, self, rate: self/ROUNDS_PER_PERSONALITY, mis});
  }
  rates.sort((a,b) => a.rate - b.rate);

  console.log('=== Bottom 15 personalities by self-match rate ===');
  for (const r of rates.slice(0, 15)) {
    const topMis = r.mis.slice(0, 3).map(([k,v]) => k + ':' + v).join(', ');
    console.log(r.name + ': ' + (r.rate*100).toFixed(1) + '% -> ' + topMis);
  }

  console.log('\n=== All personalities sorted ===');
  for (const r of rates) {
    const topMis = r.mis.slice(0, 2).map(([k,v]) => k + ':' + v).join(', ');
    console.log(r.name + ': ' + (r.rate*100).toFixed(1) + '% -> ' + topMis);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
