/**
 * CAT 自适应出题引擎 v10 — 合并版（红蓝定稿）
 * 纯函数集合，零 DOM 依赖
 * 基于六维向量 + 欧氏距离的判型算法
 * 可 Node.js 直接单元测试
 */

// ===== 配置参数 =====
const CONFIG = {
  // 阶段衰减
  EARLY_DECAY_END: 5,
  EARLY_DECAY_FACTOR: 0.6,
  MID_DECAY_END: 10,
  MID_DECAY_FACTOR: 0.8,
  LATE_FACTOR: 1.0,

  // 覆盖补充
  COVERAGE_MIN_COUNT: 1,
  COVERAGE_MAX_STEP: 6,
  COVERAGE_BOOST: 2.0,

  // 不确定性计算
  UNCERTAINTY_BASE: 0.5,

  // 反向验证触发
  REVERSE_TRIGGER_COUNT: 3,

  // 探索/利用平衡：step >= 6 后持续生效
  EXPLORATION_PROB: 0.15,
  EXPLORATION_MIN_STEP: 6,

  // 连续同维度限制（前6题豁免，第7题起生效）
  MAX_CONSECUTIVE_SAME_DIM: 2,
  CONSECUTIVE_LIMIT_START_STEP: 6,

  // Layer 阈值
  LAYER_CORE_MAX_STEP: 6,
  LAYER_SELECT_MAX_STEP: 12,

  // 终止条件
  MIN_QUESTIONS: 12,
  MAX_QUESTIONS: 24,
  CONFIDENCE_THRESHOLD: 0.22,
  DIM_SATURATED_COUNT: 3,
  DIM_SATURATED_VARIANCE: 0.5,

  // 模糊度阈值
  HIGH_AMBIGUITY_THRESHOLD: 0.22,
  MEDIUM_AMBIGUITY_THRESHOLD: 0.45,

  // 平局打破
  TIE_BREAK_THRESHOLD: 1e-6,
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

// ===== 种子化 RNG（mulberry32）=====
export function makeRng(seed) {
  let s = seed >>> 0;
  return function() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
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

// ===== 辅助：计算各维度区分度（Top2 人格在该维度的绝对差）=====
function computeDiscriminations(top2, personalities, dims) {
  const discriminations = {};
  for (const d of dims) {
    discriminations[d] = 0;
  }
  if (top2.length < 2) return discriminations;
  const p1 = personalities[top2[0].name];
  const p2 = personalities[top2[1].name];
  if (!p1 || !p2) return discriminations;
  for (const d of dims) {
    discriminations[d] = Math.abs((p1[d] || 0) - (p2[d] || 0));
  }
  return discriminations;
}

// ===== 辅助：计算各维度覆盖度加成 =====
function computeCoverageBoosts(dimHistory, dims, step) {
  const boosts = {};
  for (const d of dims) {
    const count = (dimHistory[d] || []).length;
    if (step < CONFIG.COVERAGE_MAX_STEP && count < CONFIG.COVERAGE_MIN_COUNT) {
      boosts[d] = CONFIG.COVERAGE_BOOST;
    } else {
      boosts[d] = 0;
    }
  }
  return boosts;
}

// ===== 辅助：need 公式 =====
// need(d) = 0.5 * uncertainty(d) + 0.35 * discrimination(d) + 0.15 * coverageBoost(d)
function computeNeeds(uncertainties, discriminations, coverageBoosts, dims) {
  const needs = {};
  for (const d of dims) {
    needs[d] = 0.5 * uncertainties[d] + 0.35 * discriminations[d] + 0.15 * coverageBoosts[d];
  }
  return needs;
}

// ===== 辅助：按 need 排序维度 =====
function sortDimsByNeed(needs, dims) {
  return dims.slice().sort((a, b) => needs[b] - needs[a]);
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
export function selectNext(questions, dims, personalities, state, rng, explorationMode = 'suboptimal-dim') {
  const { answeredIds, dimHistory, step } = state;
  const used = new Set(answeredIds);

  // === 步骤1：计算各维度 need ===
  const uncertainties = computeUncertainties(dimHistory, dims);
  const currentVec = buildUserVector(dimHistory, dims);
  const currentResult = determineResult(currentVec, personalities, dims);
  const top2 = currentResult.top3.slice(0, 2);
  const discriminations = computeDiscriminations(top2, personalities, dims);
  const coverageBoosts = computeCoverageBoosts(dimHistory, dims, step);
  const needs = computeNeeds(uncertainties, discriminations, coverageBoosts, dims);
  const sortedDims = sortDimsByNeed(needs, dims);

  // === 步骤2：确定目标倾向维度 ===
  let targetDim = sortedDims[0];

  // 平局打破：Top2 need 差 < 1e-6
  if (sortedDims.length >= 2) {
    const d1 = sortedDims[0];
    const d2 = sortedDims[1];
    if (Math.abs(needs[d1] - needs[d2]) < CONFIG.TIE_BREAK_THRESHOLD) {
      // 优先选连续出现次数更少的
      const c1 = getConsecutiveDimCount(answeredIds, questions, d1);
      const c2 = getConsecutiveDimCount(answeredIds, questions, d2);
      if (c2 < c1) {
        targetDim = d2;
      } else if (c1 === c2) {
        // 仍平则选总出现次数更少的
        const t1 = (dimHistory[d1] || []).length;
        const t2 = (dimHistory[d2] || []).length;
        if (t2 < t1) {
          targetDim = d2;
        }
      }
    }
  }

  // === 步骤3：探索策略（step >= 6 后持续生效）===
  if (step >= CONFIG.EXPLORATION_MIN_STEP && rng() < CONFIG.EXPLORATION_PROB && sortedDims.length > 1) {
    if (explorationMode === 'suboptimal-dim') {
      // 选不确定性次高的维度
      const uncertaintySorted = sortDimsByUncertainty(uncertainties, dims);
      targetDim = uncertaintySorted[1] || targetDim;
    } else if (explorationMode === 'epsilon-greedy') {
      // ε-贪心：从任意可用维度完全随机选
      const available = dims.filter(d => questions.some(q => q.dim === d && !used.has(q.id)));
      if (available.length > 0) {
        targetDim = available[Math.floor(rng() * available.length)];
      }
    }
  }

  // === 步骤4：硬限制——连续同维度不超过2题（第7题起生效）===
  if (step >= CONFIG.CONSECUTIVE_LIMIT_START_STEP) {
    const consecutiveCount = getConsecutiveDimCount(answeredIds, questions, targetDim);
    if (consecutiveCount >= CONFIG.MAX_CONSECUTIVE_SAME_DIM) {
      for (const d of sortedDims) {
        if (d !== targetDim) {
          targetDim = d;
          break;
        }
      }
    }
  }

  // === 步骤5：构造候选池 ===
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

  // 回退到次优维度
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

  // 全局回退：全部维度为空时，从全局未用题随机
  if (pool.length === 0) {
    const allUnused = questions.filter(q => !used.has(q.id));
    if (allUnused.length > 0) {
      pool = allUnused;
    }
  }

  // === 步骤6：纯随机抽题 ===
  if (pool.length === 0) {
    return null;
  }

  return pool[Math.floor(rng() * pool.length)];
}

// ===== 应用答案（支持 reverseScore 适配层）=====
export function applyAnswer(state, q, choiceIdx) {
  const chosen = q.opts[choiceIdx];
  if (!chosen) return;

  if (!state.dimHistory[q.dim]) {
    state.dimHistory[q.dim] = [];
  }

  // reverseCheck 仅用于选题策略（applyReverseCheckPriority）。
  // 数据层 score 已由生成脚本按选项语义正确编码（+1 始终对应维度正向），
  // 计分时无需翻转；原 reverseScore 字段名与数据不一致，已清理。
  const score = chosen.score;

  state.dimHistory[q.dim].push({
    score,
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
  if (!hist || hist.length === 0) return;

  // 移除最后一次该题的答题记录（按step匹配）
  const stepToRemove = state.step;
  const idx = hist.findIndex(h => h.step === stepToRemove);
  if (idx < 0) return;

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
  // v10 不再需要 rule priority
}

export function calcWinner() {
  // v10 不再使用，保留空函数避免旧引用报错
  return { winner: '', resolvedBy: 'legacy' };
}
