/**
 * 自匹配率 spec 口径测量：seed=42, 每人格 50 轮, 噪声 15%
 * 运行: node tests/measure-self-match.js
 */

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
    dimSequence: state.answeredIds.map(id => data.questions.find(q => q.id === id)?.dim),
    userVector: state.userVector,
  };
}

async function main() {
  const data = loadData();
  const engine = await loadEngine();
  const personalityNames = Object.keys(data.personalities);

  console.log('===== 自匹配率 spec 口径测量 =====');
  console.log(`题目数: ${data.questions.length}`);
  console.log(`人格数: ${personalityNames.length}`);
  console.log(`RNG 种子: ${SEED}`);
  console.log(`噪声: ${NOISE * 100}%`);
  console.log(`每人格轮数: ${ROUNDS_PER_PERSONALITY}`);
  console.log('');

  const targetHitCount = {};
  const allRuns = [];
  const first6Coverage = [];

  for (let i = 0; i < personalityNames.length; i++) {
    const name = personalityNames[i];
    targetHitCount[name] = 0;
    for (let j = 0; j < ROUNDS_PER_PERSONALITY; j++) {
      const seedOffset = i * 10000 + j;
      const run = simulateResponder(data, engine, name, NOISE, seedOffset);
      allRuns.push(run);
      if (run.winner === name) targetHitCount[name]++;

      const first6Dims = run.dimSequence.slice(0, 6);
      const coveredDims = new Set(first6Dims);
      first6Coverage.push(coveredDims.size === data.dims.length);
    }
  }

  // Per-personality rates
  const rates = [];
  console.log('--- 逐人格自匹配率 ---');
  for (const name of personalityNames) {
    const rate = (targetHitCount[name] / ROUNDS_PER_PERSONALITY) * 100;
    rates.push({ name, rate, hits: targetHitCount[name] });
  }
  rates.sort((a, b) => a.rate - b.rate);
  for (const r of rates) {
    const marker = r.rate < 75 ? ' ⚠️' : (r.rate < 80 ? ' ~' : '');
    console.log(`  ${r.name}: ${r.rate.toFixed(1)}% (${r.hits}/${ROUNDS_PER_PERSONALITY})${marker}`);
  }

  // Overall
  const selfHitTotal = Object.values(targetHitCount).reduce((a, b) => a + b, 0);
  const selfHitRate = (selfHitTotal / allRuns.length) * 100;
  const first6Rate = first6Coverage.filter(Boolean).length / first6Coverage.length;

  // Steps
  const steps = allRuns.map(r => r.steps);
  const avgSteps = steps.reduce((a, b) => a + b, 0) / steps.length;
  const minSteps = Math.min(...steps);
  const maxSteps = Math.max(...steps);

  console.log('');
  console.log('===== 汇总 =====');
  console.log(`整体自匹配率: ${selfHitRate.toFixed(2)}% (${selfHitTotal}/${allRuns.length})`);
  console.log(`最低人格: ${rates[0].name} @ ${rates[0].rate.toFixed(1)}%`);
  console.log(`前6题覆盖率: ${(first6Rate * 100).toFixed(1)}%`);
  console.log(`题数范围: [${minSteps}, ${maxSteps}], 平均 ${avgSteps.toFixed(1)}`);
  console.log(`<75% 人格数: ${rates.filter(r => r.rate < 75).length}`);
  console.log(`<80% 人格数: ${rates.filter(r => r.rate < 80).length}`);

  // Check against spec
  console.log('');
  console.log('===== spec 验收 =====');
  const checks = [
    { name: '整体自匹配率 ≥93%', pass: selfHitRate >= 93 },
    { name: '个体下限 ≥75%', pass: rates[0].rate >= 75 },
    { name: '前6题覆盖率 100%', pass: first6Rate >= 1.0 },
    { name: '题数 [12,24]', pass: minSteps >= 12 && maxSteps <= 24 },
  ];
  for (const c of checks) {
    console.log(`${c.pass ? '✅' : '❌'} ${c.name}`);
  }

  process.exit(checks.every(c => c.pass) ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
