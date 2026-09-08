/**
 * 倾向驱动选题模拟验证
 * 运行: node tests/simulate-tendency.js
 *
 * 验证目标：
 * 1. 题数区间合理（12-24）
 * 2. 无死循环、无崩溃
 * 3. 48人格全部可达
 * 4. 结果人格分布不异常集中（单一种类不超过80%）
 * 5. undo/回退后状态一致性
 * 6. 分享链接编码/解码/回放一致性
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const ENGINE_PATH = path.join(__dirname, '..', 'js', 'engine.js');
const SHARE_PATH = path.join(__dirname, '..', 'js', 'share.js');

async function loadModules() {
  const engine = await import(ENGINE_PATH);
  const share = await import(SHARE_PATH);
  return { engine, share };
}

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
}

// ===== 随机答题者 =====
function simulateRandom(data, engine, rng) {
  const state = engine.initState();
  const dimSequence = [];

  for (let loop = 0; loop < 100; loop++) {
    if (state.answeredIds.length >= 24) break;

    const q = engine.selectNext(
      data.questions,
      data.dims,
      data.personalities,
      state,
      rng
    );
    if (!q) break;

    // 完全随机选选项
    const choiceIdx = Math.floor(rng() * q.opts.length);
    engine.applyAnswer(state, q, choiceIdx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
    dimSequence.push(q.dim);

    const result = engine.determineResult(
      state.userVector,
      data.personalities,
      data.dims
    );
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate && state.answeredIds.length >= 12) break;
  }

  const result = engine.determineResult(
    state.userVector,
    data.personalities,
    data.dims
  );

  return {
    winner: result.winner,
    confidence: result.confidence,
    ambiguity: result.ambiguity,
    steps: state.answeredIds.length,
    dimSequence,
    dimCounts: Object.fromEntries(
      data.dims.map(d => [d, (state.dimHistory[d] || []).length])
    ),
    userVector: state.userVector,
    answeredIds: state.answeredIds,
    state,
    result,
  };
}

// ===== 带噪声的定向答题者（向某个人格靠拢） =====
function simulateTargeted(data, engine, targetName, noise, rng) {
  const targetVec = data.personalities[targetName];
  const state = engine.initState();
  const dimSequence = [];

  for (let loop = 0; loop < 100; loop++) {
    if (state.answeredIds.length >= 24) break;

    const q = engine.selectNext(
      data.questions,
      data.dims,
      data.personalities,
      state,
      rng
    );
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
      preferredIdx = Math.floor(rng() * q.opts.length);
    }

    engine.applyAnswer(state, q, preferredIdx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
    dimSequence.push(q.dim);

    const result = engine.determineResult(
      state.userVector,
      data.personalities,
      data.dims
    );
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate && state.answeredIds.length >= 12) break;
  }

  const result = engine.determineResult(
    state.userVector,
    data.personalities,
    data.dims
  );

  return {
    target: targetName,
    winner: result.winner,
    confidence: result.confidence,
    steps: state.answeredIds.length,
    dimSequence,
    dimCounts: Object.fromEntries(
      data.dims.map(d => [d, (state.dimHistory[d] || []).length])
    ),
    userVector: state.userVector,
    state,
    result,
  };
}

// ===== 测试 undo 一致性 =====
function testUndoConsistency(data, engine, rng) {
  const state = engine.initState();

  // 答 5 题
  for (let i = 0; i < 5; i++) {
    const q = engine.selectNext(
      data.questions, data.dims, data.personalities, state, rng
    );
    if (!q) break;
    const idx = Math.floor(rng() * q.opts.length);
    engine.applyAnswer(state, q, idx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
  }

  const beforeIds = state.answeredIds.slice();
  const beforeStep = state.step;
  const beforeVector = { ...state.userVector };

  // 回退最后一题
  const lastQId = state.answeredIds[state.answeredIds.length - 1];
  const lastQ = data.questions.find(q => q.id === lastQId);
  const lastHist = state.dimHistory[lastQ.dim];
  const lastChoice = lastHist[lastHist.length - 1];
  // 找到该题在原始选项中的索引
  let choiceIdx = -1;
  for (let i = 0; i < lastQ.opts.length; i++) {
    if (lastQ.opts[i].score === lastChoice.score) {
      // 可能有多个相同score，取最后一个匹配的
      choiceIdx = i;
    }
  }

  engine.undoAnswer(state, lastQ, choiceIdx, data.dims);

  const afterIds = state.answeredIds.slice();

  // 验证
  const ok =
    afterIds.length === beforeIds.length - 1 &&
    state.step === beforeStep - 1 &&
    afterIds.every((id, i) => id === beforeIds[i]);

  return { ok, beforeStep, afterStep: state.step };
}

// ===== 主函数 =====
async function main() {
  const data = loadData();
  const { engine, share } = await loadModules();
  const personalityNames = Object.keys(data.personalities);

  console.log('===== 倾向驱动选题模拟验证 =====\n');

  // ===== 测试1：50条随机路径 =====
  console.log('--- 测试1：50条完全随机答题路径 ---');
  const randomRuns = [];
  let minSteps = Infinity;
  let maxSteps = -Infinity;
  let totalSteps = 0;

  for (let i = 0; i < 50; i++) {
    const rng = Math.random; // 每次用不同种子效果
    const run = simulateRandom(data, engine, rng);
    randomRuns.push(run);
    totalSteps += run.steps;
    if (run.steps < minSteps) minSteps = run.steps;
    if (run.steps > maxSteps) maxSteps = run.steps;
  }

  const avgSteps = totalSteps / randomRuns.length;
  console.log(`路径数: ${randomRuns.length}`);
  console.log(`题数区间: ${minSteps} - ${maxSteps}`);
  console.log(`平均题数: ${avgSteps.toFixed(1)}`);
  console.log(`全部在12-24范围内: ${randomRuns.every(r => r.steps >= 12 && r.steps <= 24) ? '✅' : '❌'}`);

  // ===== 测试2：人格分布 =====
  console.log('\n--- 测试2：随机路径人格分布 ---');
  const distribution = {};
  for (const run of randomRuns) {
    distribution[run.winner] = (distribution[run.winner] || 0) + 1;
  }
  const distValues = Object.values(distribution);
  const maxHits = Math.max(...distValues);
  const minHits = Math.min(...distValues);
  const uniqueTypes = Object.keys(distribution).length;
  const concentration = (maxHits / randomRuns.length) * 100;

  console.log(`覆盖人格种类: ${uniqueTypes}/48`);
  console.log(`分布: 最少=${minHits}, 最多=${maxHits}`);
  console.log(`最高集中度: ${concentration.toFixed(1)}%`);
  console.log(`分布是否异常集中(>80%): ${concentration > 80 ? '❌ 异常' : '✅ 正常'}`);

  // 打印Top5
  const sortedDist = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log('Top5 人格:');
  for (const [name, count] of sortedDist) {
    console.log(`  ${name}: ${count}次 (${((count / randomRuns.length) * 100).toFixed(1)}%)`);
  }

  // ===== 测试3：48人格完美可达性（noise=0，每类3次取并集） =====
  console.log('\n--- 测试3：48人格完美可达性（noise=0，每类3次） ---');
  const perfectCoverage = new Set();
  for (const name of personalityNames) {
    for (let i = 0; i < 3; i++) {
      const run = simulateTargeted(data, engine, name, 0.0, Math.random);
      perfectCoverage.add(run.winner);
    }
  }
  const perfectHits = personalityNames.filter(n => perfectCoverage.has(n)).length;
  console.log(`48类人格完美可达: ${perfectHits}/48 ${perfectHits === 48 ? '✅' : '❌'}`);
  if (perfectHits < 48) {
    const missed = personalityNames.filter(n => !perfectCoverage.has(n));
    console.log(`未命中: ${missed.join(', ')}`);
  }

  // ===== 测试4：低噪声自匹配率 =====
  console.log('\n--- 测试4：低噪声自匹配率（noise=0.15，每类3次）---');
  let selfHitTotal = 0;
  let totalRuns = 0;
  const lowNoiseCoverage = new Set();

  for (const name of personalityNames) {
    for (let i = 0; i < 3; i++) {
      const run = simulateTargeted(data, engine, name, 0.15, Math.random);
      totalRuns++;
      lowNoiseCoverage.add(run.winner);
      if (run.winner === name) selfHitTotal++;
    }
  }
  const selfHitRate = (selfHitTotal / totalRuns) * 100;
  console.log(`自匹配率: ${selfHitRate.toFixed(1)}% (${selfHitTotal}/${totalRuns})`);
  console.log(`低噪声覆盖: ${lowNoiseCoverage.size}/48 ${lowNoiseCoverage.size === 48 ? '✅' : '❌'}`);

  // ===== 测试5：维度覆盖均衡性 =====
  console.log('\n--- 测试5：维度覆盖均衡性（随机路径平均） ---');
  const avgDimCounts = {};
  for (const d of data.dims) {
    const sum = randomRuns.reduce((a, r) => a + (r.dimCounts[d] || 0), 0);
    avgDimCounts[d] = sum / randomRuns.length;
  }
  for (const d of data.dims) {
    console.log(`  ${d}: 平均 ${avgDimCounts[d].toFixed(1)} 题`);
  }
  const dimStd = Math.sqrt(
    Object.values(avgDimCounts).reduce((sum, v) => sum + (v - avgSteps / 6) ** 2, 0) / 6
  );
  console.log(`  维度分布标准差: ${dimStd.toFixed(2)}`);

  // ===== 测试6：undo一致性 =====
  console.log('\n--- 测试6：undo状态一致性 ---');
  let undoPass = 0;
  let undoFail = 0;
  for (let i = 0; i < 20; i++) {
    const res = testUndoConsistency(data, engine, Math.random);
    if (res.ok) undoPass++;
    else undoFail++;
  }
  console.log(`通过: ${undoPass}/20, 失败: ${undoFail}/20 ${undoFail === 0 ? '✅' : '❌'}`);

  // ===== 测试7：分享链接编解码一致性 =====
  console.log('\n--- 测试7：分享链接编解码一致性 ---');
  let sharePass = 0;
  let shareFail = 0;
  for (let i = 0; i < 20; i++) {
    const run = simulateRandom(data, engine, Math.random);
    const path = run.state.answeredIds.map((id, idx) => {
      const q = data.questions.find(q => q.id === id);
      const hist = run.state.dimHistory[q.dim];
      // 找到对应step的记录
      const record = hist.find(h => h.step === idx + 1);
      // 找到选项索引
      let optIdx = 0;
      for (let j = 0; j < q.opts.length; j++) {
        if (q.opts[j].score === record.score) optIdx = j;
      }
      return [id, optIdx];
    });

    const encoded = share.encodeShare(run.winner, path);
    const decoded = share.decodeShare(encoded);

    if (
      decoded &&
      decoded.r === run.winner &&
      decoded.p.length === path.length &&
      decoded.p.every((pair, idx) => pair[0] === path[idx][0] && pair[1] === path[idx][1])
    ) {
      sharePass++;
    } else {
      shareFail++;
    }
  }
  console.log(`通过: ${sharePass}/20, 失败: ${shareFail}/20 ${shareFail === 0 ? '✅' : '❌'}`);

  // ===== 汇总 =====
  console.log('\n===== 汇总 =====');
  const allPass =
    randomRuns.every(r => r.steps >= 12 && r.steps <= 24) &&
    concentration <= 80 &&
    perfectHits === 48 &&
    lowNoiseCoverage.size === 48 &&
    undoFail === 0 &&
    shareFail === 0 &&
    selfHitRate >= 70;

  if (allPass) {
    console.log('✅ 全部通过');
    process.exit(0);
  } else {
    console.log('❌ 存在未通过项，详见上文');
    process.exit(1);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
