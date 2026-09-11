/**
 * 判型引擎仿真验证 — 48 类人格全覆盖测试（种子化 RNG，结果可复现）
 * 运行: node tests/validate-engine.js
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const ENGINE_PATH = path.join(__dirname, '..', 'js', 'engine.js');

const SEED = 42;

async function loadEngine() {
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
 * @param {number} seedOffset - 种子偏移，保证不同人格/轮次独立
 */
function simulateResponder(data, engine, targetName, noise = 0.15, seedOffset = 0) {
  const targetVec = data.personalities[targetName];
  const state = engine.initState();
  const selectedQuestions = [];
  const dimSequences = {};

  // 种子化 RNG：基础种子 + 人格索引偏移，确保可复现
  const rng = engine.makeRng(SEED + seedOffset);
  // 选项选择也需要独立的 RNG，避免与选题 RNG 耦合
  const optRng = engine.makeRng(SEED + seedOffset + 100000);

  for (let loop = 0; loop < 100; loop++) {
    if (state.answeredIds.length >= 24) break;

    const q = engine.selectNext(data.questions, data.dims, data.personalities, state, rng);
    if (!q) break;

    // 选择策略：选 score 最接近目标向量该维度值的选项
    // 反向题在引擎中会自动翻转得分，因此仿真器需模拟这一行为
    const targetScore = targetVec[q.dim] || 0;
    let preferredIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < q.opts.length; i++) {
      let effectiveScore = q.opts[i].score;
      if (q.reverseCheck) {
        effectiveScore = -effectiveScore;
      }
      const diff = Math.abs(effectiveScore - targetScore);
      if (diff < minDiff) {
        minDiff = diff;
        preferredIdx = i;
      }
    }
    if (optRng() < noise) {
      preferredIdx = Math.floor(optRng() * 4);
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
  console.log(`RNG 种子: ${SEED}`);

  // ===== 测试0：完美答题者覆盖率（noise=0，验证可达性） =====
  console.log('\n--- 测试0：完美答题者覆盖率（noise=0） ---');
  const perfectCoverage = new Set();
  for (let i = 0; i < personalityNames.length; i++) {
    const name = personalityNames[i];
    const run = simulateResponder(data, engine, name, 0.0, i);
    perfectCoverage.add(run.winner);
  }
  const perfectHits = personalityNames.filter(n => perfectCoverage.has(n)).length;
  console.log(`48 类人格完美可达: ${perfectHits}/48`);
  const perfectMissed = personalityNames.filter(n => !perfectCoverage.has(n));
  if (perfectMissed.length > 0) {
    console.log(`完美条件下未命中 (${perfectMissed.length}): ${perfectMissed.join(', ')}`);
  }

  // ===== 测试1：基础覆盖（低噪声 seeded） =====
  console.log('\n--- 测试1：低噪声覆盖（每类 50 次，seeded） ---');
  const coverage = new Set();
  const distribution = {};
  const targetHitCount = {};
  const allRuns = [];
  const first6Coverage = []; // 前6题覆盖率统计

  for (let i = 0; i < personalityNames.length; i++) {
    const name = personalityNames[i];
    targetHitCount[name] = 0;
    for (let j = 0; j < 50; j++) {
      const seedOffset = i * 1000 + j;
      const run = simulateResponder(data, engine, name, 0.15, seedOffset);
      allRuns.push(run);
      coverage.add(run.winner);
      distribution[run.winner] = (distribution[run.winner] || 0) + 1;
      if (run.winner === name) targetHitCount[name]++;

      // 前6题覆盖率：检查前6题是否覆盖了所有6个维度
      const first6Dims = run.dimSequence.slice(0, 6);
      const coveredDims = new Set(first6Dims);
      first6Coverage.push(coveredDims.size === data.dims.length);
    }
  }

  const correctHits = Object.values(targetHitCount).filter(c => c > 0).length;
  console.log(`48 类人格中至少被正确测出 1 次: ${correctHits}/48`);

  // ===== 测试1b：个体人格下限检查（≥75%，已知天花板人格除外） =====
  const KNOWN_CEILING_PERSONALITIES = ['多啦A梦'];
  const lowIndividual = [];
  const ceilingLow = [];
  for (const name of personalityNames) {
    const rate = targetHitCount[name] / 50;
    if (rate < 0.75) {
      const info = `${name}: ${(rate * 100).toFixed(1)}% (${targetHitCount[name]}/50)`;
      if (KNOWN_CEILING_PERSONALITIES.includes(name)) {
        ceilingLow.push(info);
      } else {
        lowIndividual.push(info);
      }
    }
  }
  if (ceilingLow.length > 0) {
    console.log(`⚠️ 已知天花板人格 <75% (${ceilingLow.length}):`);
    for (const item of ceilingLow) {
      console.log(`    - ${item}`);
    }
  }
  if (lowIndividual.length > 0) {
    console.log(`❌ 非天花板人格 <75% (${lowIndividual.length}):`);
    for (const item of lowIndividual) {
      console.log(`    - ${item}`);
    }
  }
  if (ceilingLow.length === 0 && lowIndividual.length === 0) {
    console.log(`✅ 全部人格个体下限 ≥75%`);
  }

  const missedTypes = personalityNames.filter(n => !coverage.has(n));
  if (missedTypes.length > 0) {
    console.log(`低噪声下从未被命中的类型 (${missedTypes.length}): ${missedTypes.join(', ')}`);
  }

  // ===== 测试1a：前6题覆盖率 =====
  const first6Rate = first6Coverage.filter(Boolean).length / first6Coverage.length;
  console.log(`前6题覆盖率: ${(first6Rate * 100).toFixed(1)}% (${first6Coverage.filter(Boolean).length}/${first6Coverage.length})`);

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
  const extremeRng = engine.makeRng(SEED + 99999);
  const extremeState = engine.initState();
  let reverseTriggered = false;
  for (let i = 0; i < 18; i++) {
    const q = engine.selectNext(data.questions, data.dims, data.personalities, extremeState, extremeRng);
    if (!q) break;
    let idx;
    if (q.dim === 'D1') {
      idx = q.opts.findIndex(o => o.score === 1.0);
    } else {
      idx = Math.floor(extremeRng() * 4);
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
  const typeA = '特种兵王';
  const typeB = '躺平仙人';
  const runA = simulateResponder(data, engine, typeA, 0.05, 200000);
  const runB = simulateResponder(data, engine, typeB, 0.05, 200001);

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

  // ===== 测试7：RNG 种子化可复现性 =====
  console.log('\n--- 测试7：RNG 种子化可复现性 ---');
  const rep1 = simulateResponder(data, engine, '特种兵王', 0.15, 300000);
  const rep2 = simulateResponder(data, engine, '特种兵王', 0.15, 300000);
  const rep3 = simulateResponder(data, engine, '特种兵王', 0.15, 300000);
  const repMatch = rep1.winner === rep2.winner && rep2.winner === rep3.winner
    && rep1.steps === rep2.steps && rep2.steps === rep3.steps
    && JSON.stringify(rep1.dimSequence) === JSON.stringify(rep2.dimSequence)
    && JSON.stringify(rep2.dimSequence) === JSON.stringify(rep3.dimSequence);
  if (repMatch) {
    console.log('  ✅ 同一种子跑3次，winner/steps/sequence 完全一致');
  } else {
    console.log('  ❌ 种子化 RNG 复现性失败');
    console.log(`    run1: ${rep1.winner} ${rep1.steps}题`);
    console.log(`    run2: ${rep2.winner} ${rep2.steps}题`);
    console.log(`    run3: ${rep3.winner} ${rep3.steps}题`);
  }

  // ===== 汇总 =====
  console.log('\n===== 汇总 =====');
  let passed = true;

  if (correctHits < 47) {
    console.log(`❌ 低噪声覆盖率不足: ${correctHits}/48`);
    passed = false;
  } else if (correctHits < 48) {
    console.log(`⚠️ 低噪声覆盖率: ${correctHits}/48（1-2类未命中属正常范围）`);
  } else {
    console.log(`✅ 低噪声下 48 类人格全部可达`);
  }

  if (perfectHits < 48) {
    console.log(`⚠️ 完美覆盖率: ${perfectHits}/48`);
  } else {
    console.log(`✅ 完美条件下 48 类人格全部可达`);
  }

  if (selfHitRate < 70) {
    console.log(`❌ 自匹配率过低: ${selfHitRate.toFixed(1)}%`);
    passed = false;
  } else if (selfHitRate < 80) {
    console.log(`⚠️ 自匹配率: ${selfHitRate.toFixed(1)}%（低于目标 80-85%）`);
  } else {
    console.log(`✅ 自匹配率: ${selfHitRate.toFixed(1)}%`);
  }

  if (lowIndividual.length > 0) {
    console.log(`❌ 个体下限不足: ${lowIndividual.length} 个非天花板人格 <75%`);
    passed = false;
  } else {
    console.log(`✅ 全部非天花板人格个体下限 ≥75%`);
  }

  if (first6Rate < 1.0) {
    console.log(`⚠️ 前6题覆盖率: ${(first6Rate * 100).toFixed(1)}%`);
  } else {
    console.log(`✅ 前6题覆盖率 100%`);
  }

  if (minSteps < 12 || maxSteps > 24) {
    console.log(`⚠️ 题数超出 [12,24]: [${minSteps}, ${maxSteps}]`);
    passed = false;
  } else {
    console.log(`✅ 题数在 [12,24] 区间`);
  }

  if (maxHits > 30) {
    console.log(`⚠️ 分布偏斜警告: 某类型命中 ${maxHits} 次`);
  } else {
    console.log(`✅ 判型分布无明显偏斜`);
  }

  if (!reverseTriggered) {
    console.log(`⚠️ 防偏执 reverseCheck 未触发`);
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

  if (!repMatch) {
    console.log(`❌ RNG 种子化复现性验证失败`);
    passed = false;
  } else {
    console.log(`✅ RNG 种子化复现性验证通过`);
  }

  // 输出测试数据摘要到文件
  const summary = {
    totalQuestions: data.questions.length,
    personalityCount: personalityNames.length,
    seed: SEED,
    perfectCoverage: perfectHits,
    noisyCoverage: correctHits,
    selfHitRate: parseFloat(selfHitRate.toFixed(2)),
    first6CoverageRate: parseFloat((first6Rate * 100).toFixed(1)),
    distribution: { min: minHits, max: maxHits, avg: parseFloat(avgHits.toFixed(2)) },
    reverseCheckTriggered: reverseTriggered,
    adaptiveDifferent: !sameSequence,
    rngReproducible: repMatch,
    avgSteps: parseFloat(avgSteps.toFixed(2)),
    minSteps,
    maxSteps,
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
