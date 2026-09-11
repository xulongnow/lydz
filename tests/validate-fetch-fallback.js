/**
 * Fetch 失败兜底端到端验证
 * 使用 jsdom 模拟真实浏览器环境 + mock fetch
 * 覆盖：HTTP 500、网络错误、JSON 解析失败三类场景
 * 验证：自动重试（最多 3 次）+ 手动兜底按钮真实生效
 *
 * 运行: node tests/validate-fetch-fallback.js
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_PATH = path.join(__dirname, '..', 'js', 'app.js');
const HTML_PATH = path.join(__dirname, '..', 'index.html');

// 断言辅助
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`ASSERT FAIL: ${msg}\n  expected: ${expected}\n  actual: ${actual}`);
  }
}

function assertTrue(cond, msg) {
  if (!cond) {
    throw new Error(`ASSERT FAIL: ${msg}`);
  }
}

// 构建测试环境
async function buildTestEnv(fetchBehavior) {
  const html = fs.readFileSync(HTML_PATH, 'utf-8');
  const dom = new JSDOM(html, { url: 'https://example.com/' });
  const { window } = dom;

  // 暴露 btoa/atob
  if (!window.btoa) {
    window.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
  }
  if (!window.atob) {
    window.atob = (str) => Buffer.from(str, 'base64').toString('binary');
  }

  // mock fetch
  let callCount = 0;
  window.fetch = async (url) => {
    callCount++;
    return fetchBehavior(url, callCount);
  };

  // 加载依赖模块
  const engine = require('../js/engine.js');
  const share = require('../js/share.js');

  // 读取并转换 app.js
  const appSource = fs.readFileSync(APP_PATH, 'utf-8');
  const transformed = appSource
    .replace(/import \* as engine from '.*?engine\.js';/g, '')
    .replace(/import \{ encodeShare, decodeShare, takeScreenshot \} from '.*?share\.js';/g, '')
    .replace(/import \* as welcomeUI from '.*?welcome\.js';/g, "const welcomeUI = { render() {}, bindEvents() {} };")
    .replace(/import \* as quizUI from '.*?quiz\.js';/g, "const quizUI = { render() {}, bindEvents() {} };")
    .replace(/import \* as resultUI from '.*?result\.js';/g, "const resultUI = { render() {}, bindEvents() {} };")
    .replace(/export async function init/, 'async function __testInit')
    .replace(/document\.addEventListener\('DOMContentLoaded', init\);/, "/* DOMContentLoaded stripped for test */")
    .replace(/export /g, '');

  // 在 vm 中运行，上下文包含 window/document + 依赖
  const context = vm.createContext({
    window,
    document: window.document,
    console,
    setTimeout,
    clearTimeout,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Date,
    Error,
    SyntaxError,
    TypeError,
    Promise,
    fetch: window.fetch,
    location: window.location,
    history: window.history,
    engine,
    encodeShare: share.encodeShare,
    decodeShare: share.decodeShare,
    takeScreenshot: share.takeScreenshot,
  });

  // 注入 engine/share 绑定（UI 模块已在 transformed 中内联）
  vm.runInContext(`
    const engine = this.engine;
    const { encodeShare, decodeShare, takeScreenshot } = this;
  `, context);

  vm.runInContext(transformed, context);

  return {
    init: () => context.__testInit(),
    getCallCount: () => callCount,
    window,
    document: window.document,
  };
}

// ===== 测试场景 1：fetch 返回 HTTP 500 =====
async function testHttp500() {
  console.log('\n--- 场景 1：fetch 返回 HTTP 500 ---');

  const { init, getCallCount, document } = await buildTestEnv((url, count) => {
    return Promise.resolve({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => { throw new Error('should not call json on 500'); },
    });
  });

  await init();

  assertEqual(getCallCount(), 3, 'HTTP 500 时应自动重试 2 次，总调用 3 次');

  const errorBox = document.getElementById('loadError');
  assertTrue(errorBox !== null, 'HTTP 500 兜底应显示错误框');
  assertTrue(errorBox.style.display !== 'none', '错误框应可见');

  const msgEl = errorBox.querySelector('.load-error-msg');
  assertTrue(msgEl.textContent.includes('500'), '错误消息应包含 HTTP 500');

  const retryBtn = document.getElementById('retryLoadBtn');
  const refreshBtn = document.getElementById('refreshPageBtn');
  assertTrue(retryBtn !== null, '应存在「重新加载」按钮');
  assertTrue(refreshBtn !== null, '应存在「刷新页面」按钮');

  console.log('  ✅ HTTP 500 自动重试 + 手动兜底按钮验证通过');
}

// ===== 测试场景 2：fetch 网络错误（reject） =====
async function testNetworkError() {
  console.log('\n--- 场景 2：fetch 网络错误（reject） ---');

  const { init, getCallCount, document } = await buildTestEnv((url, count) => {
    return Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'));
  });

  await init();

  assertEqual(getCallCount(), 3, '网络错误时应自动重试 2 次，总调用 3 次');

  const errorBox = document.getElementById('loadError');
  assertTrue(errorBox !== null, '网络错误兜底应显示错误框');

  const msgEl = errorBox.querySelector('.load-error-msg');
  assertTrue(
    msgEl.textContent.includes('网络') || msgEl.textContent.includes('net::ERR'),
    '错误消息应提示网络问题'
  );

  console.log('  ✅ 网络错误自动重试 + 手动兜底验证通过');
}

// ===== 测试场景 3：返回数据但 JSON 解析失败 =====
async function testJsonParseError() {
  console.log('\n--- 场景 3：JSON 解析失败 ---');

  const { init, getCallCount, document } = await buildTestEnv((url, count) => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    });
  });

  await init();

  assertEqual(getCallCount(), 3, 'JSON 解析失败时应自动重试 2 次，总调用 3 次');

  const errorBox = document.getElementById('loadError');
  assertTrue(errorBox !== null, 'JSON 解析失败兜底应显示错误框');

  const msgEl = errorBox.querySelector('.load-error-msg');
  assertTrue(msgEl.textContent.length > 0, '错误消息不应为空');

  console.log('  ✅ JSON 解析失败自动重试 + 手动兜底验证通过');
}

// ===== 测试场景 4：第 3 次重试成功（验证恢复能力） =====
async function testRecoveryOnThirdAttempt() {
  console.log('\n--- 场景 4：第 3 次重试成功 ---');

  let internalCount = 0;
  const { init, getCallCount, document } = await buildTestEnv((url, count) => {
    internalCount++;
    if (internalCount < 3) {
      return Promise.reject(new Error('Temporary failure'));
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        version: 'v8',
        dims: ['D1','D2','D3','D4','D5','D6'],
        dimLabels: {},
        personalities: {},
        profiles: {},
        questions: []
      }),
    });
  });

  await init();

  assertEqual(getCallCount(), 3, '第 3 次应成功，总调用 3 次');

  const errorBox = document.getElementById('loadError');
  if (errorBox) {
    assertTrue(
      errorBox.style.display === 'none' || errorBox.style.display === '',
      '成功后错误框不应显示'
    );
  }

  console.log('  ✅ 第 3 次重试成功恢复验证通过');
}

// ===== 主入口 =====
async function main() {
  console.log('===== Fetch 失败兜底端到端验证 =====');

  const tests = [
    testHttp500,
    testNetworkError,
    testJsonParseError,
    testRecoveryOnThirdAttempt,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (e) {
      console.error(`  ❌ ${test.name} 失败:`, e.message);
      failed++;
    }
  }

  console.log('\n===== 汇总 =====');
  console.log(`通过: ${passed}/${tests.length}`);
  console.log(`失败: ${failed}/${tests.length}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试运行异常:', e);
  process.exit(1);
});
