import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const electronMain = fs.readFileSync(new URL("../desktop/electron-main.cjs", import.meta.url), "utf8");

test("interface only exposes user-created templates", () => {
  assert.doesNotMatch(html, /使用样票演示|内置|value="builtin"/);
  assert.doesNotMatch(app, /api\/demo|#demo|value !== "builtin"|d\.demo/);
  assert.match(html, /自动从 PDF 识别模板/);
  assert.match(app, /自动从 PDF 识别模板/);
});

test("uploads can run without a selected custom template", () => {
  assert.doesNotMatch(app, /请先新建或选择选票模板/);
  assert.match(app, /tplSelect\.value !== ""/);
  assert.match(app, /headers\["X-Template"\]/);
});

test("server has no bundled demo ballot path or demo route", () => {
  assert.doesNotMatch(
    server,
    /demoNames|demoTemplate|demoSelections|sample-ballots|\/api\/demo/,
  );
  assert.match(server, /req\.headers\["x-template"\]/);
  assert.match(server, /local_checkbox_ocr\.mjs/);
  assert.match(server, /recognizeTemplateLocal/);
});

test("Excel export runs outside the Electron main process", () => {
  assert.match(
    server,
    /run\(\s*process\.execPath,\s*\[\s*path\.join\(scriptsDir, "export_xlsx\.mjs"\)/,
    "Excel generation must be isolated so a native export crash cannot close the application window",
  );
});

test("export filename is derived from the cleaned ballot title", () => {
  assert.match(server, /function makeExportFilename\(title\)/);
  assert.match(server, /测评表统计结果汇总表\.xlsx/);
  assert.match(server, /job\.outputFilename/);
});

test("locked or existing desktop exports receive a non-conflicting filename", () => {
  assert.match(server, /async function makeAvailableOutput\(filename\)/);
  assert.match(server, /（\$\{index\}）/);
  assert.match(server, /makeAvailableOutput\(\s*makeExportFilename/);
});

test("Excel exporter has no native rendering dependency", () => {
  const exporter = fs.readFileSync(
    new URL("../scripts/export_xlsx.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(exporter, /artifact-tool|skia-canvas|\.render\(/i);
  assert.match(exporter, /function zipStore/);
  assert.match(exporter, /template\.layout\?\.blocks/);
});

test("review UI uses a compact launcher instead of an expanded page list", () => {
  const exporter = fs.readFileSync(
    new URL("../scripts/export_xlsx.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(exporter, /逐页明细|建议复核|sheet2\.xml/);
  assert.match(html, /id="openReview"/);
  assert.doesNotMatch(html, /id="reviewGrid"/);
  assert.match(app, /window\.open\(`\/review\.html\?job=/);
});

test("Excel export contains only the summary sheet", () => {
  const exporter = fs.readFileSync(
    new URL("../scripts/export_xlsx.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(exporter, /逐页明细|sheet2\.xml/);
});

test("review child window uses template categories plus blank and saves edits", () => {
  const reviewHtml = fs.readFileSync(new URL("../public/review.html", import.meta.url), "utf8");
  const reviewApp = fs.readFileSync(new URL("../public/review.js", import.meta.url), "utf8");
  assert.match(reviewHtml, /id="reviewItems"/);
  assert.match(reviewApp, /\.\.\.state\.template\.categories, "空白"/);
  assert.match(reviewApp, /method: "POST"/);
  assert.match(reviewApp, /\/review`/);
  assert.match(reviewApp, /恢复软件结果/);
});

test("review child window has no system menu", () => {
  assert.match(electronMain, /Menu\.setApplicationMenu\(null\)/);
});

test("recognized review results can be explicitly confirmed without changing the select", () => {
  const reviewApp = fs.readFileSync(new URL("../public/review.js", import.meta.url), "utf8");
  assert.match(reviewApp, /class="confirm"/);
  assert.match(reviewApp, />确认<\/button>/);
  assert.match(reviewApp, /document\.querySelectorAll\("\.confirm"\)/);
  assert.doesNotMatch(reviewApp, /select\.onchange = \(\) => saveReview/);
});

test("main window keeps listening for review summaries after recognition completes", () => {
  const doneStart = app.indexOf('es.addEventListener("done"');
  const errorStart = app.indexOf('es.addEventListener("joberror"', doneStart);
  const doneHandler = app.slice(doneStart, errorStart);
  assert.doesNotMatch(doneHandler, /es\.close\(\)/);
  assert.match(app, /es\.addEventListener\("summary"/);
  assert.match(app, /renderMatrix\(summary\)/);
});

test("starting another task closes the previous live event connection", () => {
  assert.match(app, /let jobEvents = null/);
  assert.match(app, /if \(jobEvents\) jobEvents\.close\(\)/);
  assert.match(app, /jobEvents = es/);
});

test("review layout splits space evenly between ballot preview and review people", () => {
  const reviewCss = fs.readFileSync(new URL("../public/review.css", import.meta.url), "utf8");
  assert.match(reviewCss, /\.work\{[^}]*display:flex;[^}]*overflow:hidden/);
  assert.match(reviewCss, /\.ballot\{[^}]*flex:0 1 50%;[^}]*min-height:0/);
  assert.match(reviewCss, /\.review-items\{[^}]*max-height:none;[^}]*overflow:auto;[^}]*flex:1 1 50%/);
});

test("OCR template records normalized review regions for each serial", () => {
  const ocr = fs.readFileSync(new URL("../scripts/local_checkbox_ocr.mjs", import.meta.url), "utf8");
  assert.match(ocr, /function buildReviewRegions\(layout, w, h\)/);
  assert.match(ocr, /reviewRegions: buildReviewRegions\(layout, w, h\)/);
  assert.match(ocr, /x: left \/ w/);
  assert.match(ocr, /y: top \/ h/);
});

test("unreviewed blank selections can be confirmed in one dynamic bulk action", () => {
  const reviewHtml = fs.readFileSync(new URL("../public/review.html", import.meta.url), "utf8");
  const reviewApp = fs.readFileSync(new URL("../public/review.js", import.meta.url), "utf8");
  assert.match(reviewHtml, /data-filter="blank"/);
  assert.match(reviewHtml, /id="blankCategory"/);
  assert.match(reviewHtml, /id="confirmBlanks"/);
  assert.match(reviewApp, /state\.template\.categories\.map/);
  assert.match(reviewApp, /recognizedCategory === "空白" && !item\.reviewed/);
  assert.match(reviewApp, /\/review\/blanks/);
  assert.match(server, /\/review\/blanks\$/);
  assert.match(server, /recognizedCategory === "空白"/);
  assert.match(server, /!Object\.hasOwn\(job\.reviews, key\)/);
});

test("selecting a review person draws and highlights that detected table row", () => {
  const reviewHtml = fs.readFileSync(new URL("../public/review.html", import.meta.url), "utf8");
  const reviewApp = fs.readFileSync(new URL("../public/review.js", import.meta.url), "utf8");
  assert.match(reviewHtml, /id="personCrop"/);
  assert.match(reviewHtml, /id="showFullPage"/);
  assert.match(reviewApp, /layout\?\.reviewRegions\?\.\[item\.serial\]/);
  assert.match(reviewApp, /drawImage\(/);
  assert.match(reviewApp, /strokeRect\(/);
  assert.match(reviewApp, /function showPersonCrop\(item\)/);
  assert.match(reviewApp, /showFullPage\(\)/);
});

test("review category selects support bounded mouse-wheel changes without saving", () => {
  const reviewApp = fs.readFileSync(new URL("../public/review.js", import.meta.url), "utf8");
  assert.match(reviewApp, /function changeCategoryWithWheel\(event\)/);
  assert.match(reviewApp, /event\.preventDefault\(\)/);
  assert.match(reviewApp, /event\.deltaY > 0 \? 1 : -1/);
  assert.match(reviewApp, /Math\.max\(0, Math\.min\(select\.options\.length - 1/);
  assert.match(reviewApp, /dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(reviewApp, /addEventListener\("wheel", changeCategoryWithWheel, \{ passive: false \}\)/);
  assert.doesNotMatch(
    reviewApp.slice(reviewApp.indexOf("function changeCategoryWithWheel"), reviewApp.indexOf("function renderPage")),
    /saveReview\(/,
  );
});

test("the selected review person uses a strong card and row highlight", () => {
  const reviewCss = fs.readFileSync(new URL("../public/review.css", import.meta.url), "utf8");
  const reviewApp = fs.readFileSync(new URL("../public/review.js", import.meta.url), "utf8");
  assert.match(reviewCss, /\.review-person\.active\{[^}]*border:3px solid #087a58;[^}]*background:#dff4ea/);
  assert.match(reviewCss, /\.review-person\.active::before\{/);
  assert.match(reviewApp, /context\.strokeStyle = "#e36b00"/);
  assert.match(reviewApp, /context\.lineWidth = Math\.max\(7,/);
});

test("summary flags every unmarked evaluable person as blank for review", () => {
  assert.match(server, /const recognizedCategory = selection\?\.category \|\| "空白"/);
  assert.match(server, /const needsReview = !selection/);
  assert.match(server, /\(selection \? low : blank\)\.push\(item\)/);
});

test("PDF upload limit is 100MB", () => {
  assert.match(server, /const MAX_PDF_BYTES = 100 \* 1024 \* 1024/);
  assert.match(server, /PDF 文件不能超过 100MB/);
  assert.match(html, /最大支持 100MB/);
});

test("large PDF uploads stream directly into the task file", () => {
  assert.match(server, /async function newJobFromRequest\(req,/);
  assert.match(server, /await file\.write\(chunk\)/);
  assert.match(server, /await newJobFromRequest\(\s*req,/);
});

test("large PDFs render the first ten pages before remaining batches", () => {
  assert.match(server, /renderPageRange\(job, 1, Math\.min\(10, totalPages\)\)/);
  assert.match(server, /for \(let start = 11; start <= totalPages; start \+= RENDER_BATCH_SIZE\)/);
});

test("manual review overrides are separate and drive effective summaries", () => {
  assert.match(server, /function summarize\(template, results, reviews = \{\}\)/);
  assert.match(server, /recognizedCategory/);
  assert.match(server, /reviewedCategory/);
  assert.match(server, /effectiveCategory/);
  assert.match(server, /template\.categories\.includes\(category\) \|\| category === "空白"/);
  assert.match(server, /emit\(job, "summary"/);
});

test("Excel is generated only by the manual export endpoint", () => {
  const processBody = server.slice(server.indexOf("async function processJob"), server.indexOf("async function newJob"));
  assert.doesNotMatch(processBody, /await createXlsx\(job\)/);
  assert.match(server, /req\.method === "POST" && xlsx/);
  assert.match(app, /fetch\(`\/api\/jobs\/\$\{jobId\}\/export\/xlsx`, \{ method: "POST" \}\)/);
  assert.doesNotMatch(app, /已自动保存到桌面/);
});

test("desktop package excludes the retired native Excel exporter", () => {
  const desktopPackage = fs.readFileSync(
    new URL("../desktop/package.json", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(desktopPackage, /artifact-tool|@oai\/artifact-tool/);
});

test("local OCR module exports template and checkbox recognizers", async () => {
  const mod = await import("../scripts/local_checkbox_ocr.mjs");
  assert.equal(typeof mod.recognizeTemplateLocal, "function");
  assert.equal(typeof mod.recognizeLocal, "function");
});

test("known two-column evaluation layout is preferred before generic grid detection", () => {
  const ocr = fs.readFileSync(
    new URL("../scripts/local_checkbox_ocr.mjs", import.meta.url),
    "utf8",
  );
  assert.match(ocr, /function knownEvaluationLayout\(data, w, h\)/);
  assert.match(ocr, /const layout = knownEvaluationLayout\(data, w, h\) \|\| tableLayout\(data, w, h\)/);
  assert.match(ocr, /categories: 4/);
});

test("visible product branding is consistently named 统票票", () => {
  const reviewHtml = fs.readFileSync(
    new URL("../public/review.html", import.meta.url),
    "utf8",
  );
  const desktopPackage = JSON.parse(
    fs.readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8"),
  );

  assert.match(html, /<title>统票票 · 智能选票统计系统<\/title>/);
  assert.match(html, />统票票<small>智能选票统计系统<\/small>/);
  assert.match(reviewHtml, /<title>建议复核 · 统票票<\/title>/);
  assert.doesNotMatch(`${html}\n${reviewHtml}`, /票析/);
  assert.equal(desktopPackage.build.productName, "统票票");
  assert.equal(desktopPackage.build.nsis.shortcutName, "统票票");
  assert.equal(
    desktopPackage.build.win.artifactName,
    "统票票-安装版-${version}-${arch}.${ext}",
  );
  assert.equal(desktopPackage.build.win.icon, "build/icon.ico");
  assert.equal(
    desktopPackage.build.win.signAndEditExecutable,
    true,
    "Windows executable resource editing must stay enabled so the new icon is embedded",
  );
});

test("checkbox selection prefers a check shape and then the leftmost check", () => {
  const ocr = fs.readFileSync(
    new URL("../scripts/local_checkbox_ocr.mjs", import.meta.url),
    "utf8",
  );
  assert.match(ocr, /function cellMarkEvidence\(data, w, top, bottom, left, right\)/);
  assert.match(ocr, /const preferred = evidence\.findIndex\(\(item\) => item\.check\)/);
  assert.match(ocr, /const best = preferred >= 0 \? preferred : order\[0\]/);
});

test("names are merged from the first ten full pages without secondary OCR", () => {
  const ocr = fs.readFileSync(
    new URL("../scripts/local_checkbox_ocr.mjs", import.meta.url),
    "utf8",
  );
  assert.match(ocr, /\.slice\(0, options\.maxPages \|\| 10\)/);
  assert.match(ocr, /mergePeopleBySerial\(templates\)/);
  assert.doesNotMatch(ocr, /recoverNameWords|incompleteNameBlocks|name-\$\{block\}\.png/);
});

test("main UI exposes progress and result workspaces without changing action ids", () => {
  for (const id of [
    "upload",
    "choose",
    "xlsx",
    "pageImage",
    "openReview",
    "taskWorkspace",
    "progressStrip",
    "metricPeople",
    "metricOptions",
    "metricMarks",
    "resultWorkspace",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
