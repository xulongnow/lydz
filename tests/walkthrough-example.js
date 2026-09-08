/**
 * 前5步走查示例 — 倾向驱动选题的可视化演示
 * 运行: node tests/walkthrough-example.js
 *
 * 演示"特种兵王"人格（D1+, D2+, D3+, D4+, D5+, D6+）的答题前5步，
 * 每步展示：当前状态 → 倾向判断 → 候选池 → 抽题结果
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

function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// 复现 selectNext 的决策逻辑（只分析，不修改状态）
function analyzeTendency(data, engine, state, personalities) {
  const { answeredIds, dimHistory, step } = state;
  const dims = data.dims;

  // 计算不确定性
  const uncertainties = {};
  for (const d of dims) {
    const hist = dimHistory[d] || [];
    const count = hist.length;
    const variance = count > 1
      ? (() => {
          const mean = hist.reduce((a, h) => a + h.score, 0) / count;
          return hist.reduce((sum, h) => sum + (h.score - mean) ** 2, 0) / count;
        })()
      : 1.0;
    const meanAbs = count > 0
      ? hist.reduce((a, h) => a + Math.abs(h.score), 0) / count
      : 0;
    uncertainties[d] = (1 / (count + 1)) * (variance + 0.5) * (1 - 0.25 * meanAbs);
  }

  // 计算Top人格
  const currentVec = engine.buildUserVector(dimHistory, dims);
  const currentResult = engine.determineResult(currentVec, personalities, dims);
  const top2 = currentResult.top3.slice(0, 2);

  // 找出差异最大的维度
  let discriminativeDim = null;
  let maxDiff = -1;
  if (top2.length >= 2) {
    const p1 = personalities[top2[0].name];
    const p2 = personalities[top2[1].name];
    for (const d of dims) {
      const diff = Math.abs((p1[d] || 0) - (p2[d] || 0));
      if (diff > maxDiff) {
        maxDiff = diff;
        discriminativeDim = d;
      }
    }
  }

  // 覆盖检查
  const underCovered = dims.filter(d => {
    const count = (dimHistory[d] || []).length;
    return step < 6 && count < 1;
  });

  // 确定目标维度
  let targetDim;
  let reason;
  if (underCovered.length > 0) {
    targetDim = underCovered.sort((a, b) => uncertainties[b] - uncertainties[a])[0];
    reason = '强制覆盖（前6题每维至少1题）';
  } else {
    const uncertaintyWeight = step <= 8 ? 0.7 : 0.3;
    const discrimWeight = 1 - uncertaintyWeight;
    const maxUncertainty = Math.max(...Object.values(uncertainties));
    const dimScores = {};
    for (const d of dims) {
      const uScore = maxUncertainty > 0 ? uncertainties[d] / maxUncertainty : 0;
      const dScore = discriminativeDim === d ? 1.0 : 0;
      dimScores[d] = uncertaintyWeight * uScore + discrimWeight * dScore;
    }
    const scoredDims = dims.slice().sort((a, b) => dimScores[b] - dimScores[a]);
    targetDim = scoredDims[0];
    reason = `混合策略(不确定性权重${uncertaintyWeight})`;
  }

  return {
    step,
    uncertainties,
    top2: top2.map(t => t.name),
    discriminativeDim,
    maxDiff,
    underCovered,
    targetDim,
    reason,
    userVector: currentVec,
  };
}

async function main() {
  const data = loadData();
  const engine = await loadEngine();
  const personalities = data.personalities;
  const targetName = '特种兵王';
  const targetVec = personalities[targetName];
  const rng = makeRng(42);

  const state = engine.initState();

  console.log(`===== 前5步走查：${targetName} =====\n`);
  console.log(`目标人格向量: D1=${targetVec.D1}, D2=${targetVec.D2}, D3=${targetVec.D3}, D4=${targetVec.D4}, D5=${targetVec.D5}, D6=${targetVec.D6}`);
  console.log('---\n');

  for (let i = 0; i < 5; i++) {
    const analysis = analyzeTendency(data, engine, state, personalities);

    console.log(`【第 ${analysis.step + 1} 题】`);
    console.log(`  当前已答题数: ${state.answeredIds.length}`);
    console.log(`  当前用户向量: D1=${analysis.userVector.D1?.toFixed(2)||0}, D2=${analysis.userVector.D2?.toFixed(2)||0}, D3=${analysis.userVector.D3?.toFixed(2)||0}, D4=${analysis.userVector.D4?.toFixed(2)||0}, D5=${analysis.userVector.D5?.toFixed(2)||0}, D6=${analysis.userVector.D6?.toFixed(2)||0}`);

    if (analysis.top2.length >= 2) {
      console.log(`  当前Top2人格: ${analysis.top2[0]} vs ${analysis.top2[1]}`);
      console.log(`  差异最大维度: ${analysis.discriminativeDim} (差值=${analysis.maxDiff.toFixed(2)})`);
    } else {
      console.log(`  当前Top2人格: 数据不足`);
    }

    console.log(`  各维度不确定性:`);
    for (const d of data.dims) {
      const u = analysis.uncertainties[d];
      const histLen = (state.dimHistory[d] || []).length;
      const marker = d === analysis.targetDim ? ' ← 目标维度' : '';
      console.log(`    ${d}: ${u.toFixed(3)} (已答${histLen}题)${marker}`);
    }

    if (analysis.underCovered.length > 0) {
      console.log(`  未覆盖维度: ${analysis.underCovered.join(', ')}`);
    }
    console.log(`  倾向判断: ${analysis.reason} → 选定维度 ${analysis.targetDim}`);

    // 抽题
    const q = engine.selectNext(data.questions, data.dims, personalities, state, rng);
    if (!q) {
      console.log(`  ⚠️ 无题可出`);
      break;
    }

    console.log(`  抽题结果: [${q.id}] ${q.stem.substring(0, 40)}...`);
    console.log(`    维度=${q.dim}, layer=${q.layer}, sceneTag=${q.sceneTag}, reverse=${q.reverseCheck}`);

    // 模拟答题（选最接近目标人格的选项）
    const targetScore = targetVec[q.dim] || 0;
    let preferredIdx = 0;
    let minDiff = Infinity;
    for (let j = 0; j < q.opts.length; j++) {
      const diff = Math.abs(q.opts[j].score - targetScore);
      if (diff < minDiff) {
        minDiff = diff;
        preferredIdx = j;
      }
    }
    const chosen = q.opts[preferredIdx];
    console.log(`  选择选项: "${chosen.text.substring(0, 30)}..." (score=${chosen.score})`);

    engine.applyAnswer(state, q, preferredIdx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
    console.log('');
  }

  console.log('===== 走查结束 =====');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
