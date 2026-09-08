/**
 * 随机答题路径模拟 — 验证倾向驱动+随机选题的健壮性
 * 运行: node tests/simulate-random-paths.js
 *
 * 包含两组测试：
 *  A. 100条纯随机路径 — 验证无死循环、题数区间合理、无崩溃
 *  B. 48条低噪声定向路径 — 验证48人格全部可达（同 validate-engine.js 逻辑）
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

// 带种子的简单 RNG
function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function simulateRandomPath(data, engine, rng) {
  const state = engine.initState();
  const dimSequence = [];

  for (let loop = 0; loop < 100; loop++) {
    if (state.answeredIds.length >= 24) break;

    const q = engine.selectNext(data.questions, data.dims, data.personalities, state, rng);
    if (!q) break;

    const idx = Math.floor(rng() * q.opts.length);
    engine.applyAnswer(state, q, idx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
    dimSequence.push(q.dim);

    const result = engine.determineResult(state.userVector, data.personalities, data.dims);
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate && state.answeredIds.length >= 12) break;
  }

  const result = engine.determineResult(state.userVector, data.personalities, data.dims);
  const term = engine.shouldTerminate(state, result, data.dims);
  return {
    winner: result.winner,
    confidence: result.confidence,
    steps: state.answeredIds.length,
    dimCounts: Object.fromEntries(data.dims.map(d => [d, (state.dimHistory[d] || []).length])),
    dimSequence,
    terminatedBy: term.terminate ? term.reason : 'unknown',
  };
}

function simulateTargetedPath(data, engine, targetName, noise, rng) {
  const targetVec = data.personalities[targetName];
  const state = engine.initState();
  const dimSequence = [];

  for (let loop = 0; loop < 100; loop++) {
    if (state.answeredIds.length >= 24) break;

    const q = engine.selectNext(data.questions, data.dims, data.personalities, state, rng);
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
    if (rng() < noise) {
      preferredIdx = Math.floor(rng() * 4);
    }

    engine.applyAnswer(state, q, preferredIdx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
    dimSequence.push(q.dim);

    const result = engine.determineResult(state.userVector, data.personalities, data.dims);
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate && state.answeredIds.length >= 12) break;
  }

  const result = engine.determineResult(state.userVector, data.personalities, data.dims);
  return {
    target: targetName,
    winner: result.winner,
    confidence: result.confidence,
    steps: state.answeredIds.length,
    dimSequence,
    dimCounts: Object.fromEntries(data.dims.map(d => [d, (state.dimHistory[d] || []).length])),
  };
}

async function main() {
  const data = loadData();
  const engine = await loadEngine();
  const personalityNames = Object.keys(data.personalities);

  // ========== 测试 A：纯随机路径（健壮性） ==========
  const RANDOM_RUNS = 100;
  console.log(`===== A. 纯随机路径模拟 (${RANDOM_RUNS} 条) =====\n`);

  const randomRuns = [];
  const randomDistribution = {};
  const stepsList = [];
  const terminatedReasons = {};

  for (let i = 0; i < RANDOM_RUNS; i++) {
    const rng = makeRng(12345 + i);
    const run = simulateRandomPath(data, engine, rng);
    randomRuns.push(run);
    randomDistribution[run.winner] = (randomDistribution[run.winner] || 0) + 1;
    stepsList.push(run.steps);
    terminatedReasons[run.terminatedBy] = (terminatedReasons[run.terminatedBy] || 0) + 1;
  }

  const minSteps = Math.min(...stepsList);
  const maxSteps = Math.max(...stepsList);
  const avgSteps = stepsList.reduce((a, b) => a + b, 0) / stepsList.length;

  console.log('--- 题数分布 ---');
  console.log(`  最少: ${minSteps}, 最多: ${maxSteps}, 平均: ${avgSteps.toFixed(1)}`);
  const ranges = {
    '12': stepsList.filter(s => s === 12).length,
    '13-15': stepsList.filter(s => s >= 13 && s <= 15).length,
    '16-18': stepsList.filter(s => s >= 16 && s <= 18).length,
    '19-21': stepsList.filter(s => s >= 19 && s <= 21).length,
    '22-24': stepsList.filter(s => s >= 22 && s <= 24).length,
  };
  for (const [range, count] of Object.entries(ranges)) {
    console.log(`  ${range} 题: ${count} 条 (${(count / RANDOM_RUNS * 100).toFixed(1)}%)`);
  }

  console.log('\n--- 终止原因 ---');
  for (const [reason, count] of Object.entries(terminatedReasons)) {
    console.log(`  ${reason}: ${count} 条 (${(count / RANDOM_RUNS * 100).toFixed(1)}%)`);
  }

  const crashed = randomRuns.filter(r => r.steps >= 99 || r.steps < 12);
  console.log('\n--- 健壮性 ---');
  console.log(`  死循环/异常题数: ${crashed.length} 条`);

  const distValues = Object.values(randomDistribution);
  const top5Hits = Object.entries(randomDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .reduce((sum, [, c]) => sum + c, 0);
  const top5Pct = (top5Hits / RANDOM_RUNS) * 100;
  console.log(`  Top5 人格占比: ${top5Pct.toFixed(1)}%`);
  console.log(`  覆盖人格数: ${distValues.length}/${personalityNames.length}`);

  // 示例走查（前5步）
  console.log('\n--- 示例路径走查（第1条随机路径） ---');
  const ex = randomRuns[0];
  console.log(`  结果: ${ex.winner} (置信度 ${ex.confidence.toFixed(3)})`);
  console.log(`  总题数: ${ex.steps}, 终止原因: ${ex.terminatedBy}`);
  console.log(`  前5步维度: ${ex.dimSequence.slice(0, 5).join(' → ')}`);
  console.log(`  维度计数: ${JSON.stringify(ex.dimCounts)}`);

  // ========== 测试 B：低噪声定向路径（覆盖率） ==========
  console.log(`\n===== B. 低噪声定向路径 (${personalityNames.length} 人格 × 5 次) =====\n`);

  const targetHitCount = {};
  const targetedDistribution = {};
  const targetedSteps = [];

  for (const name of personalityNames) {
    targetHitCount[name] = 0;
    for (let i = 0; i < 5; i++) {
      const rng = makeRng(99999 + personalityNames.indexOf(name) * 10 + i);
      const run = simulateTargetedPath(data, engine, name, 0.15, rng);
      targetedDistribution[run.winner] = (targetedDistribution[run.winner] || 0) + 1;
      targetedSteps.push(run.steps);
      if (run.winner === name) targetHitCount[name]++;
    }
  }

  const correctHits = Object.values(targetHitCount).filter(c => c > 0).length;
  const selfHitTotal = Object.values(targetHitCount).reduce((a, b) => a + b, 0);
  const selfHitRate = (selfHitTotal / (personalityNames.length * 5)) * 100;
  const targetedAvgSteps = targetedSteps.reduce((a, b) => a + b, 0) / targetedSteps.length;

  console.log(`  48类人格中至少被正确测出1次: ${correctHits}/48`);
  console.log(`  自匹配率: ${selfHitRate.toFixed(1)}%`);
  console.log(`  平均题数: ${targetedAvgSteps.toFixed(1)}`);

  const tDistValues = Object.values(targetedDistribution);
  const tMaxHits = Math.max(...tDistValues);
  const tMinHits = Math.min(...tDistValues);
  const tAvgHits = tDistValues.reduce((a, b) => a + b, 0) / tDistValues.length;
  console.log(`  分布: 最少=${tMinHits}, 最多=${tMaxHits}, 平均=${tAvgHits.toFixed(1)}`);

  // ========== 判据检查 ==========
  console.log('\n===== 判据检查 =====');
  let passed = true;

  // A1: 题数区间
  if (minSteps < 12 || maxSteps > 24) {
    console.log(`❌ 题数区间异常: ${minSteps}-${maxSteps}`);
    passed = false;
  } else {
    console.log(`✅ 题数区间合理: ${minSteps}-${maxSteps}`);
  }

  // A2: 无死循环
  if (crashed.length > 0) {
    console.log(`❌ 存在异常路径: ${crashed.length} 条`);
    passed = false;
  } else {
    console.log(`✅ 无死循环/崩溃`);
  }

  // A3: 分布不异常集中
  if (top5Pct > 80) {
    console.log(`⚠️ 随机路径分布过度集中: Top5 占 ${top5Pct.toFixed(1)}%（纯随机路径靠近中心，属预期行为）`);
  } else {
    console.log(`✅ 随机路径分布未异常集中: Top5 占 ${top5Pct.toFixed(1)}%`);
  }

  // B1: 48人格可达
  if (correctHits < 48) {
    console.log(`❌ 定向覆盖率不足: ${correctHits}/48`);
    passed = false;
  } else {
    console.log(`✅ 定向路径 48 类人格全部可达`);
  }

  // B2: 自匹配率
  if (selfHitRate < 70) {
    console.log(`❌ 自匹配率过低: ${selfHitRate.toFixed(1)}%`);
    passed = false;
  } else {
    console.log(`✅ 自匹配率: ${selfHitRate.toFixed(1)}%`);
  }

  // B3: 定向分布不异常集中
  const tTop5 = Object.entries(targetedDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .reduce((sum, [, c]) => sum + c, 0);
  const tTop5Pct = (tTop5 / (personalityNames.length * 5)) * 100;
  if (tTop5Pct > 50) {
    console.log(`⚠️ 定向分布偏斜: Top5 占 ${tTop5Pct.toFixed(1)}%`);
  } else {
    console.log(`✅ 定向分布均衡: Top5 占 ${tTop5Pct.toFixed(1)}%`);
  }

  console.log(`\n${passed ? '✅ 全部通过' : '❌ 存在未通过项'}`);

  // 保存摘要
  const summary = {
    random: {
      runCount: RANDOM_RUNS,
      steps: { min: minSteps, max: maxSteps, avg: parseFloat(avgSteps.toFixed(1)), ranges },
      termination: terminatedReasons,
      crashed: crashed.length,
      top5Pct: parseFloat(top5Pct.toFixed(1)),
      personalityCoverage: distValues.length,
    },
    targeted: {
      runCount: personalityNames.length * 5,
      coverage: correctHits,
      selfHitRate: parseFloat(selfHitRate.toFixed(1)),
      avgSteps: parseFloat(targetedAvgSteps.toFixed(1)),
      distribution: { min: tMinHits, max: tMaxHits, avg: parseFloat(tAvgHits.toFixed(1)) },
      top5Pct: parseFloat(tTop5Pct.toFixed(1)),
    },
    passed,
  };
  const summaryPath = path.join(__dirname, 'random-paths-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n摘要已保存: ${summaryPath}`);

  process.exit(passed ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
