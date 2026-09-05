/**
 * 应用状态机 — 唯一持有全局状态的角色
 * 协调 engine + ui 模块，处理页面切换、分享回放、重启
 */

import * as engine from './engine.js';
import { encodeShare, decodeShare, takeScreenshot } from './share.js';
import * as welcomeUI from './ui/welcome.js';
import * as quizUI from './ui/quiz.js';
import * as resultUI from './ui/result.js';

const TOTAL_STEPS = 18;

let state = null;
let data = null;

export async function init() {
  const res = await fetch('./data/quiz-data.json');
  data = await res.json();
  engine.setRulePriority(data.questions, data.types);
  welcomeUI.render(document.getElementById('welcome'), data);
  welcomeUI.bindEvents({ onStart: startQuiz });
  quizUI.bindEvents(handlers);

  // 检查 URL hash 是否有分享回放
  if (location.hash) {
    const decoded = decodeShare(location.hash);
    if (decoded && decoded.p && decoded.p.length > 0) {
      replay(decoded);
      return;
    }
  }
}

function startQuiz() {
  state = {
    scores: {},
    history: [],
    step: 0,
    currentQ: null,
    shuffledOpts: null,
    seenIds: [],
  };
  selectNext();
  showPage('quiz');
  renderQuiz();
}

function selectNext() {
  if (state.step >= TOTAL_STEPS) {
    state.currentQ = null;
    return;
  }
  state.currentQ = engine.selectNext(
    data.questions,
    data.dims,
    state.history.map((h) => h.qId),
    state.seenIds,
    state.scores,
    state.step,
    Math.random
  );
  if (!state.currentQ) return;
  state.shuffledOpts = engine.shuffleOptions(state.currentQ.opts);
  if (state.seenIds.indexOf(state.currentQ.id) === -1) {
    state.seenIds.push(state.currentQ.id);
  }
}

function getCurrent() {
  if (!state || !state.currentQ) return null;
  return {
    step: state.step + 1,
    total: TOTAL_STEPS,
    progress: Math.round((state.step / TOTAL_STEPS) * 100),
    stem: state.currentQ.stem,
    dim: state.currentQ.dim,
    options: state.shuffledOpts.map((o) => o.text),
    canGoBack: state.history.length > 0,
    prevSelectedIdx:
      state._prevSelectedIdx !== undefined ? state._prevSelectedIdx : -1,
  };
}

function renderQuiz() {
  const q = getCurrent();
  if (!q || !state.currentQ) {
    showResult();
    return;
  }
  quizUI.render(document.getElementById('quiz'), q);
}

function handleSelect(displayedIdx) {
  if (!state || !state.currentQ) return;
  state._prevSelectedIdx = undefined;
  const opt = state.shuffledOpts[displayedIdx];
  const origIdx = state.currentQ.opts.indexOf(opt);
  engine.applyAnswer(state.scores, state.currentQ, origIdx);
  state.history.push({
    qId: state.currentQ.id,
    origIdx,
    shuffledOpts: state.shuffledOpts,
    currentQ: state.currentQ,
  });
  state.step++;
  selectNext();
  renderQuiz();
}

function handleBack() {
  if (!state || state.history.length === 0) return;
  const last = state.history.pop();
  const w = last.currentQ.opts[last.origIdx].weights;
  for (let i = 0; i < w.length; i++) {
    state.scores[w[i][0]] = (state.scores[w[i][0]] || 0) - w[i][1];
    if (state.scores[w[i][0]] <= 0) delete state.scores[w[i][0]];
  }
  state.step--;
  state.currentQ = last.currentQ;
  state.shuffledOpts = last.shuffledOpts;
  const prevOpt = last.currentQ.opts[last.origIdx];
  state._prevSelectedIdx = last.shuffledOpts.indexOf(prevOpt);
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
  // 更新 URL hash 为分享链接
  history.replaceState(null, '', r.shareLink);
}

function buildResult() {
  if (!state || state.step < 1) return null;
  const w = engine.calcWinner(state.scores);
  const answeredQs = state.history.map((h) => h.currentQ);
  const rate = engine.matchRate(state.scores, w.winner, answeredQs);
  const profile = data.profiles[w.winner] || {
    emoji: '🎯',
    tagline: '神秘旅人',
    desc: '你的旅行风格独一无二。',
    buddy: [],
  };
  const ranked = Object.keys(state.scores)
    .map((k) => ({ type: k, score: state.scores[k] }))
    .sort((a, b) => b.score - a.score);
  const buddies = (profile.buddy || []).map((name) => {
    const p = data.profiles[name] || { emoji: '🧳', tagline: '' };
    return { name, emoji: p.emoji, tagline: p.tagline };
  });
  const path = state.history.map((h) => [h.qId, h.origIdx]);
  const share = encodeShare(w.winner, path);
  return {
    winner: w.winner,
    resolvedBy: w.resolvedBy,
    matchRate: rate,
    profile,
    buddies,
    shareLink: share,
    top5: ranked.slice(0, 5),
    totalQuestions: TOTAL_STEPS,
  };
}

function replay(decoded) {
  state = {
    scores: {},
    history: [],
    step: 0,
    currentQ: null,
    shuffledOpts: null,
    seenIds: [],
  };
  engine.setRulePriority(data.questions, data.types);
  for (let i = 0; i < decoded.p.length; i++) {
    const qId = decoded.p[i][0];
    const origIdx = decoded.p[i][1];
    const q = data.questions.find((qq) => qq.id === qId);
    if (!q) continue;
    engine.applyAnswer(state.scores, q, origIdx);
    state.history.push({
      qId,
      origIdx,
      shuffledOpts: q.opts,
      currentQ: q,
    });
    if (state.seenIds.indexOf(qId) === -1) state.seenIds.push(qId);
    state.step++;
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
document.addEventListener('keydown', (e) => {
  const quizEl = document.getElementById('quiz');
  if (quizEl && quizEl.style.display === 'block') {
    if (e.key >= '1' && e.key <= '4') {
      const idx = parseInt(e.key, 10) - 1;
      handleSelect(idx);
    } else if (e.key === 'ArrowLeft') {
      handleBack();
    }
  }
});

const handlers = {
  onSelect: handleSelect,
  onBack: handleBack,
  onRestart: handleRestart,
};

// 启动
document.addEventListener('DOMContentLoaded', init);
