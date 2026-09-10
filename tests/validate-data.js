/**
 * 数据完整性校验脚本 (v8)
 * 运行: node tests/validate-data.js
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'quiz-data.json');

function loadData() {
  const raw = fs.readFileSync(DATA_PATH, 'utf-8');
  return JSON.parse(raw);
}

function validate(data) {
  const errors = [];

  // 1. 顶层字段
  const requiredTop = ['version', 'dims', 'dimLabels', 'personalities', 'questions', 'profiles'];
  for (const k of requiredTop) {
    if (!(k in data)) errors.push(`缺少顶层字段: ${k}`);
  }

  if (data.version !== 'v9') {
    errors.push(`version 应为 v9, 实际: ${data.version}`);
  }

  // 2. dims
  if (!Array.isArray(data.dims)) errors.push('dims 必须是数组');
  const dimSet = new Set(data.dims || []);
  if (dimSet.size !== 6) errors.push(`dims 应有 6 个维度, 实际 ${dimSet.size}`);

  // 3. personalities
  const personalities = data.personalities || {};
  const personalityNames = Object.keys(personalities);
  if (personalityNames.length !== 48) {
    errors.push(`personalities 应有 48 种, 实际 ${personalityNames.length}`);
  }
  for (const name of personalityNames) {
    const vec = personalities[name];
    for (const d of data.dims) {
      if (!(d in vec)) errors.push(`personalities[${name}] 缺少维度 ${d}`);
      else if (typeof vec[d] !== 'number') errors.push(`personalities[${name}].${d} 不是数字`);
      else if (vec[d] < -1 || vec[d] > 1) errors.push(`personalities[${name}].${d} 超出 [-1,1]: ${vec[d]}`);
    }
  }

  // 4. profiles
  const profiles = data.profiles || {};
  for (const name of personalityNames) {
    if (!(name in profiles)) errors.push(`profiles 缺少人格: ${name}`);
  }
  for (const [name, p] of Object.entries(profiles)) {
    if (!personalityNames.includes(name)) errors.push(`profiles 中存在非法人格键: ${name}`);
    if (!p.emoji) errors.push(`profiles[${name}] 缺少 emoji`);
    if (!p.tagline) errors.push(`profiles[${name}] 缺少 tagline`);
    if (!p.desc) errors.push(`profiles[${name}] 缺少 desc`);
    if (!Array.isArray(p.buddy)) errors.push(`profiles[${name}] buddy 必须是数组`);
    else {
      for (const b of p.buddy) {
        if (!personalityNames.includes(b)) errors.push(`profiles[${name}] buddy 人格不存在: ${b}`);
      }
    }
  }

  // 5. questions
  const questions = data.questions || [];
  if (questions.length < 320) {
    errors.push(`题目数不足 320, 实际 ${questions.length}`);
  }

  const idSet = new Set();
  const idRegex = /^[a-z0-9]+$/;
  const validLayers = ['core', 'select', 'explore'];
  const validScores = [1.0, 0.3, -0.3, -1.0];

  const dimQCount = {};
  const dimReverseCount = {};
  for (const d of data.dims) { dimQCount[d] = 0; dimReverseCount[d] = 0; }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const prefix = `questions[${i}]`;

    if (!q.id) { errors.push(`${prefix} 缺少 id`); continue; }
    if (!idRegex.test(q.id)) errors.push(`${prefix} id 格式错误: ${q.id}`);
    if (idSet.has(q.id)) errors.push(`${prefix} id 重复: ${q.id}`);
    idSet.add(q.id);

    if (!q.dim) errors.push(`${prefix} 缺少 dim`);
    else if (!dimSet.has(q.dim)) errors.push(`${prefix} dim 不在 dims 中: ${q.dim}`);
    else dimQCount[q.dim]++;

    if (!q.layer) errors.push(`${prefix} 缺少 layer`);
    else if (!validLayers.includes(q.layer)) errors.push(`${prefix} layer 非法: ${q.layer}`);

    if (!q.sceneTag) errors.push(`${prefix} 缺少 sceneTag`);
    if (!q.stem) errors.push(`${prefix} 缺少 stem`);

    if (!Array.isArray(q.opts)) errors.push(`${prefix} opts 必须是数组`);
    else if (q.opts.length !== 4) errors.push(`${prefix} opts 长度应为 4, 实际 ${q.opts.length}`);
    else {
      const scores = [];
      for (let oi = 0; oi < q.opts.length; oi++) {
        const opt = q.opts[oi];
        const op = `${prefix}.opts[${oi}]`;
        if (!opt.text) errors.push(`${op} 缺少 text`);
        if (typeof opt.score !== 'number') errors.push(`${op} score 不是数字`);
        else scores.push(opt.score);
      }
      // 允许选项顺序打乱，所以检查集合而非顺序
      const scoreSet = new Set(scores);
      for (const s of validScores) {
        if (!scoreSet.has(s)) errors.push(`${prefix} 缺少 score=${s} 的选项`);
      }
      if (scoreSet.size !== 4) errors.push(`${prefix} score 有重复值`);
    }

    if (q.reverseCheck) dimReverseCount[q.dim]++;
  }

  for (const d of data.dims) {
    if (dimQCount[d] < 50) errors.push(`${d} 题目不足 50, 实际 ${dimQCount[d]}`);
    if (dimReverseCount[d] < 5) errors.push(`${d} reverseCheck 不足 5, 实际 ${dimReverseCount[d]}`);
  }

  // 6. 统计
  console.log(`\n===== 统计 =====`);
  console.log(`题目数: ${questions.length}`);
  console.log(`人格数: ${personalityNames.length}`);
  console.log(`维度数: ${data.dims.length}`);

  const dist = {};
  for (const q of questions) {
    const key = `${q.dim}/${q.layer}`;
    dist[key] = (dist[key] || 0) + 1;
  }
  console.log(`\n维度/层级分布:`);
  for (const d of data.dims) {
    const c = dist[`${d}/core`] || 0;
    const s = dist[`${d}/select`] || 0;
    const e = dist[`${d}/explore`] || 0;
    console.log(`  ${d}: core=${c}, select=${s}, explore=${e}, reverse=${dimReverseCount[d]}`);
  }

  return errors;
}

function main() {
  let data;
  try {
    data = loadData();
  } catch (e) {
    console.error(`❌ 无法加载数据: ${e.message}`);
    process.exit(1);
  }

  const errors = validate(data);

  console.log(`\n===== 校验结果 =====`);
  if (errors.length === 0) {
    console.log('✅ 全部通过');
    process.exit(0);
  } else {
    console.log(`❌ 共 ${errors.length} 项错误:`);
    for (const err of errors) {
      console.log(`  - ${err}`);
    }
    process.exit(1);
  }
}

main();
