/**
 * 核心流程验证脚本 v8（Node.js ESM）
 * 验证：引擎状态机、CAT选路、计分、匹配度、终止条件、分享编解码
 */

import * as engine from '../js/engine.js';
import * as share from '../js/share.js';
import { readFileSync } from 'fs';

const raw = readFileSync(new URL('../data/quiz-data.json', import.meta.url), 'utf-8');
const data = JSON.parse(raw);

console.log('===== 数据加载 =====');
console.log(`题目数: ${data.questions.length}`);
console.log(`人格数: ${Object.keys(data.personalities).length}`);
console.log(`维度数: ${data.dims.length}`);

// 1. 初始化引擎
engine.setRulePriority(data.questions, Object.keys(data.personalities));
console.log('\n===== 引擎初始化 OK =====');

// 2. 模拟完整答题流程
const MIN_STEPS = 12;
const MAX_STEPS = 24;
const history = [];
let state = engine.initState();
for (const d of data.dims) state.userVector[d] = 0;

for (let step = 0; step < MAX_STEPS; step++) {
  const q = engine.selectNext(data.questions, data.dims, data.personalities, state, Math.random);
  if (!q) {
    console.error(`\n❌ step ${step} 选不到题`);
    process.exit(1);
  }

  // 随机选一个选项
  const choiceIdx = Math.floor(Math.random() * q.opts.length);
  engine.applyAnswer(state, q, choiceIdx);
  state.userVector = engine.buildUserVector(state.dimHistory, data.dims);
  history.push({ qId: q.id, origIdx: choiceIdx, currentQ: q });

  // 检查终止条件
  const result = engine.determineResult(state.userVector, data.personalities, data.dims);
  const term = engine.shouldTerminate(state, result, data.dims);
  if (term.terminate && step >= MIN_STEPS - 1) {
    console.log(`\n===== 提前终止于 ${step + 1} 题 (原因: ${term.reason}) =====`);
    break;
  }
}

console.log(`\n===== 模拟答题完成 (${history.length} 题) =====`);

// 3. 计算结果
const userVector = engine.buildUserVector(state.dimHistory, data.dims);
const result = engine.determineResult(userVector, data.personalities, data.dims);
console.log(`获胜人格: ${result.winner}`);
console.log(`置信度: ${result.confidence.toFixed(3)}`);
console.log(`模糊度: ${result.ambiguity}`);
console.log(`Top3:`);
for (const t of result.top3) {
  console.log(`  ${t.name}: 相似度 ${t.similarity}%, 距离 ${t.distance.toFixed(3)}`);
}

// 4. 最佳搭子
const buddy = engine.findBuddy(result.winner, data.personalities, data.dims);
console.log(`最佳搭子: ${buddy}`);

// 5. 维度解读
const interpretations = engine.generateDimInterpretation(userVector, data.dimLabels || {});
console.log(`维度解读: ${interpretations.join('；')}`);

// 6. 分享编解码测试
const path = history.map((h) => [h.qId, h.origIdx]);
const encoded = share.encodeShare(result.winner, path);
console.log(`\n===== 分享链接测试 =====`);
console.log(`编码结果: ${encoded.substring(0, 60)}...`);

const decoded = share.decodeShare(encoded);
if (!decoded) {
  console.error('❌ 解码失败');
  process.exit(1);
}
console.log(`解码 resultId: ${decoded.r}`);
console.log(`解码 path 长度: ${decoded.p.length}`);

// 验证往返一致性
if (decoded.r !== result.winner) {
  console.error(`❌ resultId 不一致: ${decoded.r} !== ${result.winner}`);
  process.exit(1);
}
if (decoded.p.length !== path.length) {
  console.error(`❌ path 长度不一致`);
  process.exit(1);
}
for (let i = 0; i < path.length; i++) {
  if (decoded.p[i][0] !== path[i][0] || decoded.p[i][1] !== path[i][1]) {
    console.error(`❌ path[${i}] 不一致`);
    process.exit(1);
  }
}
console.log('✅ 编解码往返一致');

// 7. 中文人格名测试
const chinesePath = [['q001', 0], ['q002', 1]];
const chineseEncoded = share.encodeShare('路痴本痴', chinesePath);
const chineseDecoded = share.decodeShare(chineseEncoded);
if (chineseDecoded.r !== '路痴本痴') {
  console.error(`❌ 中文人格名编解码失败: ${chineseDecoded.r}`);
  process.exit(1);
}
console.log('✅ 中文人格名编解码正确');

// 8. 洗牌选项测试
const opts = data.questions[0].opts;
const shuffled = engine.shuffleOptions(opts, Math.random);
if (shuffled.length !== opts.length) {
  console.error('❌ 洗牌后长度不一致');
  process.exit(1);
}
console.log('✅ 洗牌功能正常');

// 9. 撤销答案测试
if (history.length >= 2) {
  const last = history[history.length - 1];
  const prevLen = state.answeredIds.length;
  engine.undoAnswer(state, last.currentQ, last.origIdx);
  if (state.answeredIds.length !== prevLen - 1) {
    console.error('❌ 撤销后 answeredIds 长度未减 1');
    process.exit(1);
  }
  console.log('✅ 撤销功能正常');
}

console.log('\n===== 全部核心流程验证通过 =====');
