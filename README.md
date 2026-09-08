# 旅游搭子人格测试 — 维护手册

## 项目结构

```
lydz/
├── index.html              # 入口 HTML（CSP、元信息、模块加载）
├── data/
│   └── quiz-data.json      # 题库 + 人格 profile（维护者主要编辑的文件）
├── css/
│   └── main.css            # 全部样式
├── js/
│   ├── engine.js           # CAT 引擎（纯函数，零 DOM）
│   ├── share.js            # 分享编解码 + 截图
│   ├── app.js              # 应用状态机
│   └── ui/
│       ├── welcome.js      # 欢迎页
│       ├── quiz.js         # 答题页
│       └── result.js       # 结果页
│   └── vendor/
│       └── html2canvas.esm.js  # html2canvas 1.4.1（本地 vendored）
├── tests/
│   ├── validate-data.js    # 数据完整性校验
│   ├── validate-engine.js  # 引擎仿真验证（48 类人格全覆盖）
│   └── test-share-link.js  # 分享链接编解码测试
└── README.md               # 本文件
```

## 数据格式说明

- **题目 ID**：`d{维度编号}{序号}`，如 `d1001`（D1 维度第 1 题）、`d6057`（D6 维度第 57 题）
- **题目总数**：342 道（6 维度 × 约 57 题/维度）
- **选项字段**：`score`（数值，取值为 1.0 / 0.3 / -0.3 / -1.0）
- **反向验证题**：`reverseCheck: true`，引擎自动翻转得分用于一致性验证
- **题数区间**：引擎自适应 12–24 题（最小 12 题，最大 24 题）

## 如何增删改题目

所有题目数据在 `data/quiz-data.json` 中，**修改后无需触碰任何 JS/CSS/HTML 文件**。

### 新增一道题

1. 打开 `data/quiz-data.json`。
2. 在 `questions` 数组末尾追加一个 Question 对象：
   - `id`：取当前最大编号 +1，格式 `d{维度}{序号}`（如 `d6057` 之后新增用 `d6058`）。
   - `dim`：从 `dims` 数组中选一个维度（D1–D6）。
   - `layer`：按重要性选 `core` / `select` / `explore`。
   - `stem`：题干文本。
   - `opts`：4 个选项，每个含 `text`、`score`。
   - `reverseCheck`：`true` 表示反向验证题（引擎自动翻转得分）。
3. 运行校验脚本确认合法：
   ```bash
   node tests/validate-data.js
   ```
4. 提交 JSON 变更。

### 修改一道题

1. 在 `questions` 数组中找到对应 `id`。
2. 修改 `stem`、`opts[].text`、`opts[].score` 等。**不要改 `id`**。
3. 运行 `node tests/validate-data.js`。
4. 提交。

### 删除一道题

1. 在 `questions` 中删除对应条目。
2. 运行 `node tests/validate-data.js` 确认剩余数据合法。
3. 提交。

## 如何调整出题逻辑（CAT 引擎）

CAT 选路逻辑在 `js/engine.js` 的 `selectNext()` 函数中，与数据分离：

- **改题数区间**：修改 `js/engine.js` 中 `CONFIG.MIN_QUESTIONS` / `CONFIG.MAX_QUESTIONS`。
- **改 layer 阈值分布**：修改 `engine.js` 中的 `LAYER_CORE_MAX_STEP` / `LAYER_SELECT_MAX_STEP`。
- **改维度优先覆盖策略**：修改 `engine.js` 中 `coveredDims` / `dimCnt` 相关逻辑。

## 数据校验

```bash
node tests/validate-data.js
```

校验项：
- JSON 结构合法
- `questions[].id` 全局唯一且格式正确
- `questions[].dim` 在 `dims` 中存在
- `questions[].layer` 为 `core`/`select`/`explore`
- 每题 4 个选项，选项中 `score` 取值为 1.0 / 0.3 / -0.3 / -1.0
- `profiles` 键集合与 `personalities` 一致
- `profile.buddy` 人格名在 `types` 中存在
- 各 dim 在各 layer 下的题目数量分布
- 各 dim 的 `reverseCheck` 题目不少于 5 道

## 引擎仿真验证

```bash
node tests/validate-engine.js
```

验证项（种子化 RNG，结果可复现）：
- 48 类人格完美可达性
- 低噪声下自匹配率（目标 ≥80%）
- 前 6 题维度覆盖率
- 防偏执 reverseCheck 触发
- 自适应选题动态变化
- 终止条件合理性
- RNG 种子化复现性

## 本地验证

```bash
# 启动静态服务器
npx serve . -p 8080
# 或 python
python3 -m http.server 8080

# 打开浏览器访问 http://localhost:8080
# 测试：欢迎页 -> 完成答题 -> 出结果 -> 分享链接生成与还原
```

## 部署

纯静态文件，直接部署到任意静态托管：
- GitHub Pages
- Vercel / Netlify
- Nginx / Apache
- 对象存储（COS / OSS / S3）

无需构建步骤。

## 技术栈

- 原生 ES Module（零构建）
- 原生 CSS（CSS 变量）
- html2canvas 1.4.1（本地 vendored，ESM 按需加载，截图失败有兜底提示）
- CSP：`script-src 'self'`（无 unsafe-inline），`style-src 'self' 'unsafe-inline'`（内联 style 属性 unavoidable）

## 近期修复记录

### v10.1（第二轮重构）

- **数据加载失败兜底**：fetch 失败时展示明确错误状态 + 手动重试/刷新按钮，不再仅改一行文字
- **CSP 收紧**：移除 `script-src` 的 `unsafe-inline`，html2canvas 改为本地 vendored
- **反向验证启用**：修复引擎 `reverseCheck` 适配层（字段名对齐），30 道反向题自动翻转得分
- **清理历史残留**：删除 `.bak` 文件
- **README 更新**：修正 id 格式、题数、字段名、题数区间等过时描述
