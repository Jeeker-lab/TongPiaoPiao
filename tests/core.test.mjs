import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const html = read("public/index.html");
const app = read("public/app.js");
const style = read("public/style.css");
const review = read("public/review.html");
const main = read("desktop/electron-main.cjs");

test("PDF upload remains automatic and supports 100MB", () => {
  assert.match(app, /MAX_FILE_BYTES = 100 \* 1024 \* 1024/);
  assert.match(app, /Content-Type":"application\/pdf/);
  assert.doesNotMatch(html, /templateSelect|newTemplate/);
});

test("processing UI has PDF progress card", () => {
  assert.match(html, /progress-file/);
  assert.match(html, /scanCurrent/);
  assert.match(html, /scanTotal/);
  assert.match(style, /progress-scan/);
});

test("completion page keeps export and review actions", () => {
  assert.match(html, /id="completion"/);
  assert.match(html, /id="completionExport"/);
  assert.match(html, /id="completionReview"/);
  assert.match(app, /showCompletion\(\)/);
});

test("metrics include icons and review window remains available", () => {
  assert.match(html, /metric-icon/);
  assert.match(html, /id="openReview"/);
  assert.match(review, /建议复核/);
});

test("native and page titles use the requested system name", () => {
  assert.match(html, /<title>智能选票统计系统<\/title>/);
  assert.match(main, /app\.setName\('智能选票统计系统'\)/);
  assert.match(main, /title: '智能选票统计系统'/);
});
