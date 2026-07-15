import fs from "node:fs/promises";

const enc = (value) => Buffer.from(value, "utf8");
const xml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
const col = (index) => { let out = ""; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out; return out; };
function crc32(bytes) { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
function zipStore(entries) {
  const chunks = [], central = []; let offset = 0;
  for (const [name, content] of entries) {
    const file = typeof content === "string" ? enc(content) : content, nameBytes = enc(name), crc = crc32(file);
    const local = Buffer.alloc(30 + nameBytes.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(file.length, 18); local.writeUInt32LE(file.length, 22); local.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(local, 30);
    const header = Buffer.alloc(46 + nameBytes.length); header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt32LE(crc, 16); header.writeUInt32LE(file.length, 20); header.writeUInt32LE(file.length, 24); header.writeUInt16LE(nameBytes.length, 28); header.writeUInt32LE(offset, 42); nameBytes.copy(header, 46);
    chunks.push(local, file); central.push(header); offset += local.length + file.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}
function cell(row, index, value, style = 4) {
  if (value === null || value === undefined || value === "") return "";
  const ref = `${col(index)}${row}`;
  if (typeof value === "number") return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
}
function sheet(rows, widths, merges = [], stylesByRow = {}) {
  const data = rows.map((values, i) => { const style = stylesByRow[i] ?? (i === 0 ? 1 : i === 1 ? 2 : 4); return `<row r="${i + 1}">${values.map((value, colIndex) => cell(i + 1, colIndex, value, style)).join("")}</row>`; }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${data}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map((range) => `<mergeCell ref="${range}"/>`).join("")}</mergeCells>` : ""}</worksheet>`;
}
const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font><font><b/><sz val="10"/><color rgb="FF174D3C"/><name val="Microsoft YaHei"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF087A58"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F3EE"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs></styleSheet>`;

export async function buildXlsx(inputPath, outputPath) {
  const { template, results, summary } = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const categories = template.categories;
  const blocks = Math.max(1, Math.min(2, Number(template.layout?.blocks || 1)));
  const blockWidth = categories.length + 2, gap = blocks === 2 ? 1 : 0;
  const totalCols = blockWidth * blocks + gap, splitAt = Math.ceil(summary.counts.length / blocks);
  const peopleByBlock = Array.from({ length: blocks }, (_, index) => summary.counts.slice(index * splitAt, (index + 1) * splitAt));
  const starts = Array.from({ length: blocks }, (_, index) => index * (blockWidth + gap));
  const blankRow = () => Array(totalCols).fill("");
  const summaryRows = [[`${template.title} - 汇总结果`], [`共统计 ${summary.pages} 页 · 累计识别 ${summary.marks} 个勾选`], blankRow(), blankRow(), blankRow()];
  const merges = [`A1:${col(totalCols - 1)}1`, `A2:${col(totalCols - 1)}2`];
  for (const start of starts) {
    summaryRows[3][start] = "序号"; summaryRows[3][start + 1] = "姓名"; summaryRows[3][start + 2] = "档次票数";
    categories.forEach((name, index) => { summaryRows[4][start + 2 + index] = name; });
    merges.push(`${col(start)}4:${col(start)}5`, `${col(start + 1)}4:${col(start + 1)}5`, `${col(start + 2)}4:${col(start + blockWidth - 1)}4`);
  }
  const maxRows = Math.max(...peopleByBlock.map((people) => people.length));
  for (let row = 0; row < maxRows; row++) {
    const values = blankRow();
    starts.forEach((start, block) => {
      const person = peopleByBlock[block][row];
      if (person) values.splice(start, blockWidth, person.serial, person.name, ...(person.evaluable ? categories.map((name) => person.values[name]) : ["不确定等次", ...Array(Math.max(0, categories.length - 1)).fill("")]));
    });
    summaryRows.push(values);
  }
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="汇总结果" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", styles],
    ["xl/worksheets/sheet1.xml", sheet(summaryRows, starts.flatMap(() => [8, 14, ...categories.map(() => 12), ...(gap ? [3] : [])]).slice(0, totalCols), merges, { 3: 3, 4: 3 })],
  ];
  await fs.writeFile(outputPath, zipStore(files));
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  await buildXlsx(process.argv[2], process.argv[3]);
}
