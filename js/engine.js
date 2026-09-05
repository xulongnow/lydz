/**
 * CAT 自适应出题引擎 — 纯函数集合，零 DOM 依赖
 * 可 Node.js 直接单元测试
 */

// 规则集（48 类型全覆盖）
const RULE_SETS = [
  ["路痴本痴","领航员","出门困难户","倒霉蛋"],
  ["出片者","打卡狂魔","纪录片导演"],
  ["纪录片导演","讲解器转世","资深剧评人"],
  ["美食雷达","路边摊冒险家","中餐续命者"],
  ["中餐续命者","外卖鉴赏家","思乡者"],
  ["躺平仙人","罗马觉皇","思乡者","时差冤魂"],
  ["夜生活之王","时差冤魂","特种兵王"],
  ["精算师","AA活算盘","人型汇率计算器","现金乞丐"],
  ["社牛天花板","全村的希望","甜蜜连麦者"],
  ["赛博浪人","Wi-Fi搜寻者","手机焊脸上"],
  ["多啦A梦","失物招领者","补水狂魔"],
  ["思乡者","中餐续命者","婴幼儿"],
  ["公司顶梁柱","手机焊脸上","防盗战神"],
  ["公路之王","领航员","特种兵王","行走的攻略"],
  ["文化震惊体","肢体语言大师","假装听懂的人","讲解器转世"],
  ["购物狂魔","抽象艺术家","吟游诗人"],
  ["临时起意派","鸽子成精"],
  ["修行者","猫门信徒"],
  ["行走的攻略","避雷针"],
  ["避雷针","倒霉蛋","防盗战神"],
];

const RS_SETS = RULE_SETS.map((a) => {
  const s = {};
  for (let i = 0; i < a.length; i++) s[a[i]] = 1;
  return s;
});

let RULE_PRIORITY = {};

export function setRulePriority(questions, types) {
  const cov = {};
  for (let i = 0; i < types.length; i++) cov[types[i]] = 0;
  for (let q = 0; q < questions.length; q++) {
    const opts = questions[q].opts;
    for (let o = 0; o < opts.length; o++) {
      const w = opts[o].weights;
      for (let k = 0; k < w.length; k++) {
        cov[w[k][0]] += w[k][1];
      }
    }
  }
  const ranked = types.slice().sort((a, b) => cov[a] - cov[b]);
  RULE_PRIORITY = {};
  for (let i = 0; i < ranked.length; i++) {
    RULE_PRIORITY[ranked[i]] = ranked.length - i;
  }
}

function supportOf(t) {
  let n = 0;
  for (let i = 0; i < RS_SETS.length; i++) {
    if (RS_SETS[i][t]) n++;
  }
  return n;
}

export function calcWinner(scores) {
  const keys = Object.keys(scores);
  const arr = keys.map((k) => [k, scores[k]]);
  arr.sort((a, b) => b[1] - a[1]);
  const top = arr[0][1];
  const tied = arr.filter((e) => e[1] === top).map((e) => e[0]);
  if (tied.length === 1) return { winner: tied[0], resolvedBy: "score" };

  const support = {};
  for (let i = 0; i < tied.length; i++) {
    const t = tied[i];
    support[t] = supportOf(t) + (RULE_PRIORITY[t] || 0) * 0.001;
  }
  let mx = -1;
  for (const k in support) {
    if (support[k] > mx) mx = support[k];
  }
  const best = tied.filter((t) => Math.abs(support[t] - mx) < 0.0001);
  if (best.length === 1) return { winner: best[0], resolvedBy: "support" };

  best.sort((a, b) => (RULE_PRIORITY[b] || 0) - (RULE_PRIORITY[a] || 0));
  return { winner: best[0], resolvedBy: "support_pri" };
}

export function selectNext(questions, dims, answeredIds, excludeIds, scores, step, rng) {
  const recentDims = [];
  for (let i = Math.max(0, answeredIds.length - 2); i < answeredIds.length; i++) {
    for (let q = 0; q < questions.length; q++) {
      if (questions[q].id === answeredIds[i]) {
        recentDims.push(questions[q].dim);
        break;
      }
    }
  }

  const used = {};
  for (let i = 0; i < excludeIds.length; i++) used[excludeIds[i]] = 1;
  const layer = step < 10 ? "core" : step < 16 ? "select" : "explore";

  function pool(filter) {
    return questions.filter((q) => {
      return q.layer === layer && !used[q.id] && (filter ? filter(q) : true);
    });
  }

  let cands = pool((q) => recentDims.indexOf(q.dim) === -1);
  if (!cands.length) cands = pool();
  if (!cands.length) cands = questions.filter((q) => !used[q.id]);
  if (!cands.length) return null;

  if (step < 10) {
    const coveredDims = {};
    for (let ai = 0; ai < answeredIds.length; ai++) {
      for (let aq = 0; aq < questions.length; aq++) {
        if (questions[aq].id === answeredIds[ai]) {
          coveredDims[questions[aq].dim] = 1;
          break;
        }
      }
    }
    for (let d = 0; d < dims.length; d++) {
      if (recentDims.indexOf(dims[d]) !== -1) continue;
      if (coveredDims[dims[d]]) continue;
      const p = cands.filter((q) => q.dim === dims[d]);
      if (p.length) return p[Math.floor(rng() * p.length)];
    }
    for (let d = 0; d < dims.length; d++) {
      if (recentDims.indexOf(dims[d]) !== -1) continue;
      const p = cands.filter((q) => q.dim === dims[d]);
      if (p.length) return p[Math.floor(rng() * p.length)];
    }
    return cands[Math.floor(rng() * cands.length)];
  } else if (step < 16) {
    const dimCnt = {};
    for (let d = 0; d < dims.length; d++) dimCnt[dims[d]] = 0;
    for (let i = 0; i < answeredIds.length; i++) {
      for (let q = 0; q < questions.length; q++) {
        if (questions[q].id === answeredIds[i]) {
          dimCnt[questions[q].dim] = (dimCnt[questions[q].dim] || 0) + 1;
          break;
        }
      }
    }
    const order = dims.filter((d) => recentDims.indexOf(d) === -1);
    order.sort((a, b) => (dimCnt[a] || 0) - (dimCnt[b] || 0));
    for (let d = 0; d < order.length; d++) {
      const p = cands.filter((q) => q.dim === order[d]);
      if (p.length) return p[Math.floor(rng() * p.length)];
    }
    return cands[Math.floor(rng() * cands.length)];
  } else {
    const sk = Object.keys(scores).map((k) => [k, scores[k]]);
    sk.sort((a, b) => b[1] - a[1]);
    const top2 = [sk[0][0], sk[1] ? sk[1][0] : sk[0][0]];
    const pref = cands.filter((q) => {
      return q.mains.some((m) => top2.indexOf(m) !== -1);
    });
    if (pref.length) return pref[Math.floor(rng() * pref.length)];
    return cands[Math.floor(rng() * cands.length)];
  }
}

// 互斥倾向对
const MUTEX_PAIRS = [
  ["领航员", "路痴本痴"],
  ["躺平仙人", "特种兵王"],
  ["行走的攻略", "临时起意派"],
  ["精算师", "现金乞丐"],
  ["文化震惊体", "假装听懂的人"],
  ["罗马觉皇", "特种兵王"],
  ["多啦A梦", "失物招领者"],
  ["美食雷达", "外卖鉴赏家"],
];

const MUTEX_MAP = {};
MUTEX_PAIRS.forEach((p) => {
  MUTEX_MAP[p[0]] = (MUTEX_MAP[p[0]] || []).concat(p[1]);
  MUTEX_MAP[p[1]] = (MUTEX_MAP[p[1]] || []).concat(p[0]);
});

export function applyAnswer(scores, q, choiceIdx) {
  const chosen = q.opts[choiceIdx];
  const w = chosen.weights;
  for (let i = 0; i < w.length; i++) {
    scores[w[i][0]] = (scores[w[i][0]] || 0) + w[i][1];
  }
  const partners = MUTEX_MAP[chosen.main];
  if (partners) {
    const optMains = {};
    for (let o = 0; o < q.opts.length; o++) optMains[q.opts[o].main] = 1;
    for (let p = 0; p < partners.length; p++) {
      if (optMains[partners[p]]) {
        scores[partners[p]] = (scores[partners[p]] || 0) - 1;
      }
    }
  }
}

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

export function matchRate(scores, winner, answeredQs) {
  let mp = 0;
  const actual = scores[winner];
  for (let i = 0; i < answeredQs.length; i++) {
    let best = 0;
    const opts = answeredQs[i].opts;
    for (let o = 0; o < opts.length; o++) {
      const w = opts[o].weights;
      for (let k = 0; k < w.length; k++) {
        if (w[k][0] === winner && w[k][1] > best) best = w[k][1];
      }
    }
    mp += best;
  }
  if (mp <= 0) return 50.0;
  const rate = (actual / mp) * 100;
  return Math.max(Math.round(rate * 10) / 10, 35.0);
}
