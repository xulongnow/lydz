/**
 * 验证 fetch 失败兜底 UI 的代码路径与结构存在性
 * 运行: node tests/validate-fetch-fallback.js
 */

const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'index.html');
const APP_PATH = path.join(__dirname, '..', 'js', 'app.js');

function main() {
  const errors = [];

  const html = fs.readFileSync(HTML_PATH, 'utf-8');
  const app = fs.readFileSync(APP_PATH, 'utf-8');

  // 1. HTML 中存在错误页结构
  if (!html.includes('id="error"')) {
    errors.push('index.html 缺少 id="error" 的错误页 section');
  }
  if (!html.includes('error-retry-btn')) {
    errors.push('index.html 缺少 error-retry-btn 重试按钮');
  }

  // 2. app.js 中存在 showLoadError / hideLoadError
  if (!app.includes('function showLoadError')) {
    errors.push('app.js 缺少 showLoadError 函数');
  }
  if (!app.includes('function hideLoadError')) {
    errors.push('app.js 缺少 hideLoadError 函数');
  }

  // 3. app.js catch 分支调用 showLoadError
  if (!app.includes('showLoadError()')) {
    errors.push('app.js 的 fetch catch 未调用 showLoadError');
  }

  // 4. 重试逻辑存在：点击按钮后重新调用 init
  if (!app.includes('init()')) {
    errors.push('app.js 缺少重新调用 init 的重试逻辑');
  }

  // 5. HTML 中错误页默认隐藏
  if (!html.includes('id="error"') || !/id="error"[^>]*style="[^"]*display:none/.test(html)) {
    errors.push('index.html 错误页未默认隐藏');
  }

  console.log('\n===== fetch 失败兜底验证 =====');
  if (errors.length === 0) {
    console.log('✅ 错误状态展示 + 可操作的恢复路径 代码路径完整');
    process.exit(0);
  } else {
    console.log(`❌ 共 ${errors.length} 项缺失:`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
  }
}

main();
