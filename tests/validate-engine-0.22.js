/**
 * 判型引擎仿真验证 — 48 类人格全覆盖测试（阈值 0.22 版）
 */
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const ENGINE_PATH = path.join(__dirname, '..', 'js', 'engine.js');

async function loadEngine() {
  const raw = fs.readFileSync(ENGINE_PATH, 'utf-8');
  const patched = raw.replace(/CONFIDENCE_THRESHOLD:\s*[0-9.]+/, 'CONFIDENCE_THRESHOLD: 0.22');
  const tmpPath = path.join(__dirname, '.engine-tmp-022.js');
  fs.writeFileSync(tmpPath, patched, 'utf-8');
  const engine = await import(tmpPath);
  fs.unlinkSync(tmpPath);
  return engine;
}

function loadData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

function simulateResponder(data, engine, targetName, noise = 0.15) {
  const targetVec = data.personalities[targetName];
  const state = engine.initState();
  const selectedQuestions = [];

  for (let loop = 0; loop < 100; loop++) {
    if (state.answeredIds.length >= 24) break;
    const q = engine.selectNext(data.questions, data.dims, data.personalities, state, Math.random);
    if (!q) break;
    const targetScore = targetVec[q.dim] || 0;
    let preferredIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < q.opts.length; i++) {
      const diff = Math.abs(q.opts[i].score - targetScore);
      if (diff < minDiff) { minDiff = diff; preferredIdx = i; }
    }
    if (Math.random() < noise) preferredIdx = Math.floor(Math.random() * 4);
    engine.applyAnswer(state, q, preferredIdx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
    selectedQuestions.push(q);
    const result = engine.determineResult(state.userVector, data.personalities, data.dims);
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate && state.answeredIds.length >= 12) break;
  }
  const result = engine.determineResult(state.userVector, data.personalities, data.dims);
  return { target: targetName, winner: result.winner, steps: state.answeredIds.length, confidence: result.confidence };
}

async function main() {
  const data = loadData();
  const engine = await loadEngine();
  const names = Object.keys(data.personalities);
  const allRuns = [];
  let selfHits = 0;

  for (const name of names) {
    for (let i = 0; i < 5; i++) {
      const run = simulateResponder(data, engine, name, 0.15);
      allRuns.push(run);
      if (run.winner === name) selfHits++;
    }
  }

  const selfHitRate = (selfHits / allRuns.length) * 100;
  const avgSteps = allRuns.reduce((a, r) => a + r.steps, 0) / allRuns.length;
  const earlyTerm = allRuns.filter(r => r.steps < 24).length;
  const earlyTermRate = (earlyTerm / allRuns.length) * 100;

  // 零噪声
  const perfectHits = new Set();
  for (const name of names) {
    const state = engine.initState();
    const targetVec = data.personalities[name];
    for (let loop = 0; loop < 100; loop++) {
      if (state.answeredIds.length >= 24) break;
      const q = engine.selectNext(data.questions, data.dims, data.personalities, state, Math.random);
      if (!q) break;
      let preferredIdx = 0, minDiff = Infinity;
      for (let i = 0; i < q.opts.length; i++) {
        const diff = Math.abs(q.opts[i].score - targetVec[q.dim] || 0);
        if (diff < minDiff) { minDiff = diff; preferredIdx = i; }
      }
      engine.applyAnswer(state, q, preferredIdx);
      state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
      const result = engine.determineResult(state.userVector, data.personalities, data.dims);
      const term = engine.shouldTerminate(state, result, data.dims);
      if (term.terminate && state.answeredIds.length >= 12) break;
    }
    const result = engine.determineResult(state.userVector, data.personalities, data.dims);
    perfectHits.add(result.winner);
  }

  console.log('===== 阈值 0.22 验证 =====');
  console.log(`自匹配率: ${selfHitRate.toFixed(1)}%`);
  console.log(`平均答题数: ${avgSteps.toFixed(1)}`);
  console.log(`提前终止率: ${earlyTermRate.toFixed(1)}%`);
  console.log(`零噪声覆盖: ${names.filter(n => perfectHits.has(n)).length}/48`);
}

main().catch(e => { console.error(e); process.exit(1); });
