/**
 * CAT 自适应出题引擎 v8 — 纯函数集合，零 DOM 依赖
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
  COVERAGE_MIN_COUNT: 1,
  COVERAGE_MAX_STEP: 6,
  UNCERTAINTY_BASE: 0.5,
  REVERSE_TRIGGER_COUNT: 3,
  INFO_GAIN_CUTOFF: 0.8,
  RANDOM_PICK_PROB: 0.2,
  TOP_CANDIDATES: 3,
  RECENT_SCENE_EXCLUDE: 2,
  MIN_QUESTIONS: 12,
  MAX_QUESTIONS: 24,
  CONFIDENCE_THRESHOLD: 0.22,
  DIM_SATURATED_COUNT: 4,
  DIM_SATURATED_VARIANCE: 0.5,
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

// ===== 新增：计算对两个候选人格的期望得分差异区分度 =====
function expectedScoreDiscrimination(scores, pA, pB, temp = 0.5) {
  const softmax = (vals) => {
    const exps = vals.map(v => Math.exp(v / temp));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sum);
  };

  const weightedA = scores.map(s => s * pA);
  const probsA = softmax(weightedA);
  const expA = probsA.reduce((sum, p, i) => sum + p * scores[i], 0);

  const weightedB = scores.map(s => s * pB);
  const probsB = softmax(weightedB);
  const expB = probsB.reduce((sum, p, i) => sum + p * scores[i], 0);

  return Math.abs(expA - expB);
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

  const confidence = runnerUp.distance - winner.distance;

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

// ===== 自适应选题 =====
export function selectNext(questions, dims, personalities, state, rng) {
  const { answeredIds, dimHistory, step } = state;
  const used = new Set(answeredIds);

  // 步骤1：计算每个维度的不确定性
  const uncertainties = {};
  for (const d of dims) {
    const hist = dimHistory[d] || [];
    const count = hist.length;
    const variance = count > 1
      ? varianceOf(hist.map(h => h.score))
      : 1.0;
    // 答案越极端（|score|大），该维度不确定性越低
    const meanAbs = count > 0
      ? hist.reduce((a, h) => a + Math.abs(h.score), 0) / count
      : 0;
    uncertainties[d] = (1 / (count + 1)) * (variance + CONFIG.UNCERTAINTY_BASE) * (1 - 0.25 * meanAbs);
  }

  // 步骤2：覆盖补充检查
  const underCovered = dims.filter(d => {
    const count = (dimHistory[d] || []).length;
    return step < CONFIG.COVERAGE_MAX_STEP && count < CONFIG.COVERAGE_MIN_COUNT;
  });

  let targetDim;
  if (underCovered.length > 0) {
    targetDim = underCovered.sort(
      (a, b) => uncertainties[b] - uncertainties[a]
    )[0];
  } else {
    targetDim = dims.slice().sort(
      (a, b) => uncertainties[b] - uncertainties[a]
    )[0];
  }

  // 硬限制：如果最近2题都是同一维度，禁止再选该维度
  const lastTwo = answeredIds.slice(-2);
  const lastTwoDims = lastTwo.map(id => {
    const q = questions.find(q => q.id === id);
    return q ? q.dim : null;
  }).filter(Boolean);
  if (lastTwoDims.length === 2 && lastTwoDims[0] === lastTwoDims[1] && lastTwoDims[0] === targetDim) {
    const sortedDims = dims.slice().sort((a, b) => uncertainties[b] - uncertainties[a]);
    for (const d of sortedDims) {
      if (d !== targetDim) {
        targetDim = d;
        break;
      }
    }
  }

  // 步骤3：同维度内选区分力最强的题
  let pool = questions.filter(q =>
    q.dim === targetDim && !used.has(q.id)
  );

  if (pool.length === 0) {
    const sortedDims = dims.slice().sort(
      (a, b) => uncertainties[b] - uncertainties[a]
    );
    for (const d of sortedDims) {
      pool = questions.filter(q => q.dim === d && !used.has(q.id));
      if (pool.length > 0) break;
    }
  }

  // === 改造：混合信息增益（方差 + Top2 区分度）===
  const currentVec = buildUserVector(dimHistory, dims);
  const currentResult = determineResult(currentVec, personalities, dims);
  const top2 = currentResult.top3.slice(0, 2);

  const ALPHA = 0.4;
  const BETA = 0.6;

  pool = pool.map(q => {
    const scores = q.opts.map(o => o.score);
    const varGain = varianceOf(scores);

    let discGain = 0;
    if (top2.length >= 2) {
      const pA = personalities[top2[0].name][q.dim];
      const pB = personalities[top2[1].name][q.dim];
      discGain = expectedScoreDiscrimination(scores, pA, pB);
    }

    const normVar = varGain / 0.625;
    const normDisc = discGain / 1.3;
    const infoGain = ALPHA * normVar + BETA * normDisc;

    return { ...q, infoGain, varGain, discGain };
  });
  pool.sort((a, b) => b.infoGain - a.infoGain);

  // 步骤4：防重复检查（sceneTag）
  const recentScenes = [];
  for (let i = Math.max(0, answeredIds.length - CONFIG.RECENT_SCENE_EXCLUDE); i < answeredIds.length; i++) {
    const q = questions.find(q => q.id === answeredIds[i]);
    if (q && q.sceneTag) recentScenes.push(q.sceneTag);
  }
  const filteredPool = pool.filter(q => !recentScenes.includes(q.sceneTag));
  if (filteredPool.length > 0) {
    pool = filteredPool;
  }

  // 步骤5：反向验证题优先
  const targetDimHist = dimHistory[targetDim] || [];
  if (targetDimHist.length >= CONFIG.REVERSE_TRIGGER_COUNT) {
    const recentScores = targetDimHist.slice(-CONFIG.REVERSE_TRIGGER_COUNT).map(h => h.score);
    const allPositive = recentScores.every(s => s > 0);
    const allNegative = recentScores.every(s => s < 0);
    if (allPositive || allNegative) {
      const reversePool = pool.filter(q => q.reverseCheck);
      if (reversePool.length > 0) pool = reversePool;
    }
  }

  // 步骤6：随机扰动
  const cutoff = Math.ceil(pool.length * CONFIG.INFO_GAIN_CUTOFF);
  const ordered = pool.slice(0, cutoff);
  const random = pool.slice(cutoff);

  if (random.length > 0 && rng() < CONFIG.RANDOM_PICK_PROB) {
    return random[Math.floor(rng() * random.length)];
  }
  const candidates = ordered.length > 0 ? ordered : random;
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * Math.min(candidates.length, CONFIG.TOP_CANDIDATES))];
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

// 获取 dims 列表的辅助函数
function getDims(data) {
  return data.dims || ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
}

// ===== 撤销答案（用于返回上一题） =====
export function undoAnswer(state, q, choiceIdx, dims) {
  const chosen = q.opts[choiceIdx];
  if (!chosen) return;

  const hist = state.dimHistory[q.dim];
  if (hist && hist.length > 0) {
    // 移除最后一次该题的答题记录（按step匹配）
    const stepToRemove = state.step;
    const idx = hist.findIndex(h => h.step === stepToRemove);
    if (idx >= 0) {
      hist.splice(idx, 1);
      // === 新增：重新编排该维度后续记录的 step 序号 ===
      for (let i = idx; i < hist.length; i++) {
        hist[i].step = hist[i].step - 1;
      }
      // === 新增结束 ===
    }
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
  // v8 不再需要 rule priority
}

export function calcWinner() {
  // v8 不再使用，保留空函数避免旧引用报错
  return { winner: '', resolvedBy: 'legacy' };
}
