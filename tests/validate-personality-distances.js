/**
 * 48 人格两两距离校验
 * 运行: node tests/validate-personality-distances.js
 *
 * 固化规格中的距离阈值约束（≥0.350），防止向量调整意外破坏互斥性。
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');
const THRESHOLD = 0.350;

function loadData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

function euclideanDistance(v1, v2, dims) {
  let sum = 0;
  for (const d of dims) {
    const diff = (v1[d] || 0) - (v2[d] || 0);
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function main() {
  const data = loadData();
  const dims = data.dims;
  const personalities = data.personalities;
  const names = Object.keys(personalities);

  let minDist = Infinity;
  let minPair = null;
  let belowThreshold = 0;

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const dist = euclideanDistance(personalities[names[i]], personalities[names[j]], dims);
      if (dist < minDist) {
        minDist = dist;
        minPair = [names[i], names[j]];
      }
      if (dist < THRESHOLD) {
        belowThreshold++;
        console.error(`  ❌ 距离过低: ${names[i]} ↔ ${names[j]} = ${dist.toFixed(4)}`);
      }
    }
  }

  console.log(`\n最小两两距离: ${minDist.toFixed(4)} (${minPair.join(' ↔ ')})`);
  console.log(`低于阈值 ${THRESHOLD} 的对数: ${belowThreshold}`);

  if (belowThreshold === 0) {
    console.log('✅ 全部通过');
    process.exit(0);
  } else {
    console.log(`❌ ${belowThreshold} 对人格距离低于阈值`);
    process.exit(1);
  }
}

main();
