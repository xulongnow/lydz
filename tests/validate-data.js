/**
 * 数据完整性校验脚本
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
  const requiredTop = ['version', 'types', 'dims', 'questions', 'profiles', 'meta'];
  for (const k of requiredTop) {
    if (!(k in data)) errors.push(`缺少顶层字段: ${k}`);
  }

  // 2. types / dims
  if (!Array.isArray(data.types)) errors.push('types 必须是数组');
  if (!Array.isArray(data.dims)) errors.push('dims 必须是数组');

  const typeSet = new Set(data.types || []);
  const dimSet = new Set(data.dims || []);

  // 3. questions
  const questions = data.questions || [];
  const idSet = new Set();
  const idRegex = /^q\d{3}$/;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const prefix = `questions[${i}]`;

    if (!q.id) { errors.push(`${prefix} 缺少 id`); continue; }
    if (!idRegex.test(q.id)) errors.push(`${prefix} id 格式错误: ${q.id}`);
    if (idSet.has(q.id)) errors.push(`${prefix} id 重复: ${q.id}`);
    idSet.add(q.id);

    if (!q.dim) errors.push(`${prefix} 缺少 dim`);
    else if (!dimSet.has(q.dim)) errors.push(`${prefix} dim 不在 dims 中: ${q.dim}`);

    if (!q.layer) errors.push(`${prefix} 缺少 layer`);
    else if (!['core', 'select', 'explore'].includes(q.layer)) errors.push(`${prefix} layer 非法: ${q.layer}`);

    if (!q.stem) errors.push(`${prefix} 缺少 stem`);

    if (!Array.isArray(q.mains)) errors.push(`${prefix} mains 必须是数组`);
    else if (q.mains.length !== 4) errors.push(`${prefix} mains 长度应为 4, 实际 ${q.mains.length}`);
    else {
      for (const m of q.mains) {
        if (!typeSet.has(m)) errors.push(`${prefix} mains 中人格不存在: ${m}`);
      }
    }

    if (!Array.isArray(q.opts)) errors.push(`${prefix} opts 必须是数组`);
    else if (q.opts.length !== 4) errors.push(`${prefix} opts 长度应为 4, 实际 ${q.opts.length}`);
    else {
      for (let oi = 0; oi < q.opts.length; oi++) {
        const opt = q.opts[oi];
        const op = `${prefix}.opts[${oi}]`;
        if (!opt.text) errors.push(`${op} 缺少 text`);
        if (!opt.main) errors.push(`${op} 缺少 main`);
        else if (!typeSet.has(opt.main)) errors.push(`${op} main 人格不存在: ${opt.main}`);
        if (!Array.isArray(opt.weights)) errors.push(`${op} weights 必须是数组`);
        else {
          for (const w of opt.weights) {
            if (!Array.isArray(w) || w.length !== 2) {
              errors.push(`${op} weights 项格式错误`);
              continue;
            }
            if (!typeSet.has(w[0])) errors.push(`${op} weights 中人格不存在: ${w[0]}`);
            if (typeof w[1] !== 'number') errors.push(`${op} weights 分数不是数字: ${w[1]}`);
          }
        }
      }
    }
  }

  // 4. profiles
  const profileKeys = Object.keys(data.profiles || {});
  for (const t of data.types || []) {
    if (!data.profiles || !(t in data.profiles)) {
      errors.push(`profiles 缺少人格: ${t}`);
    }
  }
  for (const k of profileKeys) {
    if (!typeSet.has(k)) errors.push(`profiles 中存在非法人格键: ${k}`);
    const p = data.profiles[k];
    if (!p.emoji) errors.push(`profiles[${k}] 缺少 emoji`);
    if (!p.tagline) errors.push(`profiles[${k}] 缺少 tagline`);
    if (!p.desc) errors.push(`profiles[${k}] 缺少 desc`);
    if (!Array.isArray(p.buddy)) errors.push(`profiles[${k}] buddy 必须是数组`);
    else {
      for (const b of p.buddy) {
        if (!typeSet.has(b)) errors.push(`profiles[${k}] buddy 人格不存在: ${b}`);
      }
    }
  }

  // 5. meta.mutexPairs
  const mutex = (data.meta && data.meta.mutexPairs) || [];
  for (const pair of mutex) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      errors.push(`meta.mutexPairs 项格式错误`);
      continue;
    }
    for (const p of pair) {
      if (!typeSet.has(p)) errors.push(`meta.mutexPairs 中人格不存在: ${p}`);
    }
  }

  // 6. 统计
  console.log(`\n===== 统计 =====`);
  console.log(`题目数: ${questions.length}`);
  console.log(`人格数: ${data.types.length}`);
  console.log(`维度数: ${data.dims.length}`);

  // 7. dim+layer 分布
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
    console.log(`  ${d}: core=${c}, select=${s}, explore=${e}`);
    if (c < 3) console.log(`    ⚠️  ${d}/core 不足 3 题`);
    if (s < 2) console.log(`    ⚠️  ${d}/select 不足 2 题`);
    if (e < 2) console.log(`    ⚠️  ${d}/explore 不足 2 题`);
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
