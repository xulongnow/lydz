# P1 修复说明文档

## 合并实现分支
`refactor/merged-tendency` 基于最终定稿版方案，从 `main` 切出。

---

## P1-1：handleBack fallback 重复 pop history

**位置**：`js/app.js` — `handleBack()` fallback 分支

**问题**：fallback 分支中 `state.history.pop()` 被调用了两次，导致 history 被过度削减。

**修复前**：
```javascript
} else {
  const hist = state.dimHistory[lastQ.dim];
  if (hist && hist.length > 0) hist.pop();
  state.answeredIds.pop();
  state.step--;
  state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
  if (state.history) state.history.pop(); // 第一次
  state.currentQ = lastQ;
  state.shuffledOpts = engine.shuffleOptions(lastQ.opts);
  // 修复：fallback 也需要同步 history
  if (state.history && state.history.length > 0) {
    state.history.pop(); // 第二次（bug！）
  }
}
```

**修复后**：
```javascript
} else {
  const hist = state.dimHistory[lastQ.dim];
  if (hist && hist.length > 0) hist.pop();
  state.answeredIds.pop();
  state.step--;
  state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
  if (state.history) state.history.pop(); // 只 pop 一次
  state.currentQ = lastQ;
  state.shuffledOpts = engine.shuffleOptions(lastQ.opts);
}
```

**验证**：回归测试通过，handleBack 后 history 长度正确减 1。

---

## P1-2：replay 未同步 userVector

**位置**：`js/app.js` — `replay()`

**问题**：分享链接回放时，循环内每次 `applyAnswer` 后未更新 `state.userVector`，导致回放结束时 userVector 与实际答题过程不一致。

**修复前**：
```javascript
engine.applyAnswer(state, q, origIdx);
state.history.push({...});
```

**修复后**：
```javascript
engine.applyAnswer(state, q, origIdx);
state.userVector = engine.buildUserVector(state.dimHistory, data.dims); // 同步 userVector
state.history.push({...});
```

**验证**：回归测试通过，回放结果与实际答题一致。

---

## P1-3：priority/need 公式统一

**位置**：`js/engine.js` — `selectNext()` 及新增辅助函数

**问题**：蓝方 v9 实现中维度评分公式为 `uncertaintyWeight * normUncertainty + discrimWeight * discrimScore`，与定稿方案 `need(d) = 0.5*uncertainty + 0.35*discrimination + 0.15*coverageBoost` 不一致。

**修复**：重写 `selectNext()`，引入统一的 need 公式体系：

新增函数：
- `computeDiscriminations(top2, personalities, dims)` — 计算 Top2 人格在各维度的绝对差
- `computeCoverageBoosts(dimHistory, dims, step)` — 计算覆盖度加成（step<6 且未答过 = 2.0）
- `computeNeeds(uncertainties, discriminations, coverageBoosts, dims)` — need 公式
- `sortDimsByNeed(needs, dims)` — 按 need 排序

```javascript
// need(d) = 0.5 * uncertainty(d) + 0.35 * discrimination(d) + 0.15 * coverageBoost(d)
function computeNeeds(uncertainties, discriminations, coverageBoosts, dims) {
  const needs = {};
  for (const d of dims) {
    needs[d] = 0.5 * uncertainties[d] + 0.35 * discriminations[d] + 0.15 * coverageBoosts[d];
  }
  return needs;
}
```

**验证**：代码审查通过，公式与定稿报告第 9.4 节参数表一致。

---

## P1-4：探索窗口范围统一

**位置**：`js/engine.js` — `CONFIG.EXPLORATION_MIN_STEP` / `selectNext()`

**问题**：蓝方 v9 实现中探索条件为 `step <= CONFIG.EXPLORE_MAX_STEP(8)`，即有上限；定稿方案要求 `step >= 6` 后**持续生效**。

**修复**：
- 移除 `EXPLORE_MAX_STEP`
- 新增 `EXPLORATION_MIN_STEP: 6`
- 探索条件改为 `step >= CONFIG.EXPLORATION_MIN_STEP`

```javascript
if (step >= CONFIG.EXPLORATION_MIN_STEP && rng() < CONFIG.EXPLORATION_PROB && sortedDims.length > 1) {
  // 探索逻辑...
}
```

**验证**：回归测试通过，第 6 题后持续有探索行为。

---

## P1-5：Top2 平局打破

**位置**：`js/engine.js` — `selectNext()`

**问题**：红方实现声明有「Top2平局打破」但代码中无独立逻辑。

**修复**：在 `selectNext()` 中加入平局打破逻辑：

```javascript
// 平局打破：Top2 need 差 < 1e-6
if (sortedDims.length >= 2) {
  const d1 = sortedDims[0];
  const d2 = sortedDims[1];
  if (Math.abs(needs[d1] - needs[d2]) < CONFIG.TIE_BREAK_THRESHOLD) {
    const c1 = getConsecutiveDimCount(answeredIds, questions, d1);
    const c2 = getConsecutiveDimCount(answeredIds, questions, d2);
    if (c2 < c1) {
      targetDim = d2;
    } else if (c1 === c2) {
      const t1 = (dimHistory[d1] || []).length;
      const t2 = (dimHistory[d2] || []).length;
      if (t2 < t1) {
        targetDim = d2;
      }
    }
  }
}
```

优先级：连续出现次数更少 → 总出现次数更少。

**验证**：50 组 seeded 测试通过，平局切换均匀。

---

## P1-6：RNG 种子化

**位置**：`js/engine.js`（新增 `makeRng`） / `tests/validate-engine.js`

**问题**：原 validate-engine.js 使用 `Math.random`，测试结果不可复现。

**修复**：
1. engine.js 新增 `makeRng(seed)` 工厂函数（mulberry32 算法）：
```javascript
export function makeRng(seed) {
  let s = seed >>> 0;
  return function() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
```

2. validate-engine.js 中所有 `Math.random` 替换为 `engine.makeRng(seed)`，测试入口统一设 `seed=42`：
```javascript
const SEED = 42;
const rng = engine.makeRng(SEED + seedOffset);
const optRng = engine.makeRng(SEED + seedOffset + 100000);
```

3. app.js 中浏览器端继续使用 `Math.random`（无需种子化，不影响测试复现性）。

**验证**：同一种子跑 3 次，winner/steps/sequence 逐字节一致。

---

## P1-7：反向题预留 reverseScore 适配层

**位置**：`js/engine.js` — `applyAnswer()`

**问题**：30 道反向题 `reverseCheck` 标记存在但 score 未翻转，需引擎层预留适配层。

**修复**：在 `applyAnswer()` 中加入 `reverseScore` 适配逻辑：

```javascript
export function applyAnswer(state, q, choiceIdx) {
  const chosen = q.opts[choiceIdx];
  if (!chosen) return;

  if (!state.dimHistory[q.dim]) {
    state.dimHistory[q.dim] = [];
  }

  // 预留 reverseScore 适配层（P1-7）
  let score = chosen.score;
  if (q.reverseScore && typeof score === 'number') {
    score = -score;
  }

  state.dimHistory[q.dim].push({
    score,
    step: state.step + 1,
  });
  state.answeredIds.push(q.id);
  state.step++;
}
```

当前 `quiz-data.json` 中 `reverseScore` 字段不存在，适配层为预留扩展点。待数据层修复后无缝启用。

**验证**：数据校验通过，现有数据无 `reverseScore` 字段时不影响行为。

---

## 额外修改

### 蓝方改进保留
- 数据加载 try-catch 兜底（app.js）
- progress 动态计算（app.js）
- confidence === 0 时 1e-6 兜底（engine.js）
- keyboard 导航健壮性（app.js）

### 新增参数（CONFIG）
| 参数 | 值 | 说明 |
|---|---|---|
| COVERAGE_BOOST | 2.0 | 前6题未答维度加成 |
| EXPLORATION_MIN_STEP | 6 | 探索触发最小题数 |
| CONSECUTIVE_LIMIT_START_STEP | 6 | 连续同维限制生效题数 |
| TIE_BREAK_THRESHOLD | 1e-6 | 平局判定阈值 |

### explorationMode 可配置开关
`selectNext()` 新增第 6 个参数 `explorationMode`（默认 `'suboptimal-dim'`）：
- `'suboptimal-dim'`：选不确定性次高维度（蓝方策略，默认）
- `'epsilon-greedy'`：从任意可用维度完全随机（红方策略，预留）
