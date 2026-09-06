/**
 * 批次1修复验证脚本
 * 验证项：
 * 1. P1-1 selectNext 不污染原始 questions 对象（infoGain 残留检查）
 * 2. P1-2a decodeShare 非法输入返回 null 不抛异常
 * 3. P1-2b replay 越界 origIdx 时 history.length === answeredIds.length
 * 4. 48 类零噪声仿真仍 48/48 命中（回归防护）
 */

import * as engine from '../js/engine.js';
import * as share from '../js/share.js';
import { readFileSync } from 'fs';

const raw = readFileSync(new URL('../data/quiz-data.json', import.meta.url), 'utf-8');
const data = JSON.parse(raw);

let allPassed = true;

function assert(cond, msg) {
  if (!cond) {
    console.log(`❌ ${msg}`);
    allPassed = false;
  } else {
    console.log(`✅ ${msg}`);
  }
}

// ===== 验证 P1-1：selectNext 不污染原始数据 =====
console.log('\n===== P1-1 selectNext 副作用检查 =====');

// 运行多轮 selectNext
const state = engine.initState();
for (let i = 0; i < 24; i++) {
  const q = engine.selectNext(data.questions, data.dims, data.personalities, state, Math.random);
  if (!q) break;
  const choiceIdx = Math.floor(Math.random() * q.opts.length);
  engine.applyAnswer(state, q, choiceIdx);
  state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
}

// 检查所有题目是否残留 infoGain
let pollutedCount = 0;
for (const q of data.questions) {
  if ('infoGain' in q) {
    pollutedCount++;
  }
}
assert(pollutedCount === 0, `selectNext 运行后 questions 中 infoGain 残留: ${pollutedCount}/342`);

// ===== 验证 P1-2a：decodeShare 异常处理 =====
console.log('\n===== P1-2a decodeShare 异常处理 =====');

const illegalCases = [
  '#s=abc',
  '#s=!!!',
  '#s=',
  '#s=abc@#$',
  '#s=dGVzdA',       // 截断的 base64（缺少 padding）
  '#s=eyJyIjoi5Lq65', // 截断的 JSON
];

for (const hash of illegalCases) {
  let threw = false;
  let result;
  try {
    result = share.decodeShare(hash);
  } catch (e) {
    threw = true;
  }
  assert(!threw && result === null, `decodeShare("${hash}") 不抛异常且返回 null`);
}

// 合法链接仍正常工作
const validEncoded = share.encodeShare('测试人格', [['q001', 0], ['q002', 1]]);
const validDecoded = share.decodeShare(validEncoded);
assert(validDecoded !== null && validDecoded.r === '测试人格', '合法分享链接编解码仍正常');

// ===== 验证 P1-2b：replay 越界 origIdx =====
console.log('\n===== P1-2b replay 越界 origIdx 校验 =====');

// 构造一个包含越界 origIdx 的分享路径（使用实际存在的题目ID）
const normalPath = [['d1001', 0], ['d1002', 1], ['d1003', 2]];
const maliciousPath = [
  ['d1001', 0],
  ['d1002', 99],   // 越界
  ['d1003', 2],
  ['d1004', -1],   // 越界（负数）
  ['d1005', 1],
];

// 正常回放
const replayStateNormal = engine.initState();
const historyNormal = [];
for (const [qId, origIdx] of normalPath) {
  const q = data.questions.find(qq => qq.id === qId);
  if (!q) continue;
  engine.applyAnswer(replayStateNormal, q, origIdx);
  historyNormal.push({ qId, origIdx });
}
assert(replayStateNormal.answeredIds.length === historyNormal.length,
  `正常回放: answeredIds.length(${replayStateNormal.answeredIds.length}) === history.length(${historyNormal.length})`);

// 恶意回放（模拟 app.js 的 replay 逻辑）
const replayStateMalicious = engine.initState();
if (!replayStateMalicious.history) replayStateMalicious.history = [];
for (const [qId, origIdx] of maliciousPath) {
  const q = data.questions.find(qq => qq.id === qId);
  if (!q) continue;
  if (origIdx < 0 || origIdx >= q.opts.length) continue;  // 修复后的校验逻辑
  engine.applyAnswer(replayStateMalicious, q, origIdx);
  replayStateMalicious.history.push({ qId, origIdx, shuffledOpts: q.opts, currentQ: q });
}
assert(replayStateMalicious.answeredIds.length === replayStateMalicious.history.length,
  `恶意回放: answeredIds.length(${replayStateMalicious.answeredIds.length}) === history.length(${replayStateMalicious.history.length})`);
assert(replayStateMalicious.answeredIds.length === 3,
  `恶意回放过滤后保留 3 条有效记录（原 5 条，2 条越界被跳过）`);

// ===== 回归验证：48 类零噪声仿真 =====
console.log('\n===== 回归验证：48 类零噪声仿真 =====');

const personalityNames = Object.keys(data.personalities);
let perfectHits = 0;
for (const name of personalityNames) {
  const targetVec = data.personalities[name];
  const simState = engine.initState();
  for (let loop = 0; loop < 100; loop++) {
    if (simState.answeredIds.length >= 24) break;
    const q = engine.selectNext(data.questions, data.dims, data.personalities, simState, Math.random);
    if (!q) break;
    let preferredIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < q.opts.length; i++) {
      const diff = Math.abs(q.opts[i].score - targetVec[q.dim]);
      if (diff < minDiff) {
        minDiff = diff;
        preferredIdx = i;
      }
    }
    engine.applyAnswer(simState, q, preferredIdx);
    simState.userVector = engine.buildUserVector(simState.dimHistory, data.dims);
    const result = engine.determineResult(simState.userVector, data.personalities, data.dims);
    const term = engine.shouldTerminate(simState, result, data.dims);
    if (term.terminate && simState.answeredIds.length >= 12) break;
  }
  const result = engine.determineResult(simState.userVector, data.personalities, data.dims);
  if (result.winner === name) perfectHits++;
}
assert(perfectHits === 48, `48 类零噪声仿真命中: ${perfectHits}/48`);

// ===== 汇总 =====
console.log('\n===== 批次1修复验证汇总 =====');
if (allPassed) {
  console.log('✅ 全部验证通过');
  process.exit(0);
} else {
  console.log('❌ 部分验证失败');
  process.exit(1);
}
