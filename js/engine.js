/**
 * CAT 自适应出题引擎 v9 — 倾向驱动 + 随机选题
 * 纯函数集合，零 DOM 依赖
 * 基于六维向量 + 欧氏距离的判型算法
 * 可 Node.js 直接单元测试
 */

// ===== 配置参数 =====
const CONFIG = {
  EARLY_DECAY_END: 5,
  EARLY_DECAY_FACTOR: 0.6,
  MID_DECAY_END: 10,
  MID_DECAY_FACTOR: 0.8,
  LATE_FACTOR: 1.0,

  // 覆盖补充
  COVERAGE_MIN_COUNT: 1,
  COVERAGE_MAX_STEP: 6,

  // 不确定性计算
  UNCERTAINTY_BASE: 0.5,

  // 反向验证触发
  REVERSE_TRIGGER_COUNT: 3,

  // 探索/利用平衡：前期有概率不从最优维度选题
  EXPLORE_PROB: 0.15,
  EXPLORE_MAX_STEP: 8,

  // 连续同维度限制
  MAX_CONSECUTIVE_SAME_DIM: 2,

  // Layer 阈值（激活 layer 字段）
  LAYER_CORE_MAX_STEP: 6,
  LAYER_SELECT_MAX_STEP: 12,

  // 终止条件
  MIN_QUESTIONS: 12,
  MAX_QUESTIONS: 24,
  CONFIDENCE_THRESHOLD: 0.22,
  DIM_SATURATED_COUNT: 3,      // 从4降到3，使其真正可达
  DIM_SATURATED_VARIANCE: 0.5,

  // 模糊度阈值
  HIGH_AMBIGUITY_THRESHOLD: 0.22,
  MEDIUM_AMBIGUITY_THRESHOLD: 0.45,
};

const MAX_DIM_DISTANCE = Math.sqrt(6 * 4); // 6维，每维最大差 2（从-1到+1）

// ===== 状态初始化 =====
export function initState() {
  return {
    answeredIds: [],
    dimHistory: {},
    userVector: {},
    step: 0,
  };
}

// ===== 维度得分计算 =====
function computeDimScore(dimHistory, dim) {
  const answers = dimHistory[dim] || [];
  if (answers.length === 0) return 0;

  let weightedSum = 0;
  let weightSum = 0;

  for (const ans of answers) {
    const step = ans.step;
    let factor;
    if (step <= CONFIG.EARLY_DECAY_END) {
      factor = CONFIG.EARLY_DECAY_FACTOR;
    } else if (step <= CONFIG.MID_DECAY_END) {
      factor = CONFIG.MID_DECAY_FACTOR;
    } else {
      factor = CONFIG.LATE_FACTOR;
    }
    weightedSum += ans.score * factor;
    weightSum += factor;
  }

  return weightSum > 0 ? weightedSum / weightSum : 0;
}

export function buildUserVector(dimHistory, dims) {
  const vec = {};
  for (const d of dims) {
    vec[d] = computeDimScore(dimHistory, d);
  }
  return vec;
}

// ===== 方差计算 =====
function varianceOf(arr) {
  const n = arr.length;
  if (n === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
}

// ===== 欧氏距离 =====
function euclideanDistance(v1, v2, dims) {
  let sum = 0;
  for (const d of dims) {
    const diff = (v1[d] || 0) - (v2[d] || 0);
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// ===== 匹配度计算 =====
export function matchRate(distance) {
  const rate = ((MAX_DIM_DISTANCE - distance) / MAX_DIM_DISTANCE) * 100;
  return Math.max(Math.round(rate * 10) / 10, 35.0);
}

// ===== 判型 + 置信度 + Top3 =====
export function determineResult(userVector, personalities, dims) {
  const entries = Object.entries(personalities).map(([name, pVec]) => ({
    name,
    distance: euclideanDistance(userVector, pVec, dims),
    vector: pVec,
  }));

  entries.sort((a, b) => a.distance - b.distance);

  const top3 = entries.slice(0, 3);
  const winner = top3[0];
  const runnerUp = top3[1];

  let confidence = runnerUp.distance - winner.distance;
  // 防平局：若 confidence 精确为 0，加入极小噪声避免尴尬展示
  if (confidence === 0) {
    confidence = 1e-6;
  }

  let ambiguity;
  let presentation;
  if (confidence < CONFIG.HIGH_AMBIGUITY_THRESHOLD) {
    ambiguity = 'high';
    presentation = {
      type: 'dual',
      primary: top3[0].name,
      secondary: top3[1].name,
      message: `你的旅行人格在 ${top3[0].name} 和 ${top3[1].name} 之间摇摆`,
    };
  } else if (confidence < CONFIG.MEDIUM_AMBIGUITY_THRESHOLD) {
    ambiguity = 'medium';
    presentation = {
      type: 'primary_with_hint',
      primary: top3[0].name,
      hint: `你也带有 ${top3[1].name} 的特质`,
    };
  } else {
    ambiguity = 'low';
    presentation = {
      type: 'primary',
      primary: top3[0].name,
    };
  }

  return {
    winner: winner.name,
    winnerVector: winner.vector,
    top3: top3.map(e => ({
      name: e.name,
      distance: e.distance,
      similarity: matchRate(e.distance),
    })),
    confidence,
    ambiguity,
    userVector,
    presentation,
  };
}

// ===== 最佳搭子计算（基于空间距离，互补型） =====
export function findBuddy(winnerName, personalities, dims) {
  const winnerVec = personalities[winnerName];
  if (!winnerVec) return null;

  let bestBuddy = null;
  let maxDist = -1;
  for (const [name, vec] of Object.entries(personalities)) {
    if (name === winnerName) continue;
    const dist = euclideanDistance(winnerVec, vec, dims);
    if (dist > maxDist) {
      maxDist = dist;
      bestBuddy = name;
    }
  }
  return bestBuddy;
}

// ===== 终止条件 =====
export function shouldTerminate(state, result, dims) {
  const step = state.answeredIds.length;

  if (step >= CONFIG.MAX_QUESTIONS) {
    return { terminate: true, reason: 'max_questions' };
  }

  if (step < CONFIG.MIN_QUESTIONS) {
    return { terminate: false };
  }

  if (result.confidence > CONFIG.CONFIDENCE_THRESHOLD) {
    return { terminate: true, reason: 'confidence' };
  }

  let saturatedCount = 0;
  for (const d of dims) {
    const hist = state.dimHistory[d] || [];
    if (hist.length >= CONFIG.DIM_SATURATED_COUNT) {
      const scores = hist.map(h => h.score);
      const var_ = varianceOf(scores);
      if (var_ < CONFIG.DIM_SATURATED_VARIANCE) saturatedCount++;
    }
  }
  if (saturatedCount >= dims.length) {
    return { terminate: true, reason: 'dim_saturated' };
  }

  return { terminate: false };
}

// ===== 辅助：计算各维度不确定性 =====
function computeUncertainties(dimHistory, dims) {
  const uncertainties = {};
  for (const d of dims) {
    const hist = dimHistory[d] || [];
    const count = hist.length;
    const variance = count > 1
      ? varianceOf(hist.map(h => h.score))
      : 1.0;
    const meanAbs = count > 0
      ? hist.reduce((a, h) => a + Math.abs(h.score), 0) / count
      : 0;
    uncertainties[d] = (1 / (count + 1)) * (variance + CONFIG.UNCERTAINTY_BASE) * (1 - 0.25 * meanAbs);
  }
  return uncertainties;
}

// ===== 辅助：按不确定性排序维度 =====
function sortDimsByUncertainty(uncertainties, dims) {
  return dims.slice().sort((a, b) => uncertainties[b] - uncertainties[a]);
}

// ===== 辅助：找出 Top1 与 Top2 差异最大的维度 =====
function findMostDiscriminativeDim(top2, personalities, dims) {
  if (top2.length < 2) return null;
  const p1 = personalities[top2[0].name];
  const p2 = personalities[top2[1].name];
  if (!p1 || !p2) return null;

  let bestDim = null;
  let maxDiff = -1;
  for (const d of dims) {
    const diff = Math.abs((p1[d] || 0) - (p2[d] || 0));
    if (diff > maxDiff) {
      maxDiff = diff;
      bestDim = d;
    }
  }
  return bestDim;
}

// ===== 辅助：检查最近连续同维度次数 =====
function getConsecutiveDimCount(answeredIds, questions, targetDim) {
  let count = 0;
  for (let i = answeredIds.length - 1; i >= 0; i--) {
    const q = questions.find(q => q.id === answeredIds[i]);
    if (q && q.dim === targetDim) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// ===== 辅助：获取最近 N 题的 sceneTag =====
function getRecentScenes(answeredIds, questions, n) {
  const scenes = [];
  for (let i = Math.max(0, answeredIds.length - n); i < answeredIds.length; i++) {
    const q = questions.find(q => q.id === answeredIds[i]);
    if (q && q.sceneTag) scenes.push(q.sceneTag);
  }
  return scenes;
}

// ===== 辅助：layer 过滤 =====
function filterByLayer(pool, step) {
  if (step <= CONFIG.LAYER_CORE_MAX_STEP) {
    return pool.filter(q => q.layer === 'core');
  } else if (step <= CONFIG.LAYER_SELECT_MAX_STEP) {
    return pool.filter(q => q.layer === 'core' || q.layer === 'select');
  }
  return pool;
}

// ===== 辅助：反向验证优先 =====
function applyReverseCheckPriority(pool, dimHistory, targetDim) {
  const targetDimHist = dimHistory[targetDim] || [];
  if (targetDimHist.length >= CONFIG.REVERSE_TRIGGER_COUNT) {
    const recentScores = targetDimHist
      .slice(-CONFIG.REVERSE_TRIGGER_COUNT)
      .map(h => h.score);
    const allPositive = recentScores.every(s => s > 0);
    const allNegative = recentScores.every(s => s < 0);
    if ((allPositive || allNegative) && pool.some(q => q.reverseCheck)) {
      return pool.filter(q => q.reverseCheck);
    }
  }
  return pool;
}

// ===== 自适应选题：倾向驱动 + 随机 =====
export function selectNext(questions, dims, personalities, state, rng) {
  const { answeredIds, dimHistory, step } = state;
  const used = new Set(answeredIds);

  // === 步骤1：计算维度不确定性 ===
  const uncertainties = computeUncertainties(dimHistory, dims);
  const sortedDims = sortDimsByUncertainty(uncertainties, dims);

  // === 步骤2：强制覆盖检查（前6题每维至少1题） ===
  const underCovered = dims.filter(d => {
    const count = (dimHistory[d] || []).length;
    return step < CONFIG.COVERAGE_MAX_STEP && count < CONFIG.COVERAGE_MIN_COUNT;
  });

  // === 步骤3：计算当前 Top 人格并找出最需区分的维度 ===
  const currentVec = buildUserVector(dimHistory, dims);
  const currentResult = determineResult(currentVec, personalities, dims);
  const top2 = currentResult.top3.slice(0, 2);
  const discriminativeDim = findMostDiscriminativeDim(top2, personalities, dims);

  // === 步骤4：确定目标倾向维度 ===
  let targetDim;

  if (underCovered.length > 0) {
    // 优先覆盖未答维度
    targetDim = underCovered.sort(
      (a, b) => uncertainties[b] - uncertainties[a]
    )[0];
  } else {
    // 混合策略：前期偏重不确定性，后期偏重人格差异维度
    const uncertaintyWeight = step <= CONFIG.EXPLORE_MAX_STEP ? 0.7 : 0.3;
    const discrimWeight = 1 - uncertaintyWeight;

    // 给每个维度打分 = uncertaintyWeight * normUncertainty + discrimWeight * discrimScore
    const dimScores = {};
    const maxUncertainty = Math.max(...Object.values(uncertainties));
    for (const d of dims) {
      const uScore = maxUncertainty > 0 ? uncertainties[d] / maxUncertainty : 0;
      let dScore = 0;
      if (discriminativeDim === d) {
        // Top1/Top2 差异维度得分加成
        dScore = 1.0;
      }
      dimScores[d] = uncertaintyWeight * uScore + discrimWeight * dScore;
    }

    const scoredDims = dims.slice().sort((a, b) => dimScores[b] - dimScores[a]);
    targetDim = scoredDims[0];

    // 探索/利用平衡：有概率选次优维度（防早熟）
    if (step <= CONFIG.EXPLORE_MAX_STEP && rng() < CONFIG.EXPLORE_PROB && scoredDims.length > 1) {
      targetDim = scoredDims[1];
    }
  }

  // === 步骤5：硬限制——连续同维度不超过2题 ===
  const consecutiveCount = getConsecutiveDimCount(answeredIds, questions, targetDim);
  if (consecutiveCount >= CONFIG.MAX_CONSECUTIVE_SAME_DIM) {
    // 强制换维度，选不确定性次高的
    for (const d of sortedDims) {
      if (d !== targetDim) {
        targetDim = d;
        break;
      }
    }
  }

  // === 步骤6：构造候选池 ===
  function buildPool(dim) {
    let pool = questions.filter(q => q.dim === dim && !used.has(q.id));
    if (pool.length === 0) return [];

    // Layer 过滤
    pool = filterByLayer(pool, step);
    if (pool.length === 0) return [];

    // SceneTag 去重
    const recentScenes = getRecentScenes(answeredIds, questions, 2);
    const poolWithoutScene = pool.filter(q => !recentScenes.includes(q.sceneTag));
    if (poolWithoutScene.length > 0) {
      pool = poolWithoutScene;
    }

    // 反向验证优先
    pool = applyReverseCheckPriority(pool, dimHistory, dim);

    return pool;
  }

  let pool = buildPool(targetDim);

  // 如果目标维度无可用题，按不确定性降序尝试其他维度
  if (pool.length === 0) {
    for (const d of sortedDims) {
      if (d === targetDim) continue;
      pool = buildPool(d);
      if (pool.length > 0) {
        targetDim = d;
        break;
      }
    }
  }

  // === 步骤7：纯随机抽题 ===
  if (pool.length === 0) {
    return null;
  }

  return pool[Math.floor(rng() * pool.length)];
}

// ===== 应用答案 =====
export function applyAnswer(state, q, choiceIdx) {
  const chosen = q.opts[choiceIdx];
  if (!chosen) return;

  if (!state.dimHistory[q.dim]) {
    state.dimHistory[q.dim] = [];
  }
  state.dimHistory[q.dim].push({
    score: chosen.score,
    step: state.step + 1,
  });
  state.answeredIds.push(q.id);
  state.step++;
}

// ===== 撤销答案（用于返回上一题） =====
export function undoAnswer(state, q, choiceIdx, dims) {
  const chosen = q.opts[choiceIdx];
  if (!chosen) return;

  const hist = state.dimHistory[q.dim];
  if (!hist || hist.length === 0) return;

  // 移除最后一次该题的答题记录（按step匹配）
  const stepToRemove = state.step;
  const idx = hist.findIndex(h => h.step === stepToRemove);
  if (idx < 0) return; // 未找到，直接返回，不修改任何状态

  hist.splice(idx, 1);
  // 重新编排该维度后续记录的 step 序号
  for (let i = idx; i < hist.length; i++) {
    hist[i].step = hist[i].step - 1;
  }

  state.answeredIds.pop();
  state.step--;
  state.userVector = buildUserVector(state.dimHistory, dims);
}

// ===== 选项洗牌 =====
export function shuffleOptions(options, rng = Math.random) {
  const a = options.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

// ===== 维度解读生成 =====
export function generateDimInterpretation(userVector, dimLabels) {
  const interpretations = [];
  const dims = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
  for (const d of dims) {
    const score = userVector[d] || 0;
    const label = dimLabels[d];
    if (!label) continue;
    if (score >= 0.5) {
      interpretations.push(`你在${label.positive}方面表现非常明显`);
    } else if (score >= 0.2) {
      interpretations.push(`你偏向${label.positive}`);
    } else if (score <= -0.5) {
      interpretations.push(`你在${label.negative}方面表现非常明显`);
    } else if (score <= -0.2) {
      interpretations.push(`你偏向${label.negative}`);
    } else {
      interpretations.push(`你在该维度上比较均衡`);
    }
  }
  return interpretations;
}

// ===== 旧版兼容 =====
export function setRulePriority() {
  // v9 不再需要 rule priority
}

export function calcWinner() {
  // v9 不再使用，保留空函数避免旧引用报错
  return { winner: '', resolvedBy: 'legacy' };
}
