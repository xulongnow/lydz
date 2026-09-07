import * as engine from '../js/engine.js';
import { readFileSync } from 'fs';

const data = JSON.parse(readFileSync(new URL('../data/quiz-data.json', import.meta.url), 'utf-8'));

console.log('===== undo 权重一致性测试 =====');

const testState = engine.initState();
// 模拟答题 5 题，全部选同一维度 D1 的 +1.0
const d1Questions = data.questions.filter(q => q.dim === 'D1');
for (let i = 0; i < 5; i++) {
  const q = d1Questions[i];
  const idx = q.opts.findIndex(o => o.score === 1.0);
  engine.applyAnswer(testState, q, idx);
}

// undo 最后 1 题
const lastQ = d1Questions[4];
const lastIdx = lastQ.opts.findIndex(o => o.score === 1.0);
engine.undoAnswer(testState, lastQ, lastIdx, data.dims);

// 重新答这一题
engine.applyAnswer(testState, lastQ, lastIdx);

// 检查 D1 维度所有记录的 step 是否连续
const d1Hist = testState.dimHistory['D1'];
const steps = d1Hist.map(h => h.step).sort((a, b) => a - b);
const isContinuous = steps.every((s, i) => s === i + 1);
console.log(`D1 hist steps: ${steps.join(',')}`);
console.log(`是否连续: ${isContinuous ? '✅' : '❌'}`);

if (!isContinuous) {
  console.error('❌ undo 后 step 不连续');
  process.exit(1);
}

// 验证最终得分与原始 5 题全 +1.0 一致
const expectedScore = 1.0;
const actualScore = engine.buildUserVector(testState.dimHistory, data.dims)['D1'];
console.log(`预期 D1 得分: ${expectedScore}, 实际: ${actualScore.toFixed(4)}`);

if (Math.abs(actualScore - expectedScore) > 0.001) {
  console.error('❌ undo 重答后得分不一致');
  process.exit(1);
}

// 额外测试：undo 中间一题（第3题），然后重新答
const testState2 = engine.initState();
for (let i = 0; i < 5; i++) {
  const q = d1Questions[i];
  const idx = q.opts.findIndex(o => o.score === 1.0);
  engine.applyAnswer(testState2, q, idx);
}

// undo 第3题（step=3）
const midQ = d1Questions[2];
const midIdx = midQ.opts.findIndex(o => o.score === 1.0);
engine.undoAnswer(testState2, midQ, midIdx, data.dims);

// 重新答第3题
engine.applyAnswer(testState2, midQ, midIdx);

const d1Hist2 = testState2.dimHistory['D1'];
const steps2 = d1Hist2.map(h => h.step).sort((a, b) => a - b);
const isContinuous2 = steps2.every((s, i) => s === i + 1);
console.log(`D1 hist steps (mid-undo): ${steps2.join(',')}`);
console.log(`是否连续: ${isContinuous2 ? '✅' : '❌'}`);

if (!isContinuous2) {
  console.error('❌ mid-undo 后 step 不连续');
  process.exit(1);
}

const actualScore2 = engine.buildUserVector(testState2.dimHistory, data.dims)['D1'];
console.log(`预期 D1 得分: ${expectedScore}, 实际: ${actualScore2.toFixed(4)}`);
if (Math.abs(actualScore2 - expectedScore) > 0.001) {
  console.error('❌ mid-undo 重答后得分不一致');
  process.exit(1);
}

console.log('✅ undo 权重一致性测试通过');
