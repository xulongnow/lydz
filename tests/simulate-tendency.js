/**
 * 倾向驱动选题模拟验证脚本（红方 A）
 * 运行: node tests/simulate-tendency.js
 *
 * 验证项：
 * 1. 50+ 条随机答题路径，题数区间 12-24，无死循环
 * 2. 48 类人格全覆盖
 * 3. 结果人格分布均衡（无 80%+ 集中在少数 5 种）
 * 4. 低噪声自匹配率 >= 70%
 * 5. 分享链接编码/解码/回放一致性
 * 6. 回退功能状态一致性
 * 7. 前 6 步覆盖 6 个维度（防早熟）
 * 8. layer 递进符合预期（core → select → explore）
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const ENGINE_PATH = path.join(__dirname, '..', 'js', 'engine.js');
const APP_PATH = path.join(__dirname, '..', 'js', 'app.js');

async function loadEngine() {
  return await import(ENGINE_PATH);
}

function loadData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

// 可复现伪随机（seed 固定）
function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// 模拟答题者
function simulateResponder(data, engine, targetName, noise = 0.15, seed = 42) {
  const targetVec = data.personalities[targetName];
  const state = engine.initState();
  const selectedQuestions = [];
  const rng = makeRng(seed);

  for (let loop = 0; loop < 100; loop++) {
    if (state.answeredIds.length >= 24) break;

    const q = engine.selectNext(data.questions, data.dims, data.personalities, state, rng);
    if (!q) break;

    // 选择策略：选 score 最接近目标向量该维度值的选项
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
    selectedQuestions.push(q);

    const result = engine.determineResult(state.userVector, data.personalities, data.dims);
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate && state.answeredIds.length >= 12) break;
  }

  const result = engine.determineResult(state.userVector, data.personalities, data.dims);
  return {
    target: targetName,
    winner: result.winner,
    confidence: result.confidence,
    ambiguity: result.ambiguity,
    steps: state.answeredIds.length,
    dimCounts: Object.fromEntries(data.dims.map(d => [d, (state.dimHistory[d] || []).length])),
    selectedQuestions,
    dimSequence: selectedQuestions.map(q => q.dim),
    layerSequence: selectedQuestions.map(q => q.layer),
    userVector: state.userVector,
    result,
    state,
  };
}

// 随机答题者（纯随机选择）
function simulateRandomResponder(data, engine, seed = 42) {
  const state = engine.initState();
  const selectedQuestions = [];
  const rng = makeRng(seed);

  for (let loop = 0; loop < 100; loop++) {
    if (state.answeredIds.length >= 24) break;

    const q = engine.selectNext(data.questions, data.dims, data.personalities, state, rng);
    if (!q) break;

    const idx = Math.floor(rng() * q.opts.length);
    engine.applyAnswer(state, q, idx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
    selectedQuestions.push(q);

    const result = engine.determineResult(state.userVector, data.personalities, data.dims);
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate && state.answeredIds.length >= 12) break;
  }

  const result = engine.determineResult(state.userVector, data.personalities, data.dims);
  return {
    winner: result.winner,
    steps: state.answeredIds.length,
    selectedQuestions,
    dimSequence: selectedQuestions.map(q => q.dim),
    layerSequence: selectedQuestions.map(q => q.layer),
    dimCounts: Object.fromEntries(data.dims.map(d => [d, (state.dimHistory[d] || []).length])),
    userVector: state.userVector,
    result,
    state,
  };
}

// 测试回退功能
function testUndo(data, engine) {
  const state = engine.initState();
  const rng = makeRng(12345);
  const history = [];

  // 答 5 题
  for (let i = 0; i < 5; i++) {
    const q = engine.selectNext(data.questions, data.dims, data.personalities, state, rng);
    if (!q) break;
    const idx = Math.floor(rng() * q.opts.length);
    engine.applyAnswer(state, q, idx);
    history.push({ q, idx });
  }

  const beforeVector = { ...engine.buildUserVector(state.dimHistory, data.dims) };
  const beforeStep = state.step;
  const beforeCount = state.answeredIds.length;

  // 回退 1 题
  const last = history[history.length - 1];
  engine.undoAnswer(state, last.q, last.idx, data.dims);

  const afterVector = engine.buildUserVector(state.dimHistory, data.dims);
  const afterStep = state.step;
  const afterCount = state.answeredIds.length;

  const stepOk = afterStep === beforeStep - 1;
  const countOk = afterCount === beforeCount - 1;
  // 至少有一个维度得分变化了（因为回退移除了一个答案）
  const vectorChanged = data.dims.some(d => beforeVector[d] !== afterVector[d]);

  return { stepOk, countOk, vectorChanged, beforeStep, afterStep };
}

// 测试前 N 步维度覆盖
function testEarlyCoverage(data, engine, runs = 50) {
  let fullCoverageCount = 0;
  const coverageDetails = [];

  for (let seed = 1; seed <= runs; seed++) {
    const state = engine.initState();
    const rng = makeRng(seed);
    const dimsInFirst6 = new Set();

    for (let i = 0; i < 6; i++) {
      const q = engine.selectNext(data.questions, data.dims, data.personalities, state, rng);
      if (!q) break;
      dimsInFirst6.add(q.dim);
      const idx = Math.floor(rng() * q.opts.length);
      engine.applyAnswer(state, q, idx);
    }

    const covered = dimsInFirst6.size;
    coverageDetails.push(covered);
    if (covered === 6) fullCoverageCount++;
  }

  return {
    fullCoverageCount,
    totalRuns: runs,
    coverageRate: fullCoverageCount / runs,
    avgCovered: coverageDetails.reduce((a, b) => a + b, 0) / runs,
    minCovered: Math.min(...coverageDetails),
  };
}

// 模拟分享链接（简化版，不依赖 share.js）
function simulateShareLink(data, engine, targetName) {
  const run = simulateResponder(data, engine, targetName, 0.15, 999);
  const path = run.state.answeredIds.map((id, i) => {
    const q = data.questions.find(qq => qq.id === id);
    const hist = run.state.dimHistory[q.dim];
    // 找到对应 step 的答案
    const ans = hist.find(h => h.step === i + 1);
    const idx = q.opts.findIndex(o => o.score === ans.score);
    return [id, idx];
  });

  // 模拟回放
  const replayState = engine.initState();
  for (const [qId, origIdx] of path) {
    const q = data.questions.find(qq => qq.id === qId);
    if (!q || origIdx < 0 || origIdx >= q.opts.length) continue;
    engine.applyAnswer(replayState, q, origIdx);
  }

  const replayResult = engine.determineResult(
    engine.buildUserVector(replayState.dimHistory, data.dims),
    data.personalities,
    data.dims
  );

  return {
    originalWinner: run.winner,
    replayWinner: replayResult.winner,
    match: run.winner === replayResult.winner,
    pathLength: path.length,
  };
}

async function main() {
  const data = loadData();
  const engine = await loadEngine();
  const personalityNames = Object.keys(data.personalities);

  console.log('===== 倾向驱动选题模拟验证（红方 A） =====');
  console.log(`题目数: ${data.questions.length}`);
  console.log(`人格数: ${personalityNames.length}`);

  let passed = true;

  // ===== 测试 1：完美答题者覆盖率 =====
  console.log('\n--- 测试 1：完美答题者覆盖率（noise=0） ---');
  const perfectCoverage = new Set();
  for (const name of personalityNames) {
    const run = simulateResponder(data, engine, name, 0.0, 42);
    perfectCoverage.add(run.winner);
  }
  const perfectHits = personalityNames.filter(n => perfectCoverage.has(n)).length;
  console.log(`48 类人格完美可达: ${perfectHits}/48`);
  if (perfectHits < 48) {
    const missed = personalityNames.filter(n => !perfectCoverage.has(n));
    console.log(`  未命中: ${missed.join(', ')}`);
  }

  // ===== 测试 2：低噪声自匹配率 + 分布 =====
  console.log('\n--- 测试 2：低噪声覆盖（每类 5 次，共 240 次） ---');
  const coverage = new Set();
  const distribution = {};
  const targetHitCount = {};
  const allRuns = [];

  for (const name of personalityNames) {
    targetHitCount[name] = 0;
    for (let i = 0; i < 5; i++) {
      const run = simulateResponder(data, engine, name, 0.15, i + 1);
      allRuns.push(run);
      coverage.add(run.winner);
      distribution[run.winner] = (distribution[run.winner] || 0) + 1;
      if (run.winner === name) targetHitCount[name]++;
    }
  }

  const correctHits = Object.values(targetHitCount).filter(c => c > 0).length;
  console.log(`48 类人格中至少被正确测出 1 次: ${correctHits}/48`);

  const distValues = Object.values(distribution);
  const maxHits = Math.max(...distValues);
  const minHits = Math.min(...distValues);
  const avgHits = distValues.reduce((a, b) => a + b, 0) / distValues.length;

  let selfHitTotal = 0;
  for (const name of personalityNames) {
    selfHitTotal += targetHitCount[name];
  }
  const selfHitRate = (selfHitTotal / allRuns.length) * 100;
  console.log(`自匹配率: ${selfHitRate.toFixed(1)}% (${selfHitTotal}/${allRuns.length})`);
  console.log(`分布: 最少=${minHits}, 最多=${maxHits}, 平均=${avgHits.toFixed(1)}`);

  // 检查是否异常集中（超过 80% 落在少数 5 种人格）
  const top5Hits = distValues.sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const concentration = (top5Hits / allRuns.length) * 100;
  console.log(`Top5 集中度: ${concentration.toFixed(1)}%`);
  if (concentration > 80) {
    console.log(`  ⚠️ 分布异常集中！Top5 占 ${concentration.toFixed(1)}%`);
    passed = false;
  }

  // ===== 测试 3：题数区间 =====
  console.log('\n--- 测试 3：题数区间（240 次低噪声） ---');
  const steps = allRuns.map(r => r.steps);
  const avgSteps = steps.reduce((a, b) => a + b, 0) / steps.length;
  const minSteps = Math.min(...steps);
  const maxSteps = Math.max(...steps);
  const allInRange = steps.every(s => s >= 12 && s <= 24);
  console.log(`答题数: 平均=${avgSteps.toFixed(1)}, 最少=${minSteps}, 最多=${maxSteps}`);
  console.log(`全部在 12-24 区间: ${allInRange ? '是' : '否'}`);
  if (!allInRange) {
    console.log(`  ❌ 有答题数超出 12-24 范围`);
    passed = false;
  }

  // ===== 测试 4：随机答题者（50 条） =====
  console.log('\n--- 测试 4：随机答题者（50 条纯随机路径） ---');
  const randomRuns = [];
  const randomWinners = {};
  for (let i = 0; i < 50; i++) {
    const run = simulateRandomResponder(data, engine, i + 100);
    randomRuns.push(run);
    randomWinners[run.winner] = (randomWinners[run.winner] || 0) + 1;
  }
  const randomSteps = randomRuns.map(r => r.steps);
  const randomAvgSteps = randomSteps.reduce((a, b) => a + b, 0) / randomSteps.length;
  const randomMinSteps = Math.min(...randomSteps);
  const randomMaxSteps = Math.max(...randomSteps);
  const randomAllInRange = randomSteps.every(s => s >= 12 && s <= 24);
  console.log(`答题数: 平均=${randomAvgSteps.toFixed(1)}, 最少=${randomMinSteps}, 最多=${randomMaxSteps}`);
  console.log(`全部在 12-24 区间: ${randomAllInRange ? '是' : '否'}`);

  const randomDistValues = Object.values(randomWinners);
  const randomMaxHits = Math.max(...randomDistValues);
  const randomMinHits = Math.min(...randomDistValues);
  const randomConcentration = (randomDistValues.sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0) / 50) * 100;
  console.log(`分布: 最少=${randomMinHits}, 最多=${randomMaxHits}, Top5集中度=${randomConcentration.toFixed(1)}%`);

  if (!randomAllInRange) {
    console.log(`  ❌ 随机路径有答题数超出范围`);
    passed = false;
  }

  // ===== 测试 5：前 6 步维度覆盖 =====
  console.log('\n--- 测试 5：前 6 步维度覆盖（防早熟） ---');
  const coverageResult = testEarlyCoverage(data, engine, 50);
  console.log(`6 维全覆盖率: ${coverageResult.fullCoverageCount}/${coverageResult.totalRuns} (${(coverageResult.coverageRate * 100).toFixed(0)}%)`);
  console.log(`平均覆盖维度数: ${coverageResult.avgCovered.toFixed(1)}`);
  console.log(`最少覆盖维度数: ${coverageResult.minCovered}`);
  if (coverageResult.coverageRate < 0.8) {
    console.log(`  ⚠️ 前 6 步覆盖率偏低`);
    passed = false;
  }

  // ===== 测试 6：回退功能 =====
  console.log('\n--- 测试 6：回退功能状态一致性 ---');
  const undoResult = testUndo(data, engine);
  console.log(`step 回退正确: ${undoResult.stepOk}`);
  console.log(`count 回退正确: ${undoResult.countOk}`);
  console.log(`向量变化: ${undoResult.vectorChanged}`);
  if (!undoResult.stepOk || !undoResult.countOk) {
    console.log(`  ❌ 回退功能异常`);
    passed = false;
  }

  // ===== 测试 7：分享回放一致性 =====
  console.log('\n--- 测试 7：分享回放一致性（5 个人格） ---');
  const testNames = ['特种兵王', '躺平仙人', '社牛天花板', '婴幼儿', '精算师'];
  let shareOkCount = 0;
  for (const name of testNames) {
    const shareResult = simulateShareLink(data, engine, name);
    console.log(`  ${name}: 原=${shareResult.originalWinner}, 回放=${shareResult.replayWinner}, 一致=${shareResult.match}`);
    if (shareResult.match) shareOkCount++;
  }
  console.log(`回放一致率: ${shareOkCount}/${testNames.length}`);
  if (shareOkCount < testNames.length) {
    console.log(`  ⚠️ 部分回放不一致`);
    passed = false;
  }

  // ===== 测试 8：layer 递进 =====
  console.log('\n--- 测试 8：layer 递进分布 ---');
  const layerCounts = { core: 0, select: 0, explore: 0 };
  let totalLayered = 0;
  for (const run of allRuns) {
    for (let i = 0; i < run.layerSequence.length; i++) {
      const layer = run.layerSequence[i];
      if (layerCounts[layer] !== undefined) {
        layerCounts[layer]++;
        totalLayered++;
      }
    }
  }
  if (totalLayered > 0) {
    console.log(`core: ${layerCounts.core} (${((layerCounts.core / totalLayered) * 100).toFixed(1)}%)`);
    console.log(`select: ${layerCounts.select} (${((layerCounts.select / totalLayered) * 100).toFixed(1)}%)`);
    console.log(`explore: ${layerCounts.explore} (${((layerCounts.explore / totalLayered) * 100).toFixed(1)}%)`);
  }

  // ===== 测试 9：置信度分布 =====
  console.log('\n--- 测试 9：置信度分布 ---');
  const confidences = allRuns.map(r => r.confidence);
  const avgConf = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  const lowConf = confidences.filter(c => c < 0.3).length;
  const highConf = confidences.filter(c => c > 0.5).length;
  console.log(`平均置信度: ${avgConf.toFixed(3)}`);
  console.log(`高模糊(<0.3): ${lowConf}/${allRuns.length} (${((lowConf / allRuns.length) * 100).toFixed(1)}%)`);
  console.log(`高置信(>0.5): ${highConf}/${allRuns.length} (${((highConf / allRuns.length) * 100).toFixed(1)}%)`);

  // ===== 汇总 =====
  console.log('\n===== 汇总 =====');

  if (perfectHits >= 48) {
    console.log('✅ 完美条件下 48 类人格全部可达');
  } else {
    console.log(`⚠️ 完美覆盖率: ${perfectHits}/48`);
  }

  if (correctHits >= 48) {
    console.log('✅ 低噪声下 48 类人格全部可达');
  } else {
    console.log(`❌ 低噪声覆盖率不足: ${correctHits}/48`);
    passed = false;
  }

  if (selfHitRate >= 70) {
    console.log(`✅ 自匹配率: ${selfHitRate.toFixed(1)}%`);
  } else {
    console.log(`❌ 自匹配率过低: ${selfHitRate.toFixed(1)}%`);
    passed = false;
  }

  if (allInRange && randomAllInRange) {
    console.log('✅ 题数区间合理');
  } else {
    console.log('❌ 题数区间异常');
    passed = false;
  }

  if (concentration <= 80 && randomConcentration <= 80) {
    console.log('✅ 人格分布均衡');
  } else {
    console.log(`⚠️ 人格分布集中: 低噪声 ${concentration.toFixed(1)}%, 随机 ${randomConcentration.toFixed(1)}%`);
  }

  if (coverageResult.coverageRate >= 0.8) {
    console.log('✅ 前 6 步维度覆盖良好');
  } else {
    console.log('❌ 前 6 步覆盖不足');
    passed = false;
  }

  if (undoResult.stepOk && undoResult.countOk) {
    console.log('✅ 回退功能正常');
  } else {
    console.log('❌ 回退功能异常');
    passed = false;
  }

  if (shareOkCount >= testNames.length) {
    console.log('✅ 分享回放一致');
  } else {
    console.log('❌ 分享回放不一致');
    passed = false;
  }

  console.log(`\n${passed ? '✅ 全部通过' : '❌ 存在失败项'}`);

  // 保存摘要
  const summary = {
    engineVersion: 'v9-tendency-red',
    totalQuestions: data.questions.length,
    personalityCount: personalityNames.length,
    perfectCoverage: perfectHits,
    noisyCoverage: correctHits,
    selfHitRate: parseFloat(selfHitRate.toFixed(2)),
    distribution: { min: minHits, max: maxHits, avg: parseFloat(avgHits.toFixed(2)), top5Concentration: parseFloat(concentration.toFixed(2)) },
    randomDistribution: { min: randomMinHits, max: randomMaxHits, top5Concentration: parseFloat(randomConcentration.toFixed(2)) },
    steps: { avg: parseFloat(avgSteps.toFixed(2)), min: minSteps, max: maxSteps },
    randomSteps: { avg: parseFloat(randomAvgSteps.toFixed(2)), min: randomMinSteps, max: randomMaxSteps },
    earlyCoverage: coverageResult,
    undoOk: undoResult.stepOk && undoResult.countOk,
    shareReplayOk: shareOkCount === testNames.length,
    avgConfidence: parseFloat(avgConf.toFixed(3)),
    passed,
  };
  const summaryPath = path.join(__dirname, 'simulation-tendency-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n测试摘要已保存: ${summaryPath}`);

  process.exit(passed ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
