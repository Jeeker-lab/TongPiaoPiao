import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { PNG } from "pngjs";

const EXPECTED_X = [
  0.055, 0.118, 0.21, 0.287, 0.364, 0.441, 0.517, 0.578, 0.669, 0.746, 0.822,
  0.899, 0.974,
];
const MIN_MARK_SCORE = 120;
const COMMON_CATEGORIES = ["优秀", "合格", "基本合格", "不合格"];

function localPeak(values, expected, radius) {
  const lo = Math.max(0, Math.round(expected) - radius);
  const hi = Math.min(values.length, Math.round(expected) + radius + 1);
  let best = lo;
  for (let i = lo + 1; i < hi; i++) if (values[i] > values[best]) best = i;
  return best;
}
function median(values) {
  const a = [...values].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function largestComponent(mask, h, w) {
  const seen = new Uint8Array(mask.length);
  let best = { size: 0, width: 0, height: 0 };
  const qy = new Int32Array(mask.length);
  const qx = new Int32Array(mask.length);
  for (let sy = 0; sy < h; sy++)
    for (let sx = 0; sx < w; sx++) {
      const start = sy * w + sx;
      if (!mask[start] || seen[start]) continue;
      let head = 0,
        tail = 0,
        size = 0,
        minX = sx,
        maxX = sx,
        minY = sy,
        maxY = sy;
      qy[tail] = sy;
      qx[tail++] = sx;
      seen[start] = 1;
      while (head < tail) {
        const cy = qy[head];
        const cx = qx[head++];
        size++;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const ny = cy + dy;
            const nx = cx + dx;
            if (ny < 0 || nx < 0 || ny >= h || nx >= w) continue;
            const idx = ny * w + nx;
            if (mask[idx] && !seen[idx]) {
              seen[idx] = 1;
              qy[tail] = ny;
              qx[tail++] = nx;
            }
          }
      }
      if (size > best.size)
        best = { size, width: maxX - minX + 1, height: maxY - minY + 1 };
    }
  return best;
}
function hScores(data, w, h, x1, x2, threshold = 185) {
  const out = new Float64Array(h);
  const span = x2 - x1;
  for (let y = 0; y < h; y++) {
    let n = 0;
    const off = y * w;
    for (let x = x1; x < x2; x++) if (data[off + x] < threshold) n++;
    out[y] = n / span;
  }
  return out;
}
function clusters(values, threshold) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    if (i < values.length && values[i] >= threshold) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      let best = start;
      for (let j = start + 1; j < i; j++)
        if (values[j] > values[best]) best = j;
      out.push({ pos: best, score: values[best], width: i - start });
      start = -1;
    }
  }
  return out;
}
function pageLines(data, w, h, side) {
  const [x1, x2] =
    side === 0
      ? [Math.floor(0.205 * w), Math.floor(0.518 * w)]
      : [Math.floor(0.665 * w), Math.floor(0.976 * w)];
  const score = hScores(data, w, h, x1, x2);
  const base = localPeak(score, 0.136 * h, Math.floor(0.012 * h));
  const step = 0.0277 * h;
  const lines = [];
  for (let i = 0; i < 29; i++)
    lines.push(localPeak(score, base + i * step, Math.floor(0.008 * h)));
  const diffs = lines.slice(1).map((v, i) => v - lines[i]);
  lines.push(lines.at(-1) + Math.round(median(diffs)));
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i] - lines[i - 1];
    if (d < 0.018 * h || d > 0.037 * h)
      throw new Error("未能稳定定位表格横线，请提高扫描清晰度或校正页面方向");
  }
  return lines;
}
function rowVerticals(data, w, h, y1, y2) {
  const top = Math.max(0, y1 + 5);
  const bottom = Math.min(h, y2 - 5);
  const span = Math.max(1, bottom - top);
  const score = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = top; y < bottom; y++) if (data[y * w + x] < 175) n++;
    score[x] = n / span;
  }
  const lines = EXPECTED_X.map((p) =>
    localPeak(score, p * w, Math.floor(0.018 * w)),
  );
  for (let i = 1; i < lines.length; i++)
    if (lines[i] - lines[i - 1] < 0.035 * w)
      throw new Error("未能稳定定位表格竖线，请检查页面裁切范围");
  return lines;
}
function cellMarkEvidence(data, w, top, bottom, left, right) {
  const h = bottom - top;
  const cw = right - left;
  const mask = new Uint8Array(h * cw);
  let strong = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < cw; x++) {
      const v = data[(top + y) * w + left + x];
      const i = y * cw + x;
      if (v < 135) strong++;
      if (v < 185) mask[i] = 1;
    }
  const component = largestComponent(mask, h, cw);
  const score = strong + 4 * component.size;
  const fill = component.size / Math.max(1, component.width * component.height);
  return {
    score,
    check:
      score >= MIN_MARK_SCORE &&
      component.width >= 8 &&
      component.height >= 8 &&
      component.width >= component.height * 0.35 &&
      fill <= 0.3,
  };
}
function genericVerticals(data, w, h, expected) {
  let cand = detectVerticals(data, w, h);
  if (cand.length > expected)
    cand = cand
      .map((pos) => ({ pos, score: 1 }))
      .slice(0, expected)
      .map((c) => c.pos);
  if (cand.length !== expected)
    throw new Error(
      `自动检测到 ${cand.length} 条表格竖线，模板需要 ${expected} 条；请调整模板分栏数或扫描裁切`,
    );
  return cand;
}
function genericRows(data, w, h, x1, x2, rowCount) {
  const lines = detectDataRows(data, w, h, x1, x2);
  const need = rowCount + 1;
  if (lines.length === need) return lines;
  if (lines.length > need) return lines.slice(0, need);
  throw new Error("无法自动定位表格横线，请确认模板为规则表格");
}
function refineVerticals(data, w, top, bottom, base) {
  const score = new Float64Array(w);
  const y1 = Math.max(0, top + 5);
  const y2 = Math.min(bottom - 5, Math.floor(data.length / w));
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = y1; y < y2; y++) if (data[y * w + x] < 175) n++;
    score[x] = n / Math.max(1, y2 - y1);
  }
  return base.map((x) => localPeak(score, x, Math.floor(0.018 * w)));
}
function detectVerticals(data, w, h) {
  const y1 = Math.floor(0.43 * h);
  const y2 = Math.floor(0.57 * h);
  const score = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = y1; y < y2; y++) if (data[y * w + x] < 175) n++;
    score[x] = n / (y2 - y1);
  }
  return clusters(score, 0.3)
    .filter((c) => c.width >= 2 || c.score > 0.62)
    .map((c) => c.pos);
}
function detectDataRows(data, w, h, x1, x2) {
  const cand = clusters(hScores(data, w, h, x1, x2), 0.3).filter(
    (c) => c.pos > 0.08 * h && c.pos < 0.97 * h,
  );
  let best = null;
  for (let a = 0; a < cand.length - 1; a++)
    for (let b = a + 1; b < Math.min(cand.length, a + 8); b++) {
      const pitch = cand[b].pos - cand[a].pos;
      if (pitch < 0.015 * h || pitch > 0.045 * h) continue;
      const lines = [cand[a].pos, cand[b].pos];
      let last = cand[b].pos;
      let quality = cand[a].score + cand[b].score;
      while (true) {
        const target = last + pitch;
        let pick = -1;
        let dist = Infinity;
        for (let i = 0; i < cand.length; i++) {
          const d = Math.abs(cand[i].pos - target);
          if (d < dist) {
            dist = d;
            pick = i;
          }
        }
        if (dist < pitch * 0.3) {
          lines.push(cand[pick].pos);
          quality += cand[pick].score - dist / pitch;
          last = cand[pick].pos;
        } else break;
      }
      const score = lines.length * 1000 + quality;
      if (lines.length >= 6 && (!best || score > best.score))
        best = { score, lines };
    }
  if (!best) throw new Error("无法自动定位表格横线，请确认模板为规则表格");
  return best.lines;
}
function tableLayout(data, w, h) {
  const verticals = detectVerticals(data, w, h);
  let blocks = 1;
  let categories = verticals.length - 3;
  if ((verticals.length - 1) % 2 === 0) {
    const c = (verticals.length - 1) / 2 - 2;
    if (c >= 2 && c <= 8) {
      blocks = 2;
      categories = c;
    }
  }
  if (categories < 2 || categories > 10)
    throw new Error("未能自动识别选项列，请确认第一页是规则选票表格");
  const blockLines =
    blocks === 1
      ? [verticals]
      : [verticals.slice(0, categories + 3), verticals.slice(categories + 2)];
  const rowLines = blockLines.map((lines) =>
    detectDataRows(data, w, h, lines[2], lines.at(-1)),
  );
  return { blocks, categories, blockLines, rowLines };
}
function knownEvaluationLayout(data, w, h) {
  try {
    const rowLines = [pageLines(data, w, h, 0), pageLines(data, w, h, 1)];
    const verticals = rowVerticals(data, w, h, rowLines[0][5], rowLines[0][6]);
    return {
      blocks: 2,
      categories: 4,
      blockLines: [verticals.slice(0, 7), verticals.slice(6, 13)],
      rowLines,
    };
  } catch {
    return null;
  }
}
async function readPng(imagePath) {
  const png = PNG.sync.read(await fs.readFile(imagePath));
  const w = png.width;
  const h = png.height;
  const data = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < png.data.length; i += 4, j++)
    data[j] = Math.round(
      0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2],
    );
  return { png, data, w, h };
}
function psOcrScript() {
  return String.raw`
param([string]$Path)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation') } | Select-Object -First 1)
function Await($op, [type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait() | Out-Null
  $task.Result
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('zh-CN'))
if ($null -eq $engine) { throw '本机未安装 Windows 中文 OCR 组件' }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$words = foreach ($line in $result.Lines) {
  foreach ($word in $line.Words) {
    $r = $word.BoundingRect
    [pscustomobject]@{ text = $word.Text; x = [double]$r.X; y = [double]$r.Y; w = [double]$r.Width; h = [double]$r.Height }
  }
}
[pscustomobject]@{ text = $result.Text; words = @($words) } | ConvertTo-Json -Depth 5 -Compress
`;
}
function runOcr(imagePath) {
  return new Promise(async (resolve, reject) => {
    const absImagePath = path.resolve(imagePath);
    const ps1 = `${absImagePath}.ocr.ps1`;
    await fs.writeFile(ps1, psOcrScript(), "utf8");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Path", absImagePath],
      { windowsHide: true },
    );
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", async (code) => {
      await fs.unlink(ps1).catch(() => {});
      if (code !== 0) return reject(new Error(err || `Windows OCR exited ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("Windows OCR 返回内容无法解析"));
      }
    });
  });
}
function cleanCellText(text) {
  return String(text || "")
    .replace(/\s+/g, "")
    .replace(/[|丨／/\\、，。:：;；()（）[\]【】"'‘’“”_~·\-—]/g, "")
    .replace(/[^\p{Script=Han}A-Za-z0-9]/gu, "");
}
function wordsInBox(words, left, top, right, bottom, pad = 2) {
  return words
    .filter((word) => {
      const cx = word.x + word.w / 2;
      const cy = word.y + word.h / 2;
      return (
        cx >= left - pad &&
        cx <= right + pad &&
        cy >= top - pad &&
        cy <= bottom + pad
      );
    })
    .sort((a, b) => (Math.abs(a.y - b.y) > 12 ? a.y - b.y : a.x - b.x));
}
function textInBox(words, left, top, right, bottom) {
  return cleanCellText(wordsInBox(words, left, top, right, bottom).map((w) => w.text).join(""));
}
function categoryText(words, lines, rowTop, h, index) {
  const top = Math.max(0, rowTop - 0.105 * h);
  const bottom = rowTop - 2;
  return textInBox(words, lines[2 + index], top, lines[3 + index], bottom);
}
function defaultTitle(words, rowTop, w) {
  const topWords = wordsInBox(words, 0, 0, w, rowTop * 0.55);
  const title = cleanCellText(topWords.map((x) => x.text).join(""));
  return title || "选票统计表";
}
function normalizeCategory(text, index, count) {
  const value = cleanCellText(text);
  if (value.includes("优秀") || value.includes("优")) return "优秀";
  if (value.includes("不合格") || (value.includes("不") && value.includes("合格")))
    return "不合格";
  if (value.includes("基本合格") || (value.includes("基本") && value.includes("合格")))
    return "基本合格";
  if (value.includes("合格")) return "合格";
  if (count === 4) return COMMON_CATEGORIES[index];
  return value;
}
function inferCategories(words, layout, h) {
  const tryBlock = (block) => {
    const lines = layout.blockLines[block];
    const rowTop = layout.rowLines[block][0];
    return Array.from({ length: layout.categories }, (_, i) =>
      categoryText(words, lines, rowTop, h, i),
    );
  };
  let cats = tryBlock(0);
  if (cats.filter(Boolean).length < Math.max(2, Math.floor(layout.categories / 2)) && layout.blocks > 1)
    cats = tryBlock(1);
  if (layout.categories === 4) {
    cats = cats.map((c, i) => normalizeCategory(c, i, layout.categories));
    const joined = cats.join("");
    if (!joined.includes("优") || !joined.includes("合")) cats = COMMON_CATEGORIES;
  }
  return cats.map((c, i) => c || `选项${i + 1}`);
}
function inferPeople(words, layout) {
  const rowsPerBlock = Math.max(...layout.rowLines.map((x) => x.length - 1));
  const people = [];
  for (let b = 0; b < layout.blocks; b++) {
    const lines = layout.blockLines[b];
    const rows = layout.rowLines[b];
    for (let r = 0; r < rows.length - 1; r++) {
      const serial = b * rowsPerBlock + r + 1;
      const top = rows[r];
      const bottom = rows[r + 1];
      const rawName = textInBox(words, lines[1], top, lines[2], bottom);
      const name = rawName.replace(/^\d+/, "") || `第${serial}号`;
      const optionText = textInBox(words, lines[2], top, lines.at(-1), bottom);
      const evaluable = !/不确定|等次|不定|不确/.test(optionText);
      people.push({ serial, name, evaluable });
    }
  }
  return people;
}

function candidateNameScore(name, frequency = 1) {
  const cleaned = cleanCellText(name);
  if (!cleaned || /^第\d+号$/.test(cleaned)) return -1000;
  const hanCount = (cleaned.match(/\p{Script=Han}/gu) || []).length;
  const lengthScore = Math.min(hanCount, 4) * 10;
  const singleCharPenalty = hanCount <= 1 ? -8 : 0;
  return lengthScore + frequency * 2 + singleCharPenalty;
}
function isKnownEvaluationSheet(template) {
  return (
    template.layout?.blocks === 2 &&
    template.categories.length === 4 &&
    template.people.length === 58
  );
}
function mergePeopleBySerial(templates) {
  const first = templates[0];
  const targetPeople = first.people.length;
  const rowsPerFirstBlock = Math.ceil(targetPeople / Math.max(1, first.layout?.blocks || 1));
  const sameShapeTemplates = templates.filter((t) => t.people.length === targetPeople);
  const merged = [];
  for (let i = 0; i < targetPeople; i++) {
    const serial = i + 1;
    const sourceTemplates =
      serial <= rowsPerFirstBlock || sameShapeTemplates.length < 2
        ? templates
        : sameShapeTemplates;
    const byName = new Map();
    let falseVotes = 0;
    let trueVotes = 0;
    for (const t of sourceTemplates) {
      const p = t.people[i];
      if (!p) continue;
      if (p.evaluable === false) falseVotes++;
      else trueVotes++;
      const name = cleanCellText(p.name);
      if (!name) continue;
      byName.set(name, (byName.get(name) || 0) + 1);
    }
    let bestName = "";
    let bestScore = -Infinity;
    for (const [name, frequency] of byName) {
      const score = candidateNameScore(name, frequency);
      if (score > bestScore) {
        bestScore = score;
        bestName = name;
      }
    }
    const evaluable = isKnownEvaluationSheet(first)
      ? serial <= 54
      : falseVotes > trueVotes
        ? false
        : true;
    merged.push({
      serial,
      name: bestScore > 0 ? bestName : `第${serial}号`,
      evaluable,
    });
  }
  return merged;
}
function mergeTemplates(templates) {
  const first = templates[0];
  return {
    ...first,
    people: mergePeopleBySerial(templates),
    engine:
      templates.length > 1
        ? `windows-ocr-template-v2-merged-${templates.length}p`
        : "windows-ocr-template-v2",
  };
}
function buildReviewRegions(layout, w, h) {
  const rowsPerBlock = Math.max(...layout.rowLines.map((x) => x.length - 1));
  const reviewRegions = {};
  for (let block = 0; block < layout.blocks; block++) {
    const lines = layout.blockLines[block];
    const rows = layout.rowLines[block];
    for (let row = 0; row < rows.length - 1; row++) {
      const serial = block * rowsPerBlock + row + 1;
      const left = Math.max(0, lines[0]);
      const right = Math.min(w, lines.at(-1));
      const top = Math.max(0, rows[row]);
      const bottom = Math.min(h, rows[row + 1]);
      reviewRegions[serial] = {
        x: left / w,
        y: top / h,
        width: (right - left) / w,
        height: (bottom - top) / h,
      };
    }
  }
  return reviewRegions;
}
async function recognizeTemplateSingle(imagePath) {
  const { data, w, h } = await readPng(imagePath);
  const layout = knownEvaluationLayout(data, w, h) || tableLayout(data, w, h);
  const ocr = await runOcr(imagePath);
  const words = Array.isArray(ocr.words) ? ocr.words : [];
  const categories = inferCategories(words, layout, h);
  const people = inferPeople(words, layout);
  return {
    title: defaultTitle(words, Math.min(...layout.rowLines.map((x) => x[0])), w),
    categories,
    people,
    layout: {
      generic: !(layout.blocks === 2 && layout.categories === 4 && people.length === 58),
      blocks: layout.blocks,
      reviewRegions: buildReviewRegions(layout, w, h),
    },
    engine: "windows-ocr-template-v1",
  };
}

export async function recognizeTemplateLocal(imagePath, options = {}) {
  const candidates = [imagePath, ...(options.extraImages || [])]
    .map((x) => path.resolve(x))
    .filter((x, i, a) => a.indexOf(x) === i)
    .slice(0, options.maxPages || 10);
  const templates = [];
  for (const candidate of candidates) {
    try {
      templates.push(await recognizeTemplateSingle(candidate));
    } catch (error) {
      if (!templates.length) throw error;
    }
  }
  return mergeTemplates(templates);
}

async function recognizeGeneric(data, w, h, template) {
  const cats = template.categories;
  const people = template.people;
  const blocks = Math.max(1, Math.min(2, Number(template.layout?.blocks || 1)));
  const rowsPerBlock = Math.ceil(people.length / blocks);
  const expected = blocks * (cats.length + 2) + 1;
  const base = genericVerticals(data, w, h, expected);
  const blockLines = [];
  if (blocks === 1) blockLines.push(base);
  else {
    const cut = cats.length + 2;
    blockLines.push(base.slice(0, cut + 1), base.slice(cut));
  }
  const horizontal = blockLines.map((lines) =>
    genericRows(data, w, h, lines[2], lines.at(-1), rowsPerBlock),
  );
  const selections = [];
  const diagnostics = [];
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    if (p.evaluable === false) continue;
    const block = Math.min(blocks - 1, Math.floor(i / rowsPerBlock));
    const row = i % rowsPerBlock;
    const top = horizontal[block][row];
    const bottom = horizontal[block][row + 1];
    const v = refineVerticals(data, w, top, bottom, blockLines[block]);
    const edges = v.slice(-cats.length - 1);
    const evidence = [];
    for (let j = 0; j < cats.length; j++) {
      const px = Math.max(5, Math.floor((edges[j + 1] - edges[j]) * 0.09));
      const py = Math.max(5, Math.floor((bottom - top) * 0.12));
      evidence.push(
        cellMarkEvidence(data, w, top + py, bottom - py, edges[j] + px, edges[j + 1] - px),
      );
    }
    const scores = evidence.map((item) => item.score);
    const order = scores.map((_, j) => j).sort((a, b) => scores[b] - scores[a]);
    const preferred = evidence.findIndex((item) => item.check);
    const best = preferred >= 0 ? preferred : order[0];
    const second = order[1] ?? best;
    const margin = (scores[best] + 1) / (scores[second] + 1);
    const detected = scores[best] >= MIN_MARK_SCORE;
    const confidence = Math.min(0.999, Math.max(0.5, 0.7 + Math.min(margin - 1, 1.5) * 0.19));
    if (detected)
      selections.push({
        serial: p.serial,
        name: p.name,
        category: cats[best],
        confidence: Number(confidence.toFixed(3)),
      });
    diagnostics.push({
      serial: p.serial,
      scores,
      margin: Number(margin.toFixed(3)),
      detected,
    });
  }
  return { selections, diagnostics, engine: "local-generic-grid-v1", imageSize: [w, h] };
}

export async function recognizeLocal(imagePath, template) {
  const { data, w, h } = await readPng(imagePath);
  if (template.layout?.generic) return recognizeGeneric(data, w, h, template);
  const categories = template.categories;
  const people = template.people;
  if (categories.length !== 4 || people.length !== 58)
    throw new Error("请先为新选票创建模板配置");
  const sides = [pageLines(data, w, h, 0), pageLines(data, w, h, 1)];
  const selections = [];
  const diagnostics = [];
  for (const person of people) {
    if (!person.evaluable) continue;
    const serial = Number(person.serial);
    const side = serial <= 29 ? 0 : 1;
    const row = (serial - 1) % 29;
    const top = sides[side][row];
    const bottom = sides[side][row + 1];
    const verticals = rowVerticals(data, w, h, top, bottom);
    const edges = side === 0 ? verticals.slice(2, 7) : verticals.slice(8, 13);
    const evidence = [];
    for (let j = 0; j < 4; j++) {
      const px = Math.max(6, Math.floor((edges[j + 1] - edges[j]) * 0.1));
      const py = Math.max(6, Math.floor((bottom - top) * 0.13));
      evidence.push(
        cellMarkEvidence(data, w, top + py, bottom - py, edges[j] + px, edges[j + 1] - px),
      );
    }
    const scores = evidence.map((item) => item.score);
    const order = [0, 1, 2, 3].sort((a, b) => scores[b] - scores[a]);
    const preferred = evidence.findIndex((item) => item.check);
    const best = preferred >= 0 ? preferred : order[0];
    const second = order[1];
    const margin = (scores[best] + 1) / (scores[second] + 1);
    const confidence = Math.min(0.999, Math.max(0.5, 0.7 + Math.min(margin - 1, 1.5) * 0.19));
    const detected = scores[best] >= MIN_MARK_SCORE;
    if (detected)
      selections.push({
        serial,
        name: person.name,
        category: categories[best],
        confidence: Number(confidence.toFixed(3)),
      });
    diagnostics.push({ serial, scores, margin: Number(margin.toFixed(3)), detected });
  }
  return { selections, diagnostics, engine: "local-grid-js-v3", imageSize: [w, h] };
}
