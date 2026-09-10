/**
 * Fetch 兜底路径端到端验证
 * 运行: node tests/validate-fetch-fallback.js
 *
 * 实现路径：Node.js vm 模块 + 轻量 DOM stub + mock fetch
 * 选择理由：
 * - 纯 Node 环境即可运行，零外部依赖（不装 jsdom/puppeteer）
 * - vm.runInNewContext 可加载真实 app.js 源码，通过字符串替换把 ES import 映射到 stub
 * - mock fetch 可精确控制三种失败场景（HTTP 500、reject、JSON 解析失败）
 * - 断言粒度覆盖：错误 UI 渲染、重试按钮存在、点击重试触发 init() 重调用、兜底按钮真实生效
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const APP_JS_PATH = path.join(__dirname, '..', 'js', 'app.js');

let testCount = 0;
let failCount = 0;

function assert(cond, msg) {
  testCount++;
  if (!cond) {
    failCount++;
    console.error(`  ❌ ${msg}`);
  } else {
    console.log(`  ✅ ${msg}`);
  }
}

// ===== 轻量 DOM stub =====
function createStubElement(tag) {
  const el = {
    tagName: tag,
    id: '',
    className: '',
    style: {},
    textContent: '',
    _innerHTML: '',
    _children: [],
    _listeners: {},
    get innerHTML() { return this._innerHTML; },
    set innerHTML(html) {
      this._innerHTML = html;
      this._children = [];
      // 轻量解析：提取带 id/class 的简单标签
      const tagRegex = /<(\w+)([^>]*)>/g;
      let match;
      while ((match = tagRegex.exec(html)) !== null) {
        const tagName = match[1];
        const attrs = match[2];
        const child = createStubElement(tagName);
        const idMatch = attrs.match(/id=["']([^"']+)["']/);
        if (idMatch) child.id = idMatch[1];
        const clsMatch = attrs.match(/class=["']([^"']+)["']/);
        if (clsMatch) child.className = clsMatch[1];
        // 提取紧接的文本内容（直到下一个 <）
        const endIdx = html.indexOf('<', match.index + match[0].length);
        const textSlice = html.slice(match.index + match[0].length, endIdx >= 0 ? endIdx : html.length);
        const textClean = textSlice.replace(/<\/[^>]+>/g, '').trim();
        if (textClean) child.textContent = textClean;
        this._children.push(child);
      }
    },
    querySelector(sel) {
      if (sel.startsWith('#') && this.id === sel.slice(1)) return this;
      if (sel.startsWith('.') && this.className === sel.slice(1)) return this;
      for (const c of this._children) {
        const r = c.querySelector(sel);
        if (r) return r;
      }
      return null;
    },
    querySelectorAll(sel) {
      const results = [];
      if (sel.startsWith('#') && this.id === sel.slice(1)) results.push(this);
      if (sel.startsWith('.') && this.className === sel.slice(1)) results.push(this);
      for (const c of this._children) {
        results.push(...c.querySelectorAll(sel));
      }
      return results;
    },
    appendChild(child) {
      this._children.push(child);
      return child;
    },
    addEventListener(event, handler) {
      this._listeners[event] = this._listeners[event] || [];
      this._listeners[event].push(handler);
    },
    click() {
      const handlers = this._listeners['click'] || [];
      for (const h of handlers) h();
    },
    getAttribute() { return null; },
    setAttribute() {},
  };
  return el;
}

function buildStubDocument() {
  const welcome = createStubElement('section');
  welcome.id = 'welcome';
  const quiz = createStubElement('section');
  quiz.id = 'quiz';
  const result = createStubElement('section');
  result.id = 'result';
  const doc = {
    _elements: { welcome, quiz, result },
    getElementById(id) {
      if (this._elements[id]) return this._elements[id];
      // deep search
      for (const root of Object.values(this._elements)) {
        const found = root.querySelector('#' + id);
        if (found) return found;
      }
      return null;
    },
    querySelector(sel) {
      for (const root of Object.values(this._elements)) {
        const found = root.querySelector(sel);
        if (found) return found;
      }
      return null;
    },
    querySelectorAll(sel) {
      const results = [];
      for (const root of Object.values(this._elements)) {
        results.push(...root.querySelectorAll(sel));
      }
      return results;
    },
    createElement(tag) {
      return createStubElement(tag);
    },
    addEventListener() {},
  };
  return doc;
}

// ===== 构建 mock 依赖 =====
function buildMocks() {
  return {
    engine: {
      initState: () => ({}),
      selectNext: () => null,
      shuffleOptions: (opts) => opts,
      applyAnswer: () => {},
      buildUserVector: () => ({}),
      determineResult: () => ({ winner: 'test', top3: [] }),
      shouldTerminate: () => ({ terminate: true }),
      undoAnswer: () => {},
      findBuddy: () => null,
      generateDimInterpretation: () => [],
    },
    share: {
      encodeShare: () => '',
      decodeShare: () => null,
      takeScreenshot: () => {},
    },
    welcomeUI: {
      render: () => {},
      bindEvents: () => {},
    },
    quizUI: {
      render: () => {},
      bindEvents: () => {},
    },
    resultUI: {
      render: () => {},
      bindEvents: () => {},
    },
  };
}

// ===== 加载真实 app.js 源码到 vm 上下文 =====
function loadAppIntoContext(context) {
  let appCode = fs.readFileSync(APP_JS_PATH, 'utf-8');

  // 把 ES import 替换成对 context mock 对象的引用
  appCode = appCode.replace(
    /import \* as engine from ['"]\.\/engine\.js['"];?/g,
    'const engine = __mocks.engine;'
  );
  appCode = appCode.replace(
    /import \{ encodeShare, decodeShare, takeScreenshot \} from ['"]\.\/share\.js['"];?/g,
    'const { encodeShare, decodeShare, takeScreenshot } = __mocks.share;'
  );
  appCode = appCode.replace(
    /import \* as welcomeUI from ['"]\.\/ui\/welcome\.js['"];?/g,
    'const welcomeUI = __mocks.welcomeUI;'
  );
  appCode = appCode.replace(
    /import \* as quizUI from ['"]\.\/ui\/quiz\.js['"];?/g,
    'const quizUI = __mocks.quizUI;'
  );
  appCode = appCode.replace(
    /import \* as resultUI from ['"]\.\/ui\/result\.js['"];?/g,
    'const resultUI = __mocks.resultUI;'
  );

  // 把 export function init 改为 function init，便于在 vm 中暴露
  appCode = appCode.replace(/export async function init/g, 'async function init');
  appCode = appCode.replace(/export function/g, 'function');

  // 把 showLoadError 内部的 init() 调用替换为 __app.init()，以便外部能拦截
  appCode = appCode.replace(/init\(\);/g, '__app.init();');

  // 暴露 init 和 showLoadError 到 context
  appCode += '\n__app.init = init;\n__app.showLoadError = showLoadError;\n';

  vm.runInNewContext(appCode, context);
}

async function runTest(name, fetchMock) {
  console.log(`\n--- ${name} ---`);

  const doc = buildStubDocument();
  const mocks = buildMocks();
  const app = {};

  let initCallCount = 0;

  const context = {
    document: doc,
    window: { scrollTo: () => {}, addEventListener: () => {} },
    location: { hash: '', reload: () => {} },
    console,
    fetch: fetchMock,
    history: { replaceState: () => {} },
    Math,
    Array,
    Object,
    JSON,
    parseInt,
    isNaN,
    Error,
    __mocks: mocks,
    __app: app,
  };

  loadAppIntoContext(context);

  // 劫持 init 以统计调用次数
  const originalInit = app.init;
  app.init = async function() {
    initCallCount++;
    return originalInit.call(this);
  };

  // 执行 init（触发 fetch mock）
  await app.init();

  // 断言 1：错误 UI 已渲染
  const errEl = doc.getElementById('loadError');
  assert(errEl !== null, '错误 UI (#loadError) 已渲染');
  if (!errEl) return;

  // 断言 2：错误消息已显示
  const msgEl = errEl.querySelector('.load-error-msg');
  assert(msgEl && msgEl.textContent && msgEl.textContent !== '正在重试...', '错误消息已显示');

  // 断言 3：重新加载按钮存在
  const retryBtn = doc.getElementById('retryLoadBtn');
  assert(retryBtn !== null, '"重新加载"按钮存在');

  // 断言 4：刷新页面按钮存在
  const refreshBtn = doc.getElementById('refreshPageBtn');
  assert(refreshBtn !== null, '"刷新页面"按钮存在');

  // 断言 5：点击"重新加载"会再次调用 init（自动重试路径真实生效）
  if (retryBtn) {
    retryBtn.click();
    assert(initCallCount >= 2, `点击重试后 init() 被再次调用 (实际 ${initCallCount} 次)`);
  }
}

async function main() {
  console.log('===== Fetch 兜底路径端到端验证 =====');

  // 场景 1：fetch 返回 HTTP 500
  await runTest('场景1: fetch 返回 HTTP 500', async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
  }));

  // 场景 2：fetch 网络错误（reject）
  await runTest('场景2: fetch 网络错误（reject）', async () => {
    throw new Error('net::ERR_INTERNET_DISCONNECTED');
  });

  // 场景 3：fetch 成功但返回非 JSON（JSON 解析失败）
  await runTest('场景3: fetch 返回数据但 JSON 解析失败', async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
  }));

  console.log('\n===== 结果 =====');
  if (failCount === 0) {
    console.log(`✅ 全部通过 (${testCount} 项断言)`);
    process.exit(0);
  } else {
    console.log(`❌ ${failCount}/${testCount} 项断言失败`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('执行异常:', e);
  process.exit(1);
});
