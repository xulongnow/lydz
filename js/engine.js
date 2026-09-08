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

// ===== 倾向驱动自适应选题（红方 A 方案） =====
// 核心变更：维度选择由 "Top 人格分歧度 + 不确定性" 驱动，
// 题内选择改为纯随机，保持探索/利用平衡。
export function selectNext(questions, dims, personalities, state, rng) {
  const { answeredIds, dimHistory, step } = state;
  const used = new Set(answeredIds);

  // === 探索机制：20% 概率全局随机抽题（防早熟）===
  if (rng() < CONFIG.RANDOM_PICK_PROB) {
    const allUnused = questions.filter(q => !used.has(q.id));
    if (allUnused.length > 0) {
      return _pickWithDiversity(allUnused, rng, answeredIds, questions, dimHistory);
    }
  }

  // === 步骤1：计算每个维度的不确定性（保留原有公式）===
  const uncertainties = {};
  for (const d of dims) {
    const hist = dimHistory[d] || [];
    const count = hist.length;
    const variance = count > 1 ? varianceOf(hist.map(h => h.score)) : 1.0;
    const meanAbs = count > 0 ? hist.reduce((a, h) => a + Math.abs(h.score), 0) / count : 0;
    uncertainties[d] = (1 / (count + 1)) * (variance + CONFIG.UNCERTAINTY_BASE) * (1 - 0.25 * meanAbs);
  }

  // === 步骤2：计算 Top 人格在各维度上的分歧度 ===
  const currentVec = buildUserVector(dimHistory, dims);
  const currentResult = determineResult(currentVec, personalities, dims);
  const topN = currentResult.top3.slice(0, 4); // 取 Top 4

  const disagreements = {};
  for (const d of dims) {
    const values = topN.map(p => personalities[p.name][d]).filter(v => v !== undefined);
    if (values.length >= 2) {
      disagreements[d] = varianceOf(values);
    } else {
      disagreements[d] = 0;
    }
  }

  // === 步骤2b：Top2 平局打破 ===
  // 如果当前 Top2 距离极其接近，放大这两个人格分歧最大的维度权重
  if (currentResult.top3.length >= 2) {
    const gap = currentResult.top3[1].distance - currentResult.top3[0].distance;
    if (gap < 0.05) {
      const top2Names = [currentResult.top3[0].name, currentResult.top3[1].name];
      let maxDiffDim = dims[0];
      let maxDiffVal = -1;
      for (const d of dims) {
        const v1 = personalities[top2Names[0]][d];
        const v2 = personalities[top2Names[1]][d];
        const diff = Math.abs(v1 - v2);
        if (diff > maxDiffVal) {
          maxDiffVal = diff;
          maxDiffDim = d;
        }
      }
      disagreements[maxDiffDim] = (disagreements[maxDiffDim] || 0) + 2.0;
    }
  }

  // === 步骤3：维度选择（倾向判断）===
  const coverages = {};
  for (const d of dims) coverages[d] = (dimHistory[d] || []).length;

  let dimScores = dims.map(d => {
    let score;
    if (step < 6 && coverages[d] < 1) {
      // 强制覆盖期：优先让每维至少出现 1 次
      score = 1000 - coverages[d] * 500;
    } else if (step < 10 && coverages[d] < 2) {
      // 补充覆盖期：每维至少 2 次
      score = 100 - coverages[d] * 30;
    } else {
      // 正常期：分歧度（区分 Top 人格）+ 不确定性（信息缺口）
      score = disagreements[d] * 0.6 + uncertainties[d] * 0.4;
    }
    return { dim: d, score };
  });

  // 硬限制：最近 2 题若均为同一维度，禁止再选该维度
  const lastTwo = answeredIds.slice(-2);
  const lastTwoDims = lastTwo.map(id => {
    const q = questions.find(q => q.id === id);
    return q ? q.dim : null;
  }).filter(Boolean);

  dimScores.sort((a, b) => b.score - a.score);

  let targetDim = dimScores[0].dim;
  if (lastTwoDims.length === 2 && lastTwoDims[0] === lastTwoDims[1] && lastTwoDims[0] === targetDim) {
    for (const ds of dimScores) {
      if (ds.dim !== targetDim) {
        targetDim = ds.dim;
        break;
      }
    }
  }

  // === 步骤4：从倾向维度构造候选池 ===
  let pool = questions.filter(q => q.dim === targetDim && !used.has(q.id));

  // 若倾向维度无题，回退到次优维度
  if (pool.length === 0) {
    for (const ds of dimScores) {
      if (ds.dim === targetDim) continue;
      pool = questions.filter(q => q.dim === ds.dim && !used.has(q.id));
      if (pool.length > 0) {
        targetDim = ds.dim;
        break;
      }
    }
  }

  // 若仍无题（题库耗尽），返回 null
  if (pool.length === 0) return null;

  return _pickWithDiversity(pool, rng, answeredIds, questions, dimHistory, targetDim);
}

// 内部辅助：在候选池中随机抽题，同时应用 sceneTag 去重和反向验证增强
function _pickWithDiversity(pool, rng, answeredIds, questions, dimHistory, targetDim = null) {
  // sceneTag 去重
  const recentScenes = [];
  for (let i = Math.max(0, answeredIds.length - CONFIG.RECENT_SCENE_EXCLUDE); i < answeredIds.length; i++) {
    const q = questions.find(q => q.id === answeredIds[i]);
    if (q && q.sceneTag) recentScenes.push(q.sceneTag);
  }
  const filteredPool = pool.filter(q => !recentScenes.includes(q.sceneTag));
  if (filteredPool.length > 0) {
    pool = filteredPool;
  }

  // 反向验证题优先（仅当明确指定了 targetDim 时）
  if (targetDim) {
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
  }

  // 纯随机抽题
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
