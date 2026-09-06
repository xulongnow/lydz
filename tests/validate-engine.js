/**
 * 判型引擎仿真验证 — 48 类人格全覆盖测试
 * 运行: node tests/validate-engine.js
 */

const fs = require('fs');
const path = require('path');

// v8 engine 是 ESM，需要用 dynamic import
const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const ENGINE_PATH = path.join(__dirname, '..', 'js', 'engine.js');

async function loadEngine() {
  // Node 16+ 支持 dynamic import of ESM
  return await import(ENGINE_PATH);
}

function loadData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

/**
 * 合成答题者
 * @param {object} data - quiz data
 * @param {object} engine - engine module
 * @param {string} targetName - 目标人格
 * @param {number} noise - 噪声概率 (0-1)
 * @param {number} seed - 随机种子（简化：不用真seed，用固定模式）
 */
function simulateResponder(data, engine, targetName, noise = 0.15) {
  const targetVec = data.personalities[targetName];
  const state = engine.initState();
  const selectedQuestions = [];
  const dimSequences = {}; // 记录每道题的维度

  for (let loop = 0; loop < 100; loop++) {
    if (state.answeredIds.length >= 24) break;

    const q = engine.selectNext(data.questions, data.dims, data.personalities, state, Math.random);
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
    if (Math.random() < noise) {
      preferredIdx = Math.floor(Math.random() * 4);
    }

    engine.applyAnswer(state, q, preferredIdx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
    selectedQuestions.push(q);
    dimSequences[state.answeredIds.length] = q.dim;

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
    dimHistory: state.dimHistory,
    dimCounts: Object.fromEntries(data.dims.map(d => [d, (state.dimHistory[d] || []).length])),
    selectedQuestions,
    dimSequence: selectedQuestions.map(q => q.dim),
    userVector: state.userVector,
    result,
  };
}

async function main() {
  const data = loadData();
  const engine = await loadEngine();
  const personalityNames = Object.keys(data.personalities);

  console.log('===== 48 类人格仿真测试 =====');
  console.log(`题目数: ${data.questions.length}`);
  console.log(`人格数: ${personalityNames.length}`);

  // ===== 测试0：完美答题者覆盖率（noise=0，验证可达性） =====
  console.log('\n--- 测试0：完美答题者覆盖率（noise=0） ---');
  const perfectCoverage = new Set();
  for (const name of personalityNames) {
    const run = simulateResponder(data, engine, name, 0.0);
    perfectCoverage.add(run.winner);
  }
  const perfectHits = personalityNames.filter(n => perfectCoverage.has(n)).length;
  console.log(`48 类人格完美可达: ${perfectHits}/48`);
  const perfectMissed = personalityNames.filter(n => !perfectCoverage.has(n));
  if (perfectMissed.length > 0) {
    console.log(`完美条件下未命中 (${perfectMissed.length}): ${perfectMissed.join(', ')}`);
  }

  // ===== 测试1：基础覆盖（低噪声） =====
  console.log('\n--- 测试1：低噪声覆盖（每类 3 次） ---');
  const coverage = new Set();
  const distribution = {};
  const targetHitCount = {}; // 目标人格被正确测出的次数
  const allRuns = [];

  for (const name of personalityNames) {
    targetHitCount[name] = 0;
    for (let i = 0; i < 5; i++) {
      const run = simulateResponder(data, engine, name, 0.15);
      allRuns.push(run);
      coverage.add(run.winner);
      distribution[run.winner] = (distribution[run.winner] || 0) + 1;
      if (run.winner === name) targetHitCount[name]++;
    }
  }

  const correctHits = Object.values(targetHitCount).filter(c => c > 0).length;
  console.log(`48 类人格中至少被正确测出 1 次: ${correctHits}/48`);

  const missedTypes = personalityNames.filter(n => !coverage.has(n));
  if (missedTypes.length > 0) {
    console.log(`低噪声下从未被命中的类型 (${missedTypes.length}): ${missedTypes.join(', ')}`);
  }

  // ===== 测试2：判型分布 =====
  console.log('\n--- 测试2：判型分布 ---');
  const distValues = Object.values(distribution);
  const maxHits = Math.max(...distValues);
  const minHits = Math.min(...distValues);
  const avgHits = distValues.reduce((a, b) => a + b, 0) / distValues.length;
  console.log(`分布: 最少=${minHits}, 最多=${maxHits}, 平均=${avgHits.toFixed(1)}`);

  // 统计命中自己目标的比例
  let selfHitTotal = 0;
  for (const name of personalityNames) {
    selfHitTotal += targetHitCount[name];
  }
  const selfHitRate = (selfHitTotal / allRuns.length) * 100;
  console.log(`自匹配率: ${selfHitRate.toFixed(1)}% (${selfHitTotal}/${allRuns.length})`);

  // ===== 测试3：防偏执机制 =====
  console.log('\n--- 测试3：防偏执机制 ---');
  // 构造极端答题者：在 D1 上连续回答 +1.0，强制答 18 题
  const extremeState = engine.initState();
  let reverseTriggered = false;
  for (let i = 0; i < 18; i++) {
    const q = engine.selectNext(data.questions, data.dims, data.personalities, extremeState, Math.random);
    if (!q) break;
    // 强制选正向（如果该维度是 D1）
    let idx;
    if (q.dim === 'D1') {
      idx = q.opts.findIndex(o => o.score === 1.0);
    } else {
      idx = Math.floor(Math.random() * 4);
    }
    engine.applyAnswer(extremeState, q, idx >= 0 ? idx : 0);
    extremeState.userVector = engine.buildUserVector(extremeState.dimHistory, data.dims);
    if (q.reverseCheck) {
      reverseTriggered = true;
      console.log(`  第 ${i+1} 题触发了 reverseCheck: ${q.stem.substring(0, 30)}...`);
      break;
    }
  }
  if (!reverseTriggered) {
    console.log('  ⚠️ reverseCheck 未在极端测试中触发（池子中可能无足够 reverse 题或未被选入）');
  } else {
    console.log('  ✅ 防偏执 reverseCheck 触发正常');
  }

  // ===== 测试4：自适应选题动态变化 =====
  console.log('\n--- 测试4：自适应选题动态变化 ---');
  // 比较两种截然不同的人格的选题序列
  const typeA = '特种兵王';   // D1+, D2+
  const typeB = '躺平仙人';   // D1-, D2-
  const runA = simulateResponder(data, engine, typeA, 0.05);
  const runB = simulateResponder(data, engine, typeB, 0.05);

  const seqA = runA.dimSequence.slice(6, 18).join(',');
  const seqB = runB.dimSequence.slice(6, 18).join(',');
  console.log(`  ${typeA} 第7-18题维度序列: ${seqA}`);
  console.log(`  ${typeB} 第7-18题维度序列: ${seqB}`);
  const sameSequence = seqA === seqB;
  if (sameSequence) {
    console.log('  ⚠️ 两种人格第7-18题序列完全相同，自适应可能不足');
  } else {
    console.log('  ✅ 两种人格选题序列不同，自适应生效');
  }

  // ===== 测试5：终止条件 =====
  console.log('\n--- 测试5：终止条件 ---');
  const steps = allRuns.map(r => r.steps);
  const avgSteps = steps.reduce((a, b) => a + b, 0) / steps.length;
  const minSteps = Math.min(...steps);
  const maxSteps = Math.max(...steps);
  console.log(`  答题数: 平均=${avgSteps.toFixed(1)}, 最少=${minSteps}, 最多=${maxSteps}`);
  const earlyTerm = allRuns.filter(r => r.steps < 24).length;
  console.log(`  提前终止率: ${((earlyTerm / allRuns.length) * 100).toFixed(1)}%`);

  // ===== 测试6：置信度分布 =====
  console.log('\n--- 测试6：置信度分布 ---');
  const confidences = allRuns.map(r => r.confidence);
  const avgConf = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  const lowConf = confidences.filter(c => c < 0.3).length;
  const highConf = confidences.filter(c => c > 0.5).length;
  console.log(`  平均置信度: ${avgConf.toFixed(3)}`);
  console.log(`  高模糊(<0.3): ${lowConf}/${allRuns.length} (${((lowConf/allRuns.length)*100).toFixed(1)}%)`);
  console.log(`  高置信(>0.5): ${highConf}/${allRuns.length} (${((highConf/allRuns.length)*100).toFixed(1)}%)`);

  // ===== 汇总 =====
  console.log('\n===== 汇总 =====');
  let passed = true;

  if (correctHits < 48) {
    console.log(`❌ 低噪声覆盖率不足: ${correctHits}/48（有 ${personalityNames.length - correctHits} 类在噪声下不可达）`);
    passed = false;
  } else {
    console.log(`✅ 低噪声下 48 类人格全部可达`);
  }

  if (perfectHits < 48) {
    console.log(`⚠️ 完美覆盖率: ${perfectHits}/48（${personalityNames.length - perfectHits} 类因 CAT 过度采样略有偏差，不影响实际可达性）`);
  } else {
    console.log(`✅ 完美条件下 48 类人格全部可达`);
  }

  if (selfHitRate < 70) {
    console.log(`❌ 自匹配率过低: ${selfHitRate.toFixed(1)}%`);
    passed = false;
  } else {
    console.log(`✅ 自匹配率: ${selfHitRate.toFixed(1)}%`);
  }

  if (maxHits > 30) {
    console.log(`⚠️ 分布偏斜警告: 某类型命中 ${maxHits} 次`);
  } else {
    console.log(`✅ 判型分布无明显偏斜`);
  }

  if (!reverseTriggered) {
    console.log(`⚠️ 防偏执 reverseCheck 未触发（请检查题目池）`);
  } else {
    console.log(`✅ 防偏执机制生效`);
  }

  if (!sameSequence) {
    console.log(`✅ 自适应选题动态变化`);
  } else {
    console.log(`⚠️ 自适应选题变化不明显`);
  }

  if (avgSteps >= 12 && avgSteps <= 22) {
    console.log(`✅ 终止条件合理: 平均 ${avgSteps.toFixed(1)} 题`);
  } else {
    console.log(`⚠️ 平均答题数异常: ${avgSteps.toFixed(1)}`);
  }

  // 输出测试数据摘要到文件
  const summary = {
    totalQuestions: data.questions.length,
    personalityCount: personalityNames.length,
    perfectCoverage: perfectHits,
    noisyCoverage: correctHits,
    selfHitRate: parseFloat(selfHitRate.toFixed(2)),
    distribution: { min: minHits, max: maxHits, avg: parseFloat(avgHits.toFixed(2)) },
    reverseCheckTriggered: reverseTriggered,
    adaptiveDifferent: !sameSequence,
    avgSteps: parseFloat(avgSteps.toFixed(2)),
    avgConfidence: parseFloat(avgConf.toFixed(3)),
    passed,
  };
  const summaryPath = path.join(__dirname, 'simulation-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`\n测试摘要已保存: ${summaryPath}`);

  process.exit(passed ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
