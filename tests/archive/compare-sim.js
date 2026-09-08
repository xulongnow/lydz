const fs = require('fs');
const path = require('path');
const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const ENGINE_PATH = path.join(__dirname, '..', 'js', 'engine.js');

async function loadEngine() { return await import(ENGINE_PATH); }
function loadData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

function sim(data, engine, targetName, noise) {
  const targetVec = data.personalities[targetName];
  const state = engine.initState();
  for (let loop = 0; loop < 100; loop++) {
    if (state.answeredIds.length >= 24) break;
    const q = engine.selectNext(data.questions, data.dims, data.personalities, state, Math.random);
    if (!q) break;
    const targetScore = targetVec[q.dim] || 0;
    let preferredIdx = 0, minDiff = Infinity;
    for (let i = 0; i < q.opts.length; i++) {
      const diff = Math.abs(q.opts[i].score - targetScore);
      if (diff < minDiff) { minDiff = diff; preferredIdx = i; }
    }
    if (Math.random() < noise) {
      preferredIdx = Math.floor(Math.random() * q.opts.length);
    }
    engine.applyAnswer(state, q, preferredIdx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
    const result = engine.determineResult(state.userVector, data.personalities, data.dims);
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate && state.answeredIds.length >= 12) break;
  }
  const result = engine.determineResult(state.userVector, data.personalities, data.dims);
  return result.winner;
}

async function main() {
  const data = loadData();
  const engine = await loadEngine();
  const names = Object.keys(data.personalities);
  const results = {};
  for (const name of names) {
    let hits = 0;
    for (let i = 0; i < 20; i++) {
      if (sim(data, engine, name, 0.15) === name) hits++;
    }
    results[name] = hits;
  }
  console.log(JSON.stringify(results));
}
main().catch(e => { console.error(e); process.exit(1); });
