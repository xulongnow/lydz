/**
 * 应用状态机 — 唯一持有全局状态的角色
 * 协调 engine + ui 模块，处理页面切换、分享回放、重启
 */

import * as engine from './engine.js';
import { encodeShare, decodeShare, takeScreenshot } from './share.js';
import * as welcomeUI from './ui/welcome.js';
import * as quizUI from './ui/quiz.js';
import * as resultUI from './ui/result.js';

const MIN_STEPS = 12;
const MAX_STEPS = 24;

let state = null;
let data = null;

export async function init() {
  let loadedData;
  try {
    const res = await fetch('./data/quiz-data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadedData = await res.json();
  } catch (e) {
    console.error(e);
    const sub = document.querySelector('.welcome-sub');
    if (sub) sub.textContent = '数据加载失败，请检查网络后刷新页面';
    return;
  }
  data = loadedData;
  engine.setRulePriority(data.questions, Object.keys(data.personalities || {}));
  welcomeUI.render(document.getElementById('welcome'), data);
  welcomeUI.bindEvents({ onStart: startQuiz });
  quizUI.bindEvents(handlers);

  // 检查 URL hash 是否有分享回放
  if (location.hash) {
    const decoded = decodeShare(location.hash);
    if (decoded && decoded.p && Array.isArray(decoded.p) && decoded.p.length > 0) {
      replay(decoded);
      return;
    }
  }
}

function startQuiz() {
  state = engine.initState();
  state.userVector = {};
  for (const d of data.dims) state.userVector[d] = 0;
  selectNext();
  showPage('quiz');
  renderQuiz();
}

function selectNext() {
  const nextQ = engine.selectNext(
    data.questions,
    data.dims,
    data.personalities,
    state,
    Math.random
  );
  state.currentQ = nextQ || null;
  if (state.currentQ) {
    state.shuffledOpts = engine.shuffleOptions(state.currentQ.opts);
  }
}

function getCurrent() {
  if (!state || !state.currentQ) return null;
  const answered = state.answeredIds.length;
  const totalDisplay = answered < MIN_STEPS ? MIN_STEPS : (answered >= MAX_STEPS ? answered : MAX_STEPS);
  // progress 基于当前 totalDisplay 而非固定 MAX_STEPS
  const progress = totalDisplay > 0 ? Math.round((answered / totalDisplay) * 100) : 0;
  return {
    step: answered + 1,
    total: totalDisplay,
    progress,
    stem: state.currentQ.stem,
    dim: state.currentQ.dim,
    dimLabel: data.dimLabels && data.dimLabels[state.currentQ.dim] ? data.dimLabels[state.currentQ.dim].positive : state.currentQ.dim,
    options: state.shuffledOpts.map((o) => o.text),
    canGoBack: state.answeredIds.length > 0,
    prevSelectedIdx:
      state._prevSelectedIdx !== undefined ? state._prevSelectedIdx : -1,
  };
}

function renderQuiz() {
  const q = getCurrent();
  if (!q || !state.currentQ) {
    // 检查是否满足终止条件
    const result = engine.determineResult(
      engine.buildUserVector(state.dimHistory, data.dims),
      data.personalities,
      data.dims
    );
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate || !state.currentQ) {
      showResult();
      return;
    }
  }
  quizUI.render(document.getElementById('quiz'), q);
}

function handleSelect(displayedIdx) {
  if (!state || !state.currentQ) return;
  state._prevSelectedIdx = undefined;
  const opt = state.shuffledOpts[displayedIdx];
  const origIdx = state.currentQ.opts.indexOf(opt);
  engine.applyAnswer(state, state.currentQ, origIdx);

  // 记录答题历史（用于分享链接回放和返回上一题）
  if (!state.history) state.history = [];
  state.history.push({
    qId: state.currentQ.id,
    origIdx: origIdx,
    shuffledOpts: state.shuffledOpts,
    currentQ: state.currentQ,
  });

  // 更新 userVector
  state.userVector = engine.buildUserVector(state.dimHistory, data.dims);

  // 检查终止条件
  const result = engine.determineResult(state.userVector, data.personalities, data.dims);
  const term = engine.shouldTerminate(state, result, data.dims);

  if (term.terminate) {
    state.currentQ = null;
    showResult();
    return;
  }

  selectNext();
  renderQuiz();
}

function handleBack() {
  if (!state || state.answeredIds.length === 0) return;
  const lastQId = state.answeredIds[state.answeredIds.length - 1];
  const lastQ = data.questions.find((q) => q.id === lastQId);
  if (!lastQ) return;

  // 找到最后一次答该题时的选项
  const lastHist = state.history ? state.history[state.history.length - 1] : null;
  if (lastHist && lastHist.qId === lastQId) {
    engine.undoAnswer(state, lastQ, lastHist.origIdx, data.dims);
    state.history.pop();
    state.currentQ = lastQ;
    state.shuffledOpts = lastHist.shuffledOpts;
    const prevOpt = lastQ.opts[lastHist.origIdx];
    state._prevSelectedIdx = lastHist.shuffledOpts.indexOf(prevOpt);
  } else {
    // fallback: 直接减少历史
    const hist = state.dimHistory[lastQ.dim];
    if (hist && hist.length > 0) hist.pop();
    state.answeredIds.pop();
    state.step--;
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
    if (state.history) state.history.pop(); // 修复P0：同步 history
    state.currentQ = lastQ;
    state.shuffledOpts = engine.shuffleOptions(lastQ.opts);
    // 修复：fallback 也需要同步 history
    if (state.history && state.history.length > 0) {
      state.history.pop();
    }
  }
  renderQuiz();
}

function handleRestart() {
  state = null;
  showPage('welcome');
}

function showResult() {
  const r = buildResult();
  if (!r) return;
  showPage('result');
  resultUI.render(document.getElementById('result'), r, data);
  resultUI.bindEvents({
    onShare: () => {
      const el = document.getElementById('resultContainer');
      takeScreenshot(el, `旅游搭子测试_${r.winner}.png`);
    },
    onRetry: handleRestart,
  });
  history.replaceState(null, '', r.shareLink);
}

function buildResult() {
  if (!state || state.answeredIds.length < 1) return null;
  const userVector = engine.buildUserVector(state.dimHistory, data.dims);
  const result = engine.determineResult(userVector, data.personalities, data.dims);
  const profile = data.profiles[result.winner] || {
    emoji: '🎯',
    tagline: '神秘旅人',
    desc: '你的旅行风格独一无二。',
    buddy: [],
  };

  // 使用向量空间距离计算最佳搭子（动态互补）
  const buddyName = engine.findBuddy(result.winner, data.personalities, data.dims);
  const buddyProfile = buddyName ? (data.profiles[buddyName] || { emoji: '🧳', tagline: '' }) : null;
  const buddies = buddyProfile ? [{ name: buddyName, emoji: buddyProfile.emoji, tagline: buddyProfile.tagline }] : [];

  // 如果动态计算的搭子为空，回退到profile中的buddy
  if (buddies.length === 0 && profile.buddy && profile.buddy.length > 0) {
    for (const name of profile.buddy) {
      const p = data.profiles[name];
      if (p) buddies.push({ name, emoji: p.emoji, tagline: p.tagline });
    }
  }

  const path = state.history ? state.history.map((h) => [h.qId, h.origIdx]) : [];
  const share = encodeShare(result.winner, path);

  // 雷达图数据
  const radarData = data.dims.map(d => ({
    dim: d,
    label: data.dimLabels && data.dimLabels[d] ? `${data.dimLabels[d].positive}/${data.dimLabels[d].negative}` : d,
    score: userVector[d] || 0,
  }));

  // 维度解读
  const dimInterpretation = engine.generateDimInterpretation(userVector, data.dimLabels || {});

  return {
    winner: result.winner,
    matchRate: result.top3[0].similarity,
    profile,
    buddies,
    shareLink: share,
    top3: result.top3,
    confidence: result.confidence,
    ambiguity: result.ambiguity,
    presentation: result.presentation,
    userVector,
    radarData,
    dimInterpretation,
    totalQuestions: state.answeredIds.length,
  };
}

function replay(decoded) {
  state = engine.initState();
  for (const d of data.dims) state.userVector[d] = 0;

  if (!state.history) state.history = [];

  for (let i = 0; i < decoded.p.length; i++) {
    const item = decoded.p[i];
    if (!Array.isArray(item) || item.length < 2) continue;
    const qId = item[0];
    const origIdx = item[1];
    const q = data.questions.find((qq) => qq.id === qId);
    if (!q) continue;
    if (origIdx < 0 || origIdx >= q.opts.length) continue;
    engine.applyAnswer(state, q, origIdx);
    state.history.push({
      qId,
      origIdx,
      shuffledOpts: q.opts,
      currentQ: q,
    });
  }
  showResult();
}

function showPage(id) {
  const modes = { welcome: 'flex', quiz: 'block', result: 'block' };
  const pages = ['welcome', 'quiz', 'result'];
  for (const p of pages) {
    document.getElementById(p).style.display = p === id ? modes[p] : 'none';
  }
  window.scrollTo(0, 0);
}

// 键盘导航
const quizEl = document.getElementById('quiz');
document.addEventListener('keydown', (e) => {
  if (!quizEl || quizEl.style.display !== 'block') return;
  if (!state || !state.shuffledOpts) return;

  const maxIdx = state.shuffledOpts.length;
  const keyNum = parseInt(e.key, 10);
  if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= maxIdx) {
    handleSelect(keyNum - 1);
  } else if (e.key === 'ArrowLeft') {
    handleBack();
  }
});

const handlers = {
  onSelect: handleSelect,
  onBack: handleBack,
  onRestart: handleRestart,
};

// 启动
document.addEventListener('DOMContentLoaded', init);
