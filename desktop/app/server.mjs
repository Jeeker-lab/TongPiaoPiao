import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import crypto from "node:crypto";

const root = path.dirname(fileURLToPath(import.meta.url));
const appRoot = process.env.BALLOT_APP_ROOT || root;
const publicDir = path.join(appRoot, "public");
const scriptsDir = path.join(appRoot, "scripts");
const workDir = process.env.BALLOT_WORK_DIR || path.join(root, "work", "jobs");
const outputsDir = process.env.BALLOT_OUTPUT_DIR || path.join(root, "outputs");
const port = Number(process.env.PORT || 4173);
const jobs = new Map();
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const RENDER_BATCH_SIZE = 5;
const pdftoppm =
  process.env.PDFTOPPM ||
  "C:\\Users\\zhang\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\poppler\\Library\\bin\\pdftoppm.exe";
await Promise.all([
  fsp.mkdir(workDir, { recursive: true }),
  fsp.mkdir(outputsDir, { recursive: true }),
]);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
function json(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
const pdfinfo = process.env.PDFINFO || path.join(path.dirname(pdftoppm), "pdfinfo.exe");
async function readBody(req, limit = MAX_PDF_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("PDF 文件不能超过 100MB");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
function run(cmd, args, cwd = workDir, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(err || `${cmd} exited ${code}`)),
    );
  });
}
function makeExportFilename(title) {
  const clean = String(title || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .trim();
  const base = clean.replace(/测评表?$/, "");
  return `${base}测评表统计结果汇总表.xlsx`;
}
async function makeAvailableOutput(filename) {
  const ext = path.extname(filename);
  const base = filename.slice(0, -ext.length);
  for (let index = 0; ; index++) {
    const candidate = index ? `${base}（${index}）${ext}` : filename;
    try {
      await fsp.access(path.join(outputsDir, candidate));
    } catch {
      return candidate;
    }
  }
}
function emit(job, type, data) {
  const event = { type, data, at: Date.now() };
  job.events.push(event);
  for (const res of job.listeners)
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function responseText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  for (const item of data.output || [])
    for (const c of item.content || [])
      if (typeof c.text === "string") return c.text;
  throw new Error("视觉模型未返回结构化内容");
}
async function askVision(imagePath, prompt, schema, name) {
  const image = await fsp.readFile(imagePath);
  const payload = {
    model: process.env.OPENAI_MODEL || "gpt-5.5",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${image.toString("base64")}`,
            detail: "high",
          },
        ],
      },
    ],
    text: { format: { type: "json_schema", name, strict: true, schema } },
  };
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok)
    throw new Error(
      `视觉模型请求失败 (${resp.status}): ${(await resp.text()).slice(0, 300)}`,
    );
  return JSON.parse(responseText(await resp.json()));
}
async function recognizeTemplate(imagePath, job) {
  if (process.env.BALLOT_OFFLINE === "1" || !process.env.OPENAI_API_KEY) {
    const { recognizeTemplateLocal } = await import(
      pathToFileURL(path.join(scriptsDir, "local_checkbox_ocr.mjs")).href
    );
    const extraImages = (job?.pageImages || [])
      .slice(1, 10)
      .map((name) => path.join(job.dir, name));
    return recognizeTemplateLocal(imagePath, { extraImages, maxPages: 10 });
  }
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "categories", "people"],
    properties: {
      title: { type: "string" },
      categories: { type: "array", items: { type: "string" } },
      people: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["serial", "name", "evaluable"],
          properties: {
            serial: { type: "integer" },
            name: { type: "string" },
            evaluable: { type: "boolean" },
          },
        },
      },
    },
  };
  return askVision(
    imagePath,
    "识别这张中文测评选票的固定模板。提取标题、所有档次选项以及按序号排列的完整姓名名单。左右分栏也要合并成一个连续名单。",
    schema,
    "ballot_template",
  );
}
async function recognizePage(imagePath, page, total, template, job) {
  if (process.env.BALLOT_OFFLINE === "1" || !process.env.OPENAI_API_KEY) {
    const { recognizeLocal } = await import(
      pathToFileURL(path.join(scriptsDir, "local_checkbox_ocr.mjs")).href
    );
    return { page, total, ...(await recognizeLocal(imagePath, template)) };
  }
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["selections"],
    properties: {
      selections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["serial", "name", "category", "confidence"],
          properties: {
            serial: { type: "integer" },
            name: { type: "string" },
            category: { type: "string", enum: template.categories },
            confidence: { type: "number" },
          },
        },
      },
    },
  };
  const prompt = `逐行读取这张测评选票内手写勾号所在的档次。固定档次为：${template.categories.join("、")}。固定名单为：${template.people
    .filter((p) => p.evaluable)
    .map((p) => `${p.serial}.${p.name}`)
    .join(
      "；",
    )}。对每个检测到的勾号返回一条selection。不要判断废票或有效票。当前第${page}/${total}页。`;
  return {
    page,
    total,
    ...(await askVision(imagePath, prompt, schema, "page_selections")),
    engine: "vision",
  };
}
function summarize(template, results, reviews = {}) {
  const counts = {};
  for (const p of template.people) {
    counts[p.serial] = {
      name: p.name,
      evaluable: p.evaluable,
      values: Object.fromEntries(template.categories.map((c) => [c, 0])),
    };
  }
  let marks = 0;
  const low = [], blank = [], reviewItems = [];
  for (const r of results) {
    const bySerial = new Map((r.selections || []).map((s) => [s.serial, s]));
    for (const person of template.people) {
      if (!person.evaluable) continue;
      const selection = bySerial.get(person.serial);
      const recognizedCategory = selection?.category || "空白";
      const key = `${r.page}:${person.serial}`;
      const reviewed = Object.hasOwn(reviews, key);
      const reviewedCategory = reviewed ? reviews[key] : null;
      const effectiveCategory = reviewedCategory ?? recognizedCategory;
      const row = counts[person.serial];
      if (row && Object.hasOwn(row.values, effectiveCategory)) {
        row.values[effectiveCategory]++;
        marks++;
      }
      const needsReview = !selection || Number(selection.confidence || 0) < 0.85;
      if (!needsReview) continue;
      const item = {
        page: r.page,
        serial: person.serial,
        name: person.name,
        recognizedCategory,
        reviewedCategory,
        effectiveCategory,
        category: effectiveCategory,
        confidence: selection?.confidence ?? 0,
        reviewed,
      };
      reviewItems.push(item);
      (selection ? low : blank).push(item);
    }
  }
  const review = reviewItems.filter((item) => !item.reviewed);
  const reviewed = reviewItems.filter((item) => item.reviewed);
  return {
    pages: results.length,
    people: template.people.length,
    categories: template.categories.length,
    marks,
    counts: Object.values(counts).map((x, i) => ({ serial: i + 1, ...x })),
    low,
    blank,
    review,
    reviewed,
    reviewItems,
  };
}
async function createXlsx(job) {
  job.outputFilename = await makeAvailableOutput(
    makeExportFilename(job.template?.title),
  );
  job.outputXlsx = path.join(outputsDir, job.outputFilename);
  await run(
    process.execPath,
    [
      path.join(scriptsDir, "export_xlsx.mjs"),
      path.join(job.dir, "result.json"),
      job.outputXlsx,
      path.join(job.dir, "xlsx-preview.png"),
    ],
    job.dir,
    process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
  );
}
async function getPdfPageCount(pdfPath) {
  const output = await run(pdfinfo, [pdfPath]);
  const match = output.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error("无法读取 PDF 页数");
  return Number(match[1]);
}
async function refreshPageImages(job) {
  job.pageImages = (await fsp.readdir(job.dir))
    .filter((name) => /^page-\d+\.png$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return job.pageImages;
}
async function renderPageRange(job, first, last) {
  const prefix = path.join(job.dir, "page");
  await run(pdftoppm, ["-png", "-r", "170", "-f", String(first), "-l", String(last), job.pdf, prefix]);
  return refreshPageImages(job);
}
async function renderAllPages(job) {
  const prefix = path.join(job.dir, "page");
  await run(pdftoppm, ["-png", "-r", "170", job.pdf, prefix]);
  return refreshPageImages(job);
}
async function scanPage(job, page, totalPages) {
  const image = job.pageImages.find((name) => Number(name.match(/\d+/)[0]) === page);
  if (!image) throw new Error(`第 ${page} 页渲染失败`);
  emit(job, "status", {
    stage: 2,
    message: `正在扫描第 ${page} / ${totalPages} 页`,
    progress: 18 + Math.round(((page - 1) / totalPages) * 72),
    current: page,
    total: totalPages,
  });
  const result = await recognizePage(path.join(job.dir, image), page, totalPages, job.template, job);
  job.results.push(result);
  job.summary = summarize(job.template, job.results, job.reviews);
  emit(job, "page", { result, summary: job.summary });
}
async function processJob(job) {
  try {
    job.status = "rendering";
    emit(job, "status", {
      stage: 1,
      message: "正在读取 PDF 页数",
      progress: 3,
    });
    let totalPages, staged = true;
    try {
      totalPages = await getPdfPageCount(job.pdf);
      emit(job, "status", { stage: 1, message: "正在优先渲染前 10 页", progress: 5 });
      await renderPageRange(job, 1, Math.min(10, totalPages));
    } catch {
      staged = false;
      emit(job, "status", { stage: 1, message: "正在使用兼容模式渲染 PDF", progress: 5 });
      await renderAllPages(job);
      totalPages = job.pageImages.length;
    }
    if (!job.pageImages.length) throw new Error("PDF 中没有可识别页面");
    emit(job, "status", {
      stage: 1,
      message: "正在识别人员名单和评价档次",
      progress: 10,
    });
    job.template =
      job.templateOverride ||
      (await recognizeTemplate(path.join(job.dir, job.pageImages[0]), job));
    job.templatePath = path.join(job.dir, "template.json");
    await fsp.writeFile(
      job.templatePath,
      JSON.stringify(job.template, null, 2),
      "utf8",
    );
    emit(job, "template", { template: job.template });
    job.status = "scanning";
    const initialPages = staged ? Math.min(10, totalPages) : totalPages;
    for (let page = 1; page <= initialPages; page++) await scanPage(job, page, totalPages);
    if (staged)
      for (let start = 11; start <= totalPages; start += RENDER_BATCH_SIZE) {
        const end = Math.min(totalPages, start + RENDER_BATCH_SIZE - 1);
        emit(job, "status", { stage: 2, message: `正在准备第 ${start}—${end} 页`, progress: 18 + Math.round(((start - 1) / totalPages) * 72) });
        await renderPageRange(job, start, end);
        for (let page = start; page <= end; page++) await scanPage(job, page, totalPages);
      }
    job.status = "done";
    emit(job, "status", {
      stage: 3,
      message: "统计完成，等待复核或导出",
      progress: 100,
    });
    job.summary = summarize(job.template, job.results, job.reviews);
    emit(job, "done", {
      summary: job.summary,
      engine: job.results[0]?.engine,
    });
  } catch (e) {
    job.status = "error";
    job.error = e.message;
    emit(job, "joberror", { message: e.message });
  }
}
async function newJobFromRequest(req, filename = "ballots.pdf", templateOverride = null) {
  const declaredSize = Number(req.headers["content-length"] || 0);
  if (declaredSize > MAX_PDF_BYTES) throw new Error("PDF 文件不能超过 100MB");
  const id = crypto.randomBytes(4).toString("hex"),
    dir = path.join(workDir, id);
  await fsp.mkdir(dir, { recursive: true });
  const pdf = path.join(dir, "input.pdf");
  const file = await fsp.open(pdf, "w");
  let size = 0;
  let header = Buffer.alloc(0);
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_PDF_BYTES) throw new Error("PDF 文件不能超过 100MB");
      if (header.length < 4)
        header = Buffer.concat([header, chunk.subarray(0, 4 - header.length)]);
      await file.write(chunk);
    }
  } catch (error) {
    await file.close().catch(() => {});
    await fsp.rm(dir, { recursive: true, force: true });
    throw error;
  }
  await file.close();
  if (header.toString() !== "%PDF") {
    await fsp.rm(dir, { recursive: true, force: true });
    throw new Error("请上传有效的 PDF 文件");
  }
  const job = {
    id,
    filename,
    dir,
    pdf,
    templateOverride,
    status: "queued",
    template: null,
    results: [],
    events: [],
    listeners: new Set(),
    pageImages: [],
    reviews: {},
  };
  jobs.set(id, job);
  setImmediate(() => processJob(job));
  return job;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "POST" && url.pathname === "/api/analyze") {
      let custom = null;
      if (req.headers["x-template"]) {
        custom = JSON.parse(
          Buffer.from(String(req.headers["x-template"]), "base64").toString("utf8"),
        );
        if (
          !Array.isArray(custom.people) ||
          !Array.isArray(custom.categories) ||
          !custom.people.length ||
          custom.categories.length < 2
        )
          throw new Error("模板配置不完整");
      }
      const job = await newJobFromRequest(
        req,
        decodeURIComponent(req.headers["x-filename"] || "ballots.pdf"),
        custom,
      );
      return json(res, 202, {
        id: job.id,
        engine: "offline",
      });
    }
    const ev = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
    if (ev) {
      const job = jobs.get(ev[1]);
      if (!job) return json(res, 404, { error: "任务不存在" });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      for (const x of job.events)
        res.write(`event: ${x.type}\ndata: ${JSON.stringify(x.data)}\n\n`);
      job.listeners.add(res);
      req.on("close", () => job.listeners.delete(res));
      return;
    }
    const image = url.pathname.match(/^\/api\/jobs\/([^/]+)\/pages\/(\d+)$/);
    if (image) {
      const job = jobs.get(image[1]),
        f = job && job.pageImages[Number(image[2]) - 1];
      if (!f) return json(res, 404, { error: "页面不存在" });
      res.writeHead(200, { "Content-Type": "image/png" });
      return fs.createReadStream(path.join(job.dir, f)).pipe(res);
    }
    const state = url.pathname.match(/^\/api\/jobs\/([^/]+)\/state$/);
    if (req.method === "GET" && state) {
      const job = jobs.get(state[1]);
      if (!job) return json(res, 404, { error: "任务不存在" });
      return json(res, 200, {
        id: job.id,
        status: job.status,
        template: job.template,
        summary: job.summary,
      });
    }
    const blankReview = url.pathname.match(
      new RegExp("^/api/jobs/([^/]+)/review/blanks$"),
    );
    if (req.method === "POST" && blankReview) {
      const job = jobs.get(blankReview[1]);
      if (!job?.template)
        return json(res, 409, { error: "选票结构尚未识别完成" });
      const { category } = JSON.parse(
        (await readBody(req, 64 * 1024)).toString("utf8"),
      );
      if (!job.template.categories.includes(category))
        return json(res, 400, { error: "批量确认等次不属于当前选票模板" });
      const blanks = (job.summary?.reviewItems || []).filter((item) => {
        const key = `${item.page}:${item.serial}`;
        return (
          item.recognizedCategory === "空白" &&
          !Object.hasOwn(job.reviews, key)
        );
      });
      for (const item of blanks) {
        const key = `${item.page}:${item.serial}`;
        job.reviews[key] = category;
      }
      job.summary = summarize(job.template, job.results, job.reviews);
      emit(job, "summary", { summary: job.summary });
      return json(res, 200, { updated: blanks.length, summary: job.summary });
    }
    const review = url.pathname.match(/^\/api\/jobs\/([^/]+)\/review$/);
    if (req.method === "POST" && review) {
      const job = jobs.get(review[1]);
      if (!job?.template) return json(res, 409, { error: "选票结构尚未识别完成" });
      const { page, serial, category } = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8"));
      if (!Number.isInteger(page) || !Number.isInteger(serial))
        return json(res, 400, { error: "复核定位信息无效" });
      if (category !== null && !(job.template.categories.includes(category) || category === "空白"))
        return json(res, 400, { error: "复核等次不属于当前选票模板" });
      const key = `${page}:${serial}`;
      if (category === null) delete job.reviews[key];
      else job.reviews[key] = category;
      job.summary = summarize(job.template, job.results, job.reviews);
      emit(job, "summary", { summary: job.summary });
      return json(res, 200, { summary: job.summary });
    }
    const xlsx = url.pathname.match(/^\/api\/jobs\/([^/]+)\/export\/xlsx$/);
    if (req.method === "POST" && xlsx) {
      const job = jobs.get(xlsx[1]);
      if (!job || job.status !== "done")
        return json(res, 409, { error: "统计尚未完成" });
      job.summary = summarize(job.template, job.results, job.reviews);
      await fsp.writeFile(
        path.join(job.dir, "result.json"),
        JSON.stringify({ template: job.template, results: job.results, reviews: job.reviews, summary: job.summary }, null, 2),
        "utf8",
      );
      await createXlsx(job);
      return json(res, 200, {
        filename: job.outputFilename,
        url: `/api/jobs/${job.id}/export/xlsx`,
      });
    }
    if (req.method === "GET" && xlsx) {
      const job = jobs.get(xlsx[1]);
      if (!job?.outputXlsx || !fs.existsSync(job.outputXlsx))
        return json(res, 409, { error: "汇总表尚未生成" });
      res.writeHead(200, {
        "Content-Type": mime[".xlsx"],
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.outputFilename)}`,
      });
      return fs.createReadStream(job.outputXlsx).pipe(res);
    }
    let rel =
      url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname.slice(1));
    const target = path.normalize(path.join(publicDir, rel));
    if (!target.startsWith(publicDir) || !fs.existsSync(target))
      return json(res, 404, { error: "未找到" });
    res.writeHead(200, {
      "Content-Type": mime[path.extname(target)] || "application/octet-stream",
    });
    fs.createReadStream(target).pipe(res);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`统票票 running at http://127.0.0.1:${port}`),
);
