/**
 * 旅游搭子人格测试 — 倾向驱动随机选题引擎 v9
 * 纯函数集合，零 DOM 依赖，可 Node.js 直接单元测试
 *
 * 核心设计：维度级倾向驱动 + 候选池纯随机
 * - 每步根据当前六维得分判断"最需要探索的维度"
 * - 从该维度的未答题池中随机抽取 1 题
 * - 保留 sceneTag 去重、反向验证优先等防聚集机制
 */

// ===== 配置参数 =====
const CONFIG = {
  // 计分衰减
  EARLY_DECAY_END: 5,
  EARLY_DECAY_FACTOR: 0.6,
  MID_DECAY_END: 10,
  MID_DECAY_FACTOR: 0.8,
  LATE_FACTOR: 1.0,

  // 选题策略
  RECENT_SCENE_EXCLUDE: 2,   // 排除最近 N 题的 sceneTag
  REVERSE_TRIGGER_COUNT: 3,  // 连续 N 题同向触发反向验证
  MAX_CONSECUTIVE_SAME_DIM: 2, // 同维度最多连续出几题

  // 探索/利用平衡
  EXPLORATION_START_STEP: 6,   // 探索阶段起始步
  EXPLORATION_END_STEP: 11,    // 探索阶段结束步
  CROSS_DIM_PROBE_PROB: 0.2,   // 探索阶段跨维度随机概率

  // 终止条件
  MIN_QUESTIONS: 12,
  MAX_QUESTIONS: 24,
  CONFIDENCE_THRESHOLD: 0.22,

  // 模糊度分级
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

// ===== 维度得分计算（带阶段加权衰减） =====
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

  return { terminate: false };
}

// ===== 辅助：计算维度探索优先级 =====
// 优先级越高 = 该维度越需要被探索
// 因素1：答题次数少 → 高优先级（覆盖补充）
// 因素2：得分绝对值小（接近0，不确定）→ 高优先级
function computeDimPriority(dimHistory, dim) {
  const hist = dimHistory[dim] || [];
  const count = hist.length;
  if (count === 0) {
    // 完全未答过的维度优先级最高
    return 2.0;
  }
  const avg = hist.reduce((a, h) => a + h.score, 0) / count;
  // count 越少、|avg| 越接近 0，优先级越高
  return (1 / (count + 1)) * (1 - 0.5 * Math.abs(avg));
}

// ===== 辅助：获取最近 N 题的维度序列 =====
function getRecentDims(questions, answeredIds, n) {
  return answeredIds
    .slice(-n)
    .map(id => {
      const q = questions.find(q => q.id === id);
      return q ? q.dim : null;
    })
    .filter(Boolean);
}

// ===== 辅助：获取最近 N 题的 sceneTag =====
function getRecentScenes(questions, answeredIds, n) {
  const scenes = [];
  for (let i = Math.max(0, answeredIds.length - n); i < answeredIds.length; i++) {
    const q = questions.find(q => q.id === answeredIds[i]);
    if (q && q.sceneTag) scenes.push(q.sceneTag);
  }
  return scenes;
}

// ===== 倾向驱动随机选题 =====
export function selectNext(questions, dims, personalities, state, rng) {
  const { answeredIds, dimHistory, step } = state;
  const used = new Set(answeredIds);

  // === 步骤1：计算每个维度的探索优先级 ===
  const priorities = {};
  for (const d of dims) {
    priorities[d] = computeDimPriority(dimHistory, d);
  }

  // === 步骤2：按优先级排序维度 ===
  const sortedDims = dims.slice().sort((a, b) => priorities[b] - priorities[a]);

  // === 步骤3：确定目标维度 ===
  let targetDim = sortedDims[0];

  // 防聚集：若最近 N 题均为同一维度，强制换维度
  const lastNDims = getRecentDims(questions, answeredIds, CONFIG.MAX_CONSECUTIVE_SAME_DIM);
  if (
    lastNDims.length === CONFIG.MAX_CONSECUTIVE_SAME_DIM &&
    lastNDims.every(d => d === targetDim)
  ) {
    const alt = sortedDims.find(d => d !== targetDim);
    if (alt) targetDim = alt;
  }

  // === 步骤4：构建目标维度的候选池 ===
  let pool = questions.filter(q => q.dim === targetDim && !used.has(q.id));

  // === 步骤5：若目标维度无题，回退到次优维度 ===
  if (pool.length === 0) {
    for (const d of sortedDims) {
      if (d === targetDim) continue;
      pool = questions.filter(q => q.dim === d && !used.has(q.id));
      if (pool.length > 0) {
        targetDim = d;
        break;
      }
    }
  }

  // === 步骤6：sceneTag 去重 ===
  const recentScenes = getRecentScenes(questions, answeredIds, CONFIG.RECENT_SCENE_EXCLUDE);
  const filteredPool = pool.filter(q => !recentScenes.includes(q.sceneTag));
  if (filteredPool.length > 0) {
    pool = filteredPool;
  }

  // === 步骤7：反向验证题优先 ===
  const targetDimHist = dimHistory[targetDim] || [];
  if (targetDimHist.length >= CONFIG.REVERSE_TRIGGER_COUNT) {
    const recentScores = targetDimHist
      .slice(-CONFIG.REVERSE_TRIGGER_COUNT)
      .map(h => h.score);
    const allPositive = recentScores.every(s => s > 0);
    const allNegative = recentScores.every(s => s < 0);
    if (allPositive || allNegative) {
      const reversePool = pool.filter(q => q.reverseCheck);
      if (reversePool.length > 0) pool = reversePool;
    }
  }

  // === 步骤8：纯随机抽题 ===
  if (pool.length > 0) {
    // 探索阶段：一定概率从其他维度随机抽题，防止过早锁定单一倾向
    if (
      step >= CONFIG.EXPLORATION_START_STEP &&
      step <= CONFIG.EXPLORATION_END_STEP &&
      rng() < CONFIG.CROSS_DIM_PROBE_PROB
    ) {
      const otherPool = questions.filter(q => {
        if (q.dim === targetDim) return false;
        if (used.has(q.id)) return false;
        return !recentScenes.includes(q.sceneTag);
      });
      if (otherPool.length > 0) {
        return otherPool[Math.floor(rng() * otherPool.length)];
      }
    }

    return pool[Math.floor(rng() * pool.length)];
  }

  // === 终极回退：全局随机未答题 ===
  const allRemaining = questions.filter(q => !used.has(q.id));
  if (allRemaining.length === 0) return null;
  return allRemaining[Math.floor(rng() * allRemaining.length)];
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
  if (!hist || hist.length === 0) return; // 保护：无历史直接返回

  // 移除最后一次该题的答题记录（按 step 匹配）
  const stepToRemove = state.step;
  const idx = hist.findIndex(h => h.step === stepToRemove);
  if (idx < 0) return; // 修复P0：找不到记录时直接返回，不修改任何状态

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
