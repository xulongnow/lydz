/**
 * CAT 自适应出题引擎 v9 — 倾向驱动 + 随机选题（红方 A）
 * 纯函数集合，零 DOM 依赖，可 Node.js 直接单元测试
 *
 * 核心变更（相对 v8）：
 * 1. 选题逻辑改为「倾向驱动 + 随机」——每次根据当前累积状态判断下一题应出现的维度倾向，
 *    从该维度候选题池中随机抽取 1 题展示。
 * 2. 保留六维向量 + 欧氏距离判型、48 人格体系、加权衰减计分、终止条件不变。
 * 3. 增加 layer 字段实际使用（core/select/explore 分层递进）。
 * 4. 增加探索机制（ε-贪心），防止前几题过早锁死单一倾向。
 * 5. 修复 undoAnswer 安全检查与 handleBack fallback history 同步（P0）。
 */

// ===== 配置参数 =====
const CONFIG = {
  // 计分权重衰减
  EARLY_DECAY_END: 5,
  EARLY_DECAY_FACTOR: 0.6,
  MID_DECAY_END: 10,
  MID_DECAY_FACTOR: 0.8,
  LATE_FACTOR: 1.0,

  // 覆盖补充：前 N 题内，未答过的维度优先
  COVERAGE_MAX_STEP: 6,
  COVERAGE_MIN_COUNT: 1,

  // 探索概率（ε-贪心）：从非目标维度随机抽题的概率
  EXPLORATION_PROB: 0.15,

  // 维度连续上限：同一维度最多连续出现几次
  MAX_CONSECUTIVE_DIM: 3,

  // sceneTag 去重窗口
  RECENT_SCENE_EXCLUDE: 2,

  // 反向验证触发条件
  REVERSE_TRIGGER_COUNT: 3,

  // layer 递进阈值
  LAYER_PROGRESSION: [
    { stepEnd: 8, preferred: ['core'] },
    { stepEnd: 16, preferred: ['core', 'select'] },
    { stepEnd: Infinity, preferred: ['core', 'select', 'explore'] },
  ],

  // 终止条件
  MIN_QUESTIONS: 12,
  MAX_QUESTIONS: 24,
  CONFIDENCE_THRESHOLD: 0.22,
  DIM_SATURATED_COUNT: 4,
  DIM_SATURATED_VARIANCE: 0.5,

  // 模糊度阈值
  HIGH_AMBIGUITY_THRESHOLD: 0.22,
  MEDIUM_AMBIGUITY_THRESHOLD: 0.45,

  // 需求度计算权重
  NEED_UNCERTAINTY_WEIGHT: 0.5,
  NEED_DISCRIMINATION_WEIGHT: 0.35,
  NEED_COVERAGE_WEIGHT: 0.15,
};

const MAX_DIM_DISTANCE = Math.sqrt(6 * 4); // 6维，每维最大差 2（从-1到+1）

// ===== 按维度预分组缓存（减少全量扫描）=====
let _dimQuestionCache = null;
let _cacheDataVersion = null;

function buildDimQuestionMap(questions, dims) {
  const map = {};
  for (const d of dims) map[d] = [];
  for (const q of questions) {
    if (map[q.dim]) map[q.dim].push(q);
  }
  return map;
}

function getDimQuestionMap(questions, dims, dataVersion) {
  if (_dimQuestionCache && _cacheDataVersion === dataVersion) {
    return _dimQuestionCache;
  }
  _dimQuestionCache = buildDimQuestionMap(questions, dims);
  _cacheDataVersion = dataVersion;
  return _dimQuestionCache;
}

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

  // dim_saturated: 仅作为辅助判断，降低触发门槛使其真正可达
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

// ===== 需求度计算：确定下一题的维度倾向 =====
function computeDimNeeds(state, dims, personalities) {
  const { answeredIds, dimHistory, step } = state;
  const needs = {};

  // 基于当前向量判型，获取 Top2 人格
  const currentVec = buildUserVector(dimHistory, dims);
  const currentResult = determineResult(currentVec, personalities, dims);
  const top2 = currentResult.top3.slice(0, 2);

  for (const d of dims) {
    const hist = dimHistory[d] || [];
    const count = hist.length;
    const meanScore = count > 0
      ? hist.reduce((a, h) => a + h.score, 0) / count
      : 0;

    // 1. 不确定性：答题越少、得分越接近 0，不确定性越高
    const uncertainty = (1 / (count + 1)) * (1 - Math.abs(meanScore) * 0.5);

    // 2. 区分度：Top2 人格在该维度上的差异
    let discrimination = 0;
    if (top2.length >= 2) {
      const pA = personalities[top2[0].name][d];
      const pB = personalities[top2[1].name][d];
      discrimination = Math.abs(pA - pB);
    }

    // 3. 覆盖补充：前 COVERAGE_MAX_STEP 题内，未答过的维度获得显著 boost
    let coverageBoost = 0;
    if (step < CONFIG.COVERAGE_MAX_STEP && count < CONFIG.COVERAGE_MIN_COUNT) {
      coverageBoost = 2.0; // 大 boost 确保前 N 题覆盖全部维度
    }

    needs[d] =
      CONFIG.NEED_UNCERTAINTY_WEIGHT * uncertainty +
      CONFIG.NEED_DISCRIMINATION_WEIGHT * discrimination +
      CONFIG.NEED_COVERAGE_WEIGHT * coverageBoost;
  }

  return needs;
}

// ===== 获取当前适用的 layer 偏好 =====
function getPreferredLayers(step) {
  for (const rule of CONFIG.LAYER_PROGRESSION) {
    if (step < rule.stepEnd) return rule.preferred;
  }
  return CONFIG.LAYER_PROGRESSION[CONFIG.LAYER_PROGRESSION.length - 1].preferred;
}

// ===== 检查维度连续次数 =====
function getConsecutiveDimCount(answeredIds, dimMap, targetDim) {
  let count = 0;
  for (let i = answeredIds.length - 1; i >= 0; i--) {
    const q = dimMap[answeredIds[i]];
    if (q && q.dim === targetDim) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// ===== 自适应选题（v9 倾向驱动 + 随机） =====
export function selectNext(questions, dims, personalities, state, rng) {
  const { answeredIds, dimHistory, step } = state;
  const used = new Set(answeredIds);

  // 获取维度预分组缓存
  const dimMap = {};
  for (const q of questions) {
    dimMap[q.id] = q;
  }
  const dimQuestionMap = getDimQuestionMap(questions, dims, questions.length);

  // === 步骤 1：计算每个维度的需求度 ===
  const needs = computeDimNeeds(state, dims, personalities);

  // 按需求度排序
  const sortedDims = dims.slice().sort((a, b) => needs[b] - needs[a]);

  // === 步骤 2：检查维度连续上限 ===
  let targetDim = sortedDims[0];
  const consecutiveCount = getConsecutiveDimCount(answeredIds, dimMap, targetDim);
  if (consecutiveCount >= CONFIG.MAX_CONSECUTIVE_DIM) {
    // 强制切换到次高需求度维度
    for (let i = 1; i < sortedDims.length; i++) {
      const altDim = sortedDims[i];
      if (getConsecutiveDimCount(answeredIds, dimMap, altDim) < CONFIG.MAX_CONSECUTIVE_DIM) {
        targetDim = altDim;
        break;
      }
    }
  }

  // === 步骤 3：探索机制（ε-贪心）===
  // 以 EXPLORATION_PROB 概率从任意维度随机探索
  let isExploration = false;
  if (rng() < CONFIG.EXPLORATION_PROB && step >= CONFIG.COVERAGE_MAX_STEP) {
    const availableDims = sortedDims.filter(d => {
      const pool = dimQuestionMap[d].filter(q => !used.has(q.id));
      return pool.length > 0;
    });
    if (availableDims.length > 0) {
      targetDim = availableDims[Math.floor(rng() * availableDims.length)];
      isExploration = true;
    }
  }

  // === 步骤 4：构建候选池 ===
  function buildPool(dim) {
    let pool = dimQuestionMap[dim].filter(q => !used.has(q.id));

    // 4a: sceneTag 去重
    const recentScenes = [];
    for (let i = Math.max(0, answeredIds.length - CONFIG.RECENT_SCENE_EXCLUDE); i < answeredIds.length; i++) {
      const q = dimMap[answeredIds[i]];
      if (q && q.sceneTag) recentScenes.push(q.sceneTag);
    }
    const filteredByScene = pool.filter(q => !recentScenes.includes(q.sceneTag));
    if (filteredByScene.length > 0) {
      pool = filteredByScene;
    }

    // 4b: layer 过滤（非探索模式下启用）
    if (!isExploration) {
      const preferredLayers = getPreferredLayers(step);
      const filteredByLayer = pool.filter(q => preferredLayers.includes(q.layer));
      if (filteredByLayer.length > 0) {
        pool = filteredByLayer;
      }
    }

    // 4c: 反向验证题优先（连续 3 题同向时）
    const dimHist = dimHistory[dim] || [];
    if (dimHist.length >= CONFIG.REVERSE_TRIGGER_COUNT) {
      const recentScores = dimHist.slice(-CONFIG.REVERSE_TRIGGER_COUNT).map(h => h.score);
      const allPositive = recentScores.every(s => s > 0);
      const allNegative = recentScores.every(s => s < 0);
      if (allPositive || allNegative) {
        const reversePool = pool.filter(q => q.reverseCheck);
        if (reversePool.length > 0) pool = reversePool;
      }
    }

    return pool;
  }

  let pool = buildPool(targetDim);

  // === 步骤 5：如果目标维度无题，依次尝试其他维度 ===
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

  // === 步骤 6：彻底无题时，从全局未答题中随机 ===
  if (pool.length === 0) {
    const allUnused = questions.filter(q => !used.has(q.id));
    if (allUnused.length > 0) {
      return allUnused[Math.floor(rng() * allUnused.length)];
    }
    return null;
  }

  // === 步骤 7：从候选池中随机抽 1 题 ===
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

// ===== 撤销答案（用于返回上一题）=====
export function undoAnswer(state, q, choiceIdx, dims) {
  const chosen = q.opts[choiceIdx];
  if (!chosen) return;

  const hist = state.dimHistory[q.dim];
  if (hist && hist.length > 0) {
    // 移除最后一次该题的答题记录（按 step 匹配）
    const stepToRemove = state.step;
    const idx = hist.findIndex(h => h.step === stepToRemove);
    if (idx >= 0) {
      hist.splice(idx, 1);
      // 重新编排该维度后续记录的 step 序号
      for (let i = idx; i < hist.length; i++) {
        hist[i].step = hist[i].step - 1;
      }
    }
    // 如果 findIndex 失败（idx < 0），不修改 hist，避免状态不一致
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
