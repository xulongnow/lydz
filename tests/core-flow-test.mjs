/**
 * 核心流程验证脚本（Node.js ESM）
 * 验证：引擎逻辑、CAT选路、计分、匹配度、分享编解码
 */

import * as engine from '../js/engine.js';
import * as share from '../js/share.js';
import { readFileSync } from 'fs';

const raw = readFileSync(new URL('../data/quiz-data.json', import.meta.url), 'utf-8');
const data = JSON.parse(raw);

console.log('===== 数据加载 =====');
console.log(`题目数: ${data.questions.length}`);
console.log(`人格数: ${data.types.length}`);
console.log(`维度数: ${data.dims.length}`);

// 1. 初始化引擎
engine.setRulePriority(data.questions, data.types);
console.log('\n===== 引擎初始化 OK =====');

// 2. 模拟完整答题流程
const TOTAL_STEPS = 18;
const scores = {};
const history = [];
const seenIds = [];
const answeredIds = [];

for (let step = 0; step < TOTAL_STEPS; step++) {
  const q = engine.selectNext(data.questions, data.dims, answeredIds, seenIds, scores, step, Math.random);
  if (!q) {
    console.error(`\n❌ step ${step} 选不到题`);
    process.exit(1);
  }
  seenIds.push(q.id);
  answeredIds.push(q.id);

  // 随机选一个选项
  const choiceIdx = Math.floor(Math.random() * q.opts.length);
  engine.applyAnswer(scores, q, choiceIdx);
  history.push({ qId: q.id, origIdx: choiceIdx, currentQ: q });
}

console.log(`\n===== 模拟答题完成 (${TOTAL_STEPS} 题) =====`);

// 3. 计算获胜者
const winnerResult = engine.calcWinner(scores);
console.log(`获胜人格: ${winnerResult.winner} (resolvedBy: ${winnerResult.resolvedBy})`);

// 4. 计算匹配度
const answeredQs = history.map((h) => h.currentQ);
const rate = engine.matchRate(scores, winnerResult.winner, answeredQs);
console.log(`匹配度: ${rate}%`);

// 5. 分享编解码测试
const path = history.map((h) => [h.qId, h.origIdx]);
const encoded = share.encodeShare(winnerResult.winner, path);
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
if (decoded.r !== winnerResult.winner) {
  console.error(`❌ resultId 不一致: ${decoded.r} !== ${winnerResult.winner}`);
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

// 6. 中文人格名测试（确保UTF-8安全）
const chinesePath = [['q001', 0], ['q002', 1]];
const chineseEncoded = share.encodeShare('路痴本痴', chinesePath);
const chineseDecoded = share.decodeShare(chineseEncoded);
if (chineseDecoded.r !== '路痴本痴') {
  console.error(`❌ 中文人格名编解码失败: ${chineseDecoded.r}`);
  process.exit(1);
}
console.log('✅ 中文人格名编解码正确');

// 7. 洗牌选项测试
const opts = data.questions[0].opts;
const shuffled = engine.shuffleOptions(opts, Math.random);
if (shuffled.length !== opts.length) {
  console.error('❌ 洗牌后长度不一致');
  process.exit(1);
}
console.log('✅ 洗牌功能正常');

console.log('\n===== 全部核心流程验证通过 =====');
