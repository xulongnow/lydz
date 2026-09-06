/**
 * 置信度阈值调优脚本 — 测试 0.18~0.22 区间（高样本量，减少随机波动）
 * 指标：提前终止率、自匹配率、零噪声覆盖率
 */
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const ENGINE_PATH = path.join(__dirname, '..', 'js', 'engine.js');

async function loadEngine(threshold) {
  const raw = fs.readFileSync(ENGINE_PATH, 'utf-8');
  const patched = raw.replace(
    /CONFIDENCE_THRESHOLD:\s*[0-9.]+/,
    `CONFIDENCE_THRESHOLD: ${threshold}`
  );
  const tmpPath = path.join(__dirname, `.engine-tmp-${threshold}.js`);
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
  return {
    target: targetName,
    winner: result.winner,
    steps: state.answeredIds.length,
    confidence: result.confidence,
  };
}

function simulatePerfect(data, engine, targetName) {
  const targetVec = data.personalities[targetName];
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

    engine.applyAnswer(state, q, preferredIdx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);

    const result = engine.determineResult(state.userVector, data.personalities, data.dims);
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate && state.answeredIds.length >= 12) break;
  }

  const result = engine.determineResult(state.userVector, data.personalities, data.dims);
  return result.winner;
}

async function evaluateThreshold(data, threshold, runsPerType) {
  const engine = await loadEngine(threshold);
  const names = Object.keys(data.personalities);
  const allRuns = [];
  let selfHits = 0;

  for (const name of names) {
    for (let i = 0; i < runsPerType; i++) {
      const run = simulateResponder(data, engine, name, 0.15);
      allRuns.push(run);
      if (run.winner === name) selfHits++;
    }
  }

  const selfHitRate = (selfHits / allRuns.length) * 100;
  const avgSteps = allRuns.reduce((a, r) => a + r.steps, 0) / allRuns.length;
  const earlyTerm = allRuns.filter(r => r.steps < 24).length;
  const earlyTermRate = (earlyTerm / allRuns.length) * 100;

  const perfectHits = new Set();
  for (const name of names) {
    const winner = simulatePerfect(data, engine, name);
    perfectHits.add(winner);
  }
  const perfectCoverage = names.filter(n => perfectHits.has(n)).length;

  return {
    threshold,
    totalRuns: allRuns.length,
    selfHitRate: parseFloat(selfHitRate.toFixed(2)),
    avgSteps: parseFloat(avgSteps.toFixed(2)),
    earlyTermRate: parseFloat(earlyTermRate.toFixed(2)),
    perfectCoverage,
  };
}

async function main() {
  const data = loadData();
  const thresholds = [0.18, 0.19, 0.20, 0.21, 0.22];
  const baselineThreshold = 0.28;
  const runsPerType = 20; // 高样本量：48 * 20 = 960 runs

  console.log(`===== 置信度阈值调优仿真 (${runsPerType} runs/类型) =====\n`);

  console.log(`--- 基线阈值 ${baselineThreshold} ---`);
  const baseline = await evaluateThreshold(data, baselineThreshold, runsPerType);
  console.log(`  自匹配率: ${baseline.selfHitRate}%`);
  console.log(`  平均答题数: ${baseline.avgSteps}`);
  console.log(`  提前终止率: ${baseline.earlyTermRate}%`);
  console.log(`  零噪声覆盖: ${baseline.perfectCoverage}/48\n`);

  const results = [];
  for (const t of thresholds) {
    console.log(`--- 测试阈值 ${t} ---`);
    const r = await evaluateThreshold(data, t, runsPerType);
    results.push(r);
    console.log(`  自匹配率: ${r.selfHitRate}%`);
    console.log(`  平均答题数: ${r.avgSteps}`);
    console.log(`  提前终止率: ${r.earlyTermRate}%`);
    console.log(`  零噪声覆盖: ${r.perfectCoverage}/48`);

    const selfOk = r.selfHitRate >= baseline.selfHitRate;
    const perfectOk = r.perfectCoverage === 48;
    const earlyBetter = r.earlyTermRate > baseline.earlyTermRate;
    console.log(`  自匹配率不劣化: ${selfOk ? '✅' : '❌'} (基线 ${baseline.selfHitRate}%)`);
    console.log(`  零噪声全覆盖: ${perfectOk ? '✅' : '❌'}`);
    console.log(`  提前终止率改善: ${earlyBetter ? '✅' : '❌'} (基线 ${baseline.earlyTermRate}%)`);
    console.log('');
  }

  const valid = results.filter(r =>
    r.selfHitRate >= baseline.selfHitRate &&
    r.perfectCoverage === 48
  );

  console.log('===== 候选筛选 =====');
  if (valid.length === 0) {
    console.log('⚠️ 无候选满足全部约束（自匹配率不劣化 + 零噪声48/48）');
    console.log('  放宽约束：在零噪声48/48前提下，选自匹配率最高者');
    const okPerfect = results.filter(r => r.perfectCoverage === 48);
    okPerfect.sort((a, b) => b.selfHitRate - a.selfHitRate);
    const best = okPerfect[0];
    console.log(`  推荐阈值: ${best.threshold}（自匹配率 ${best.selfHitRate}%，提前终止率 ${best.earlyTermRate}%）`);
  } else {
    valid.sort((a, b) => b.earlyTermRate - a.earlyTermRate);
    const best = valid[0];
    console.log(`最优阈值: ${best.threshold}`);
    console.log(`  自匹配率: ${best.selfHitRate}% (基线 ${baseline.selfHitRate}%)`);
    console.log(`  平均答题数: ${best.avgSteps} (基线 ${baseline.avgSteps})`);
    console.log(`  提前终止率: ${best.earlyTermRate}% (基线 ${baseline.earlyTermRate}%)`);
    console.log(`  零噪声覆盖: ${best.perfectCoverage}/48`);
  }

  console.log('\n===== 对比表 =====');
  console.log('阈值  | 自匹配率 | 平均题数 | 提前终止率 | 零噪声覆盖');
  console.log('------|----------|----------|------------|----------');
  console.log(`${baseline.threshold.toFixed(2)}  | ${baseline.selfHitRate.toFixed(1)}%    | ${baseline.avgSteps.toFixed(1)}     | ${baseline.earlyTermRate.toFixed(1)}%      | ${baseline.perfectCoverage}/48`);
  for (const r of results) {
    console.log(`${r.threshold.toFixed(2)}  | ${r.selfHitRate.toFixed(1)}%    | ${r.avgSteps.toFixed(1)}     | ${r.earlyTermRate.toFixed(1)}%      | ${r.perfectCoverage}/48`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
