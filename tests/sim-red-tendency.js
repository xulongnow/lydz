/**
 * 红方 A — 倾向驱动选题逻辑模拟验证
 * 运行: node tests/sim-red-tendency.js
 *
 * 验证目标:
 * 1. 至少 50 条随机答题路径无崩溃、无死循环
 * 2. 题数区间在 [12, 24] 内
 * 3. 结果人格分布不异常集中（前 5 种人格占比 < 80%）
 * 4. 分享链接编码/解码与回放一致性
 * 5. undoAnswer 状态回滚正确
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

/**
 * 完全随机答题者
 */
function simulateRandom(data, engine, seed = 0) {
  const state = engine.initState();
  const selectedQuestions = [];

  // 用简单伪随机保证可复现
  let s = seed + 12345;
  const rng = () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };

  for (let loop = 0; loop < 200; loop++) {
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
    dimCounts: Object.fromEntries(data.dims.map(d => [d, (state.dimHistory[d] || []).length])),
    dimSequence: selectedQuestions.map(q => q.dim),
    userVector: state.userVector,
    confidence: result.confidence,
    state,
    selectedQuestions,
  };
}

/**
 * 带噪声的定向答题者（模拟真实用户）
 */
function simulateBiased(data, engine, targetName, noise = 0.25, seed = 0) {
  const targetVec = data.personalities[targetName];
  const state = engine.initState();
  const selectedQuestions = [];

  let s = seed + 54321;
  const rng = () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };

  for (let loop = 0; loop < 200; loop++) {
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
    selectedQuestions.push(q);

    const result = engine.determineResult(state.userVector, data.personalities, data.dims);
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate && state.answeredIds.length >= 12) break;
  }

  const result = engine.determineResult(state.userVector, data.personalities, data.dims);
  return {
    target: targetName,
    winner: result.winner,
    steps: state.answeredIds.length,
    dimCounts: Object.fromEntries(data.dims.map(d => [d, (state.dimHistory[d] || []).length])),
    dimSequence: selectedQuestions.map(q => q.dim),
    userVector: state.userVector,
    confidence: result.confidence,
    state,
    selectedQuestions,
  };
}

/**
 * 验证 undoAnswer 回滚一致性
 */
function testUndo(data, engine) {
  const state = engine.initState();
  const rng = Math.random;

  // 先答 5 题
  const questions = [];
  for (let i = 0; i < 5; i++) {
    const q = engine.selectNext(data.questions, data.dims, data.personalities, state, rng);
    if (!q) break;
    const idx = Math.floor(rng() * q.opts.length);
    engine.applyAnswer(state, q, idx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
    questions.push({ q, idx });
  }

  const beforeVec = { ...state.userVector };
  const beforeStep = state.step;
  const beforeIds = [...state.answeredIds];

  // 回退最后一题
  const last = questions[questions.length - 1];
  engine.undoAnswer(state, last.q, last.idx, data.dims);

  const afterVec = state.userVector;
  const afterStep = state.step;
  const afterIds = state.answeredIds;

  const ok = (
    afterStep === beforeStep - 1 &&
    afterIds.length === beforeIds.length - 1 &&
    !afterIds.includes(last.q.id)
  );

  // 检查 userVector 是否回滚正确
  const prevVec = engine.buildUserVector(
    Object.fromEntries(data.dims.map(d => [d, (state.dimHistory[d] || []).slice()])),
    data.dims
  );
  const vecOk = data.dims.every(d => Math.abs(afterVec[d] - prevVec[d]) < 0.001);

  return { ok: ok && vecOk, beforeStep, afterStep };
}

/**
 * 验证分享链接编码/解码与回放一致性
 */
function testShareReplay(data, engine, share) {
  const state = engine.initState();
  const rng = Math.random;
  const path = [];

  for (let i = 0; i < 15; i++) {
    const q = engine.selectNext(data.questions, data.dims, data.personalities, state, rng);
    if (!q) break;
    const idx = Math.floor(rng() * q.opts.length);
    engine.applyAnswer(state, q, idx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
    path.push([q.id, idx]);
  }

  const result = engine.determineResult(state.userVector, data.personalities, data.dims);
  const encoded = share.encodeShare(result.winner, path);
  const decoded = share.decodeShare(encoded);

  if (!decoded || !decoded.p) return { ok: false, reason: 'decode failed' };

  // 手动回放
  const replayState = engine.initState();
  for (const [qId, origIdx] of decoded.p) {
    const q = data.questions.find(qq => qq.id === qId);
    if (!q) continue;
    engine.applyAnswer(replayState, q, origIdx);
    replayState.userVector = engine.buildUserVector(replayState.dimHistory, data.dims);
  }
  const replayResult = engine.determineResult(replayState.userVector, data.personalities, data.dims);

  const winnerOk = replayResult.winner === result.winner;
  const vecOk = data.dims.every(d => Math.abs(replayResult.userVector[d] - result.userVector[d]) < 0.001);

  return { ok: winnerOk && vecOk, winner: result.winner, replayWinner: replayResult.winner };
}

async function main() {
  const data = loadData();
  const { engine, share } = await loadModules();

  console.log('===== 红方 A — 倾向驱动选题模拟验证 =====\n');

  // ===== 测试1：50 条完全随机路径 =====
  console.log('--- 测试1：50 条完全随机答题路径 ---');
  const randomRuns = [];
  let crashCount = 0;
  for (let i = 0; i < 50; i++) {
    try {
      const run = simulateRandom(data, engine, i);
      randomRuns.push(run);
    } catch (e) {
      crashCount++;
      console.log(`  ❌ 路径 ${i} 崩溃: ${e.message}`);
    }
  }
  console.log(`  完成路径: ${randomRuns.length}/50, 崩溃: ${crashCount}`);

  const stepsList = randomRuns.map(r => r.steps);
  const minSteps = Math.min(...stepsList);
  const maxSteps = Math.max(...stepsList);
  const avgSteps = stepsList.reduce((a, b) => a + b, 0) / stepsList.length;
  console.log(`  题数区间: [${minSteps}, ${maxSteps}], 平均: ${avgSteps.toFixed(1)}`);

  const outOfRange = stepsList.filter(s => s < 12 || s > 24);
  console.log(`  超出 [12,24] 范围: ${outOfRange.length}`);

  // 人格分布
  const dist = {};
  for (const r of randomRuns) {
    dist[r.winner] = (dist[r.winner] || 0) + 1;
  }
  const sortedDist = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  const top5Count = sortedDist.slice(0, 5).reduce((a, [, c]) => a + c, 0);
  const top5Ratio = (top5Count / randomRuns.length) * 100;
  console.log(`  人格种数: ${sortedDist.length}/48`);
  console.log(`  Top5 人格占比: ${top5Ratio.toFixed(1)}%`);
  console.log(`  分布: 最少=${sortedDist[sortedDist.length - 1]?.[1] || 0}, 最多=${sortedDist[0]?.[1] || 0}`);

  // ===== 测试2：48 类人格低噪声自匹配 =====
  console.log('\n--- 测试2：48 类人格低噪声自匹配（每类 2 次）---');
  const personalityNames = Object.keys(data.personalities);
  const biasedRuns = [];
  let selfHit = 0;
  let total = 0;
  for (const name of personalityNames) {
    for (let i = 0; i < 2; i++) {
      const run = simulateBiased(data, engine, name, 0.15, i);
      biasedRuns.push(run);
      total++;
      if (run.winner === name) selfHit++;
    }
  }
  const selfHitRate = (selfHit / total) * 100;
  console.log(`  自匹配率: ${selfHitRate.toFixed(1)}% (${selfHit}/${total})`);
  const biasedSteps = biasedRuns.map(r => r.steps);
  console.log(`  题数区间: [${Math.min(...biasedSteps)}, ${Math.max(...biasedSteps)}], 平均: ${(biasedSteps.reduce((a,b)=>a+b,0)/biasedSteps.length).toFixed(1)}`);

  // ===== 测试3：undo 回滚一致性 =====
  console.log('\n--- 测试3：undoAnswer 状态回滚一致性 ---');
  let undoOk = 0;
  for (let i = 0; i < 20; i++) {
    const r = testUndo(data, engine);
    if (r.ok) undoOk++;
  }
  console.log(`  通过: ${undoOk}/20`);

  // ===== 测试4：分享链路一致性 =====
  console.log('\n--- 测试4：分享编码/解码/回放一致性 ---');
  let shareOk = 0;
  for (let i = 0; i < 20; i++) {
    const r = testShareReplay(data, engine, share);
    if (r.ok) shareOk++;
  }
  console.log(`  通过: ${shareOk}/20`);

  // ===== 测试5：维度覆盖均衡性 =====
  console.log('\n--- 测试5：随机路径维度覆盖均衡性 ---');
  const dimTotals = {};
  for (const d of data.dims) dimTotals[d] = 0;
  for (const r of randomRuns) {
    for (const d of data.dims) dimTotals[d] += r.dimCounts[d] || 0;
  }
  const dimAvgs = data.dims.map(d => ({
    dim: d,
    avg: (dimTotals[d] / randomRuns.length).toFixed(1),
  }));
  for (const da of dimAvgs) {
    console.log(`  ${da.dim}: 平均 ${da.avg} 题`);
  }

  // ===== 测试6：前 5 步倾向判断示例 =====
  console.log('\n--- 测试6：前 5 步倾向判断走查（单条路径）---');
  const traceState = engine.initState();
  const traceRng = (() => {
    let s = 99999;
    return () => {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  })();

  for (let i = 0; i < 5; i++) {
    const q = engine.selectNext(data.questions, data.dims, data.personalities, traceState, traceRng);
    if (!q) {
      console.log(`  第 ${i + 1} 步: 无可用题目`);
      break;
    }
    const idx = Math.floor(traceRng() * q.opts.length);
    engine.applyAnswer(traceState, q, idx);
    traceState.userVector = engine.buildUserVector(traceState.dimHistory, data.dims);

    const result = engine.determineResult(traceState.userVector, data.personalities, data.dims);
    const topNames = result.top3.slice(0, 3).map(t => t.name).join(' > ');
    console.log(`  第 ${i + 1} 步: 出${q.dim}题「${q.stem.substring(0, 20)}…」→ 选${q.opts[idx].score > 0 ? '+' : ''}${q.opts[idx].score} | Top3: ${topNames}`);
  }

  // ===== 汇总 =====
  console.log('\n===== 汇总 =====');
  const allOk = (
    crashCount === 0 &&
    outOfRange.length === 0 &&
    top5Ratio < 80 &&
    undoOk === 20 &&
    shareOk === 20
  );

  if (allOk) {
    console.log('✅ 全部通过');
    process.exit(0);
  } else {
    console.log('❌ 存在未通过项');
    if (crashCount > 0) console.log('   - 随机路径崩溃');
    if (outOfRange.length > 0) console.log('   - 题数超出 [12,24]');
    if (top5Ratio >= 80) console.log('   - 人格分布过度集中');
    if (undoOk < 20) console.log('   - undo 回滚不一致');
    if (shareOk < 20) console.log('   - 分享链路不一致');
    process.exit(1);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
