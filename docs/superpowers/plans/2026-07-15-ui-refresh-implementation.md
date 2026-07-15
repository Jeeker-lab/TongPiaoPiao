# 统票票界面焕新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将统票票主页面改造为进度工作台与结果工作台，并统一复核窗口视觉，同时不改变本地 OCR、复核同步和 Excel 导出行为。

**Architecture:** 保留现有 `app.js` 的上传、SSE 进度、汇总和导出接口。仅重组 `index.html` 的展示容器和 `style.css` 的布局层级；通过已有 DOM id 继续绑定现有行为。复核窗口保持 `review.js` 的选择和保存逻辑，只更新 `review.html` 与 `review.css` 的视觉容器。

**Tech Stack:** 静态 HTML、CSS、原生浏览器 JavaScript、Electron、Node.js 内置测试运行器。

## Global Constraints

- 用户可见名称固定为“统票票·智能选票统计系统”。
- OCR、PDF、统计、人工复核和 Excel 导出必须完全离线运行。
- 不引入新前端依赖，不改变 API 路径和现有元素 id。
- `public/` 与 `desktop/app/public/` 的同名前端文件必须保持一致。
- README 图片只能使用虚构姓名、虚构选票和演示数据。

---

### Task 1: 为新工作台结构建立回归测试

**Files:**
- Modify: `tests/core.test.mjs`
- Modify: `public/index.html`
- Modify: `desktop/app/public/index.html`

**Interfaces:**
- Consumes: 现有主页面元素 id：`upload`、`choose`、`xlsx`、`pageImage`、`openReview`。
- Produces: 主页面工作台元素：`taskWorkspace`、`progressStrip`、`metricPeople`、`metricOptions`、`metricMarks`、`resultWorkspace`。

- [ ] **Step 1: Write the failing test**

```js
test('main UI exposes the progress and result workspaces without changing action ids', () => {
  const html = read('public/index.html');
  for (const id of ['upload', 'choose', 'xlsx', 'pageImage', 'openReview', 'taskWorkspace', 'progressStrip', 'metricPeople', 'metricOptions', 'metricMarks', 'resultWorkspace']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.mjs`

Expected: FAIL because `taskWorkspace` and the new metric ids do not yet exist.

- [ ] **Step 3: Add minimal compatible containers**

Add the named containers around the existing status, current-page and summary sections without renaming the existing action ids.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/core.test.mjs`

Expected: PASS, including all prior behavior tests.

- [ ] **Step 5: Commit**

```bash
git add tests/core.test.mjs public/index.html desktop/app/public/index.html
git commit -m "test: cover dashboard workspace structure"
```

### Task 2: 改造主页面为上传、识别与结果工作台

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css`
- Modify: `desktop/app/public/index.html`
- Modify: `desktop/app/public/style.css`

**Interfaces:**
- Consumes: Task 1 的工作台 id；现有 `app.js` 已更新的状态文本和按钮状态。
- Produces: 初始上传页、识别进度页和完成汇总页的响应式视觉状态。

- [ ] **Step 1: Write the failing style contract test**

```js
test('main UI stylesheet defines dashboard, metric and result workspace states', () => {
  const css = read('public/style.css');
  for (const selector of ['.task-workspace', '.progress-strip', '.metric-grid', '.result-workspace', '.result-matrix']) {
    assert.match(css, new RegExp(selector.replace('.', '\\.'), 'g'));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.mjs`

Expected: FAIL because the dashboard selectors do not exist.

- [ ] **Step 3: Implement the layout**

Create CSS for the following states while retaining existing ids and controls:

```css
.task-workspace { display:grid; gap:18px; }
.progress-strip { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:20px; }
.metric-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
.result-workspace { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr); gap:18px; }
.result-matrix { overflow:auto; border:1px solid var(--line); border-radius:18px; }
```

Use the reference layout: warm off-white page, white brand header, green accent, generous spacing, dashed work panels, one progress strip, three metrics, a two-column page preview/result region, and a prominent export action.

- [ ] **Step 4: Mirror the files into the Electron source**

Copy the verified `public/index.html` and `public/style.css` content to the matching `desktop/app/public/` files.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/core.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/style.css desktop/app/public/index.html desktop/app/public/style.css tests/core.test.mjs
git commit -m "feat: refresh main workspace layout"
```

### Task 3: 让运行时状态填充新的指标与结果区

**Files:**
- Modify: `tests/core.test.mjs`
- Modify: `public/app.js`
- Modify: `desktop/app/public/app.js`

**Interfaces:**
- Consumes: 任务状态事件中的 `result.people`、`result.categories`、`result.summary` 与现有页面元素。
- Produces: `metricPeople`、`metricOptions`、`metricMarks` 和结果矩阵的实时文本更新；缺少状态时显示安全默认值。

- [ ] **Step 1: Write the failing test**

```js
test('main UI updates the dashboard metrics from recognition results', () => {
  const app = read('public/app.js');
  for (const id of ['metricPeople', 'metricOptions', 'metricMarks', 'resultWorkspace']) {
    assert.match(app, new RegExp(`#${id}`));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.mjs`

Expected: FAIL because the new ids are not used by `app.js`.

- [ ] **Step 3: Implement minimal state binding**

In the existing status rendering path, write human-readable defaults and update the three metric elements from the task result. Keep all existing summary table rendering, export enabling and review button enabling logic intact.

- [ ] **Step 4: Mirror the script into the Electron source**

Copy the verified `public/app.js` content to `desktop/app/public/app.js`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/core.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/app.js desktop/app/public/app.js tests/core.test.mjs
git commit -m "feat: bind recognition metrics to workspace"
```

### Task 4: 统一人工复核窗口视觉

**Files:**
- Modify: `tests/core.test.mjs`
- Modify: `public/review.html`
- Modify: `public/review.css`
- Modify: `desktop/app/public/review.html`
- Modify: `desktop/app/public/review.css`

**Interfaces:**
- Consumes: 现有复核 DOM id 与 `review.js` 的事件绑定。
- Produces: 保留原功能的浅色复核工作区、虚线边框、显著选中态和绿色确认区。

- [ ] **Step 1: Write the failing test**

```js
test('review UI retains controls and exposes the refreshed review workspace', () => {
  const html = read('public/review.html');
  const css = read('public/review.css');
  assert.match(html, /id="reviewList"/);
  assert.match(html, /id="reviewConfirm"/);
  assert.match(css, /\.review-workspace/);
  assert.match(css, /\.review-selected/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.mjs`

Expected: FAIL because the refreshed workspace selectors do not exist.

- [ ] **Step 3: Implement visual-only review changes**

Wrap the existing review content in `.review-workspace`; add style rules for the pale page background, dashed outer panel, stronger active person highlight, light ballot panel and green confirmation action. Do not rename or remove existing ids and event targets.

- [ ] **Step 4: Mirror the files into Electron source**

Copy the verified review HTML and CSS to `desktop/app/public/`.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/core.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/review.html public/review.css desktop/app/public/review.html desktop/app/public/review.css tests/core.test.mjs
git commit -m "feat: refresh manual review workspace"
```

### Task 5: 更新公开说明、打包并验证发布物

**Files:**
- Create: `docs/images/recognition-workspace.png`
- Create: `docs/images/summary-workspace.png`
- Create: `docs/images/export-workspace.png`
- Create: `docs/images/review-workspace.png`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: 已确认的四张虚构演示截图和完成的界面实现。
- Produces: README 使用流程截图区、UI 焕新版本记录和可安装 Windows 包。

- [ ] **Step 1: Add a documentation test**

```js
test('README documents all four product workflow screenshots', () => {
  const readme = read('README.md');
  for (const image of ['recognition-workspace.png', 'summary-workspace.png', 'export-workspace.png', 'review-workspace.png']) {
    assert.match(readme, new RegExp(image));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core.test.mjs`

Expected: FAIL because the workflow screenshot links do not yet exist.

- [ ] **Step 3: Copy approved screenshots and update public documentation**

Copy the approved image files into `docs/images/`; add a concise “使用流程” section to README and a UI refresh entry to CHANGELOG.

- [ ] **Step 4: Run all tests and package smoke validation**

Run: `npm.cmd test`

Expected: all tests PASS.

Run the existing offline Electron packaging command and open the packaged application once to confirm the title, upload control, progress workspace, export control and review launcher are visible.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md docs/images tests/core.test.mjs
git commit -m "docs: add UI workflow screenshots"
```

## Plan Self-Review

- Spec coverage: Tasks 1–3 implement the main progress and result workspace; Task 4 updates the review visual language; Task 5 covers documentation, packaging and verification.
- Placeholder scan: no placeholders, deferred implementations or unspecified test commands remain.
- Type consistency: all new ids are named consistently across tests, markup and script bindings; existing ids remain unchanged.
