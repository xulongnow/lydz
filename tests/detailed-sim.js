/**
 * 详细仿真 — 输出每个 personality 的自匹配率
 */
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const ENGINE_PATH = path.join(__dirname, '..', 'js', 'engine.js');

async function loadEngine() {
  return await import(ENGINE_PATH);
}

function loadData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

function simulateResponder(data, engine, targetName, noise = 0.15, runs = 20) {
  const targetVec = data.personalities[targetName];
  const results = [];

  for (let r = 0; r < runs; r++) {
    const state = engine.initState();
    for (let loop = 0; loop < 100; loop++) {
      if (state.answeredIds.length >= 24) break;
      const q = engine.selectNext(data.questions, data.dims, data.personalities, state, Math.random);
      if (!q) break;
      const targetScore = targetVec[q.dim] || 0;
      let preferredIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < q.opts.length; i++) {
        const diff = Math.abs(q.opts[i].score - targetScore);
        if (diff < minDiff) {
          minDiff = diff;
          preferredIdx = i;
        }
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
    results.push(result.winner);
  }
  return results;
}

async function main() {
  const data = loadData();
  const engine = await loadEngine();
  const names = Object.keys(data.personalities);

  console.log('===== 每类人格详细自匹配率 (noise=0.15, 20 runs) =====');
  let totalHits = 0;
  let totalRuns = 0;

  for (const name of names) {
    const winners = simulateResponder(data, engine, name, 0.15, 20);
    const selfHits = winners.filter(w => w === name).length;
    const rate = (selfHits / winners.length) * 100;
    totalHits += selfHits;
    totalRuns += winners.length;

    // Find most common misclassification
    const miscount = {};
    for (const w of winners) {
      if (w !== name) miscount[w] = (miscount[w] || 0) + 1;
    }
    const topMisc = Object.entries(miscount).sort((a, b) => b[1] - a[1])[0];
    const miscStr = topMisc ? `常错判为 ${topMisc[0]}(${topMisc[1]}次)` : '';

    const flag = rate < 50 ? '❌' : rate < 80 ? '⚠️' : '✅';
    console.log(`${flag} ${name}: ${selfHits}/${winners.length} = ${rate.toFixed(1)}% ${miscStr}`);
  }

  console.log(`\n总体自匹配率: ${(totalHits / totalRuns * 100).toFixed(1)}%`);
}

main().catch(e => { console.error(e); process.exit(1); });
