/**
 * 分享链接功能测试 — 验证 handleSelect 记录 state.history 后分享链接可正确回放
 */
const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const ENGINE_PATH = path.join(__dirname, '..', 'js', 'engine.js');
const SHARE_PATH = path.join(__dirname, '..', 'js', 'share.js');

async function loadModules() {
  const engine = await import(ENGINE_PATH);
  const share = await import(SHARE_PATH);
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  const data = JSON.parse(raw);
  return { engine, share, data };
}

function simulateQuiz(data, engine, targetName, noise = 0) {
  const targetVec = data.personalities[targetName];
  const state = engine.initState();
  const history = [];

  for (let loop = 0; loop < 100; loop++) {
    if (state.answeredIds.length >= 24) break;
    const q = engine.selectNext(data.questions, data.dims, data.personalities, state, Math.random);
    if (!q) break;

    const targetScore = targetVec[q.dim] || 0;
    let preferredIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < q.opts.length; i++) {
      const diff = Math.abs(q.opts[i].score - targetScore);
      if (diff < minDiff) {
        minDiff = diff;
        preferredIdx = i;
      }
    }
    if (Math.random() < noise) {
      preferredIdx = Math.floor(Math.random() * q.opts.length);
    }

    engine.applyAnswer(state, q, preferredIdx);
    state.userVector = engine.buildUserVector(state.dimHistory, data.dims);

    // 模拟 app.js 中的 history 记录
    if (!state.history) state.history = [];
    state.history.push({
      qId: q.id,
      origIdx: preferredIdx,
      shuffledOpts: q.opts,
      currentQ: q,
    });

    const result = engine.determineResult(state.userVector, data.personalities, data.dims);
    const term = engine.shouldTerminate(state, result, data.dims);
    if (term.terminate && state.answeredIds.length >= 12) break;
  }

  return state;
}

async function main() {
  const { engine, share, data } = await loadModules();

  console.log('===== 分享链接功能测试 =====');

  // 测试 5 个不同 personality 的分享链接
  const targets = ['Wi-Fi搜寻者', '资深剧评人', '美食雷达', '特种兵王', '躺平仙人'];
  let allPassed = true;

  for (const target of targets) {
    const state = simulateQuiz(data, engine, target, 0);
    const userVector = engine.buildUserVector(state.dimHistory, data.dims);
    const result = engine.determineResult(userVector, data.personalities, data.dims);

    // 编码分享链接
    const path = state.history.map((h) => [h.qId, h.origIdx]);
    const encoded = share.encodeShare(result.winner, path);

    // 解码
    const decoded = share.decodeShare(encoded);
    if (!decoded) {
      console.log(`❌ ${target}: 解码失败`);
      allPassed = false;
      continue;
    }

    // 验证 resultId
    if (decoded.r !== result.winner) {
      console.log(`❌ ${target}: resultId 不一致 ${decoded.r} !== ${result.winner}`);
      allPassed = false;
      continue;
    }

    // 验证 path 非空
    if (!decoded.p || decoded.p.length === 0) {
      console.log(`❌ ${target}: path 为空`);
      allPassed = false;
      continue;
    }

    // 验证 path 长度
    if (decoded.p.length !== path.length) {
      console.log(`❌ ${target}: path 长度不一致 ${decoded.p.length} !== ${path.length}`);
      allPassed = false;
      continue;
    }

    // 验证 path 内容
    let pathOk = true;
    for (let i = 0; i < path.length; i++) {
      if (decoded.p[i][0] !== path[i][0] || decoded.p[i][1] !== path[i][1]) {
        pathOk = false;
        break;
      }
    }
    if (!pathOk) {
      console.log(`❌ ${target}: path 内容不一致`);
      allPassed = false;
      continue;
    }

    // 回放验证
    const replayState = engine.initState();
    if (!replayState.history) replayState.history = [];
    for (let i = 0; i < decoded.p.length; i++) {
      const qId = decoded.p[i][0];
      const origIdx = decoded.p[i][1];
      const q = data.questions.find((qq) => qq.id === qId);
      if (!q) continue;
      engine.applyAnswer(replayState, q, origIdx);
      replayState.history.push({ qId, origIdx, shuffledOpts: q.opts, currentQ: q });
    }
    replayState.userVector = engine.buildUserVector(replayState.dimHistory, data.dims);
    const replayResult = engine.determineResult(replayState.userVector, data.personalities, data.dims);

    if (replayResult.winner !== result.winner) {
      console.log(`❌ ${target}: 回放结果不一致 ${replayResult.winner} !== ${result.winner}`);
      allPassed = false;
      continue;
    }

    console.log(`✅ ${target}: 分享链接生成/解码/回放一致, path=${path.length}题, winner=${result.winner}`);
  }

  if (allPassed) {
    console.log('\n===== 全部分享链接测试通过 =====');
    process.exit(0);
  } else {
    console.log('\n===== 部分分享链接测试失败 =====');
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
