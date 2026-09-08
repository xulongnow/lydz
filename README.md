# 旅游搭子人格测试 — 维护手册

## 项目结构

```
lydz/
├── index.html              # 入口 HTML（仅加载资源，无业务逻辑）
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
├── tests/
│   ├── validate-data.js    # 数据完整性校验
│   └── validate-engine.js  # 判型引擎仿真验证
└── README.md               # 本文件
```

## 数据格式说明

- **题目 ID 格式**：`dNNNN`（四位数字，如 `d1053`）
- **总题数**：342 道场景题（含 30 道反向验证题）
- **选项字段**：`score`（数值：1.0 / 0.3 / -0.3 / -1.0）
- **自适应题数**：引擎自动选择 12–24 题，无需配置固定题数
- **人格数**：48 种

## 如何增删改题目

所有题目数据在 `data/quiz-data.json` 中，**修改后无需触碰任何 JS/CSS/HTML 文件**。

### 新增一道题

1. 打开 `data/quiz-data.json`。
2. 在 `questions` 数组末尾追加一个 Question 对象：
   - `id`：取当前最大编号 +1，格式 `dNNNN`（如现有最大 `d1053`，新增用 `d1054`）。
   - `dim`：从 `dims` 数组中选一个维度（`D1`–`D6`）。
   - `layer`：按重要性选 `core` / `select` / `explore`。
   - `stem`：题干文本。
   - `sceneTag`：场景标签，用于同场景去重。
   - `opts`：4 个选项，每个含 `text`、`score`。
   - `reverseCheck`（可选）：设为 `true` 表示反向验证题，引擎会自动翻转得分。
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

- **改自适应题数区间**：修改 `js/engine.js` 中 `CONFIG.MIN_QUESTIONS` 和 `CONFIG.MAX_QUESTIONS`。
- **改 layer 阈值分布**：修改 `engine.js` 中的 `LAYER_CORE_MAX_STEP` / `LAYER_SELECT_MAX_STEP`。
- **改反向验证触发阈值**：修改 `CONFIG.REVERSE_TRIGGER_COUNT`。

## 数据校验

```bash
node tests/validate-data.js
```

校验项：
- JSON 结构合法
- `questions[].id` 全局唯一且格式正确
- `questions[].dim` 在 `dims` 中存在
- `questions[].layer` 为 `core`/`select`/`explore`
- 每题 4 个选项，选项中 `score` 为合法数值
- `profiles` 键集合与 `personalities` 一致
- `profile.buddy` 人格名在 `personalities` 中存在
- 各 dim 在各 layer 下的题目数量分布
- 各 dim 反向验证题数量 ≥5

## 引擎验证

```bash
node tests/validate-engine.js
```

仿真测试（48 类人格 × 8 次，种子化 RNG）：
- 自匹配率目标：≥80%
- 前 6 题维度覆盖率：100%
- 终止题数区间：[12, 24]
- RNG 种子化可复现性

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
- html2canvas（本地 vendored，仅截图时按需加载）
