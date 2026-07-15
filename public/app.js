const $ = (s) => document.querySelector(s);
let jobId,
  totalPages = 0,
  template = null,
  summary = null;
const upload = $("#upload"),
  file = $("#file"),
  tplSelect = $("#templateSelect");
let templates = JSON.parse(localStorage.getItem("ballotTemplates") || "[]");
let jobEvents = null;

$("#openReview").onclick = () => {
  if (!jobId) return;
  window.open(`/review.html?job=${encodeURIComponent(jobId)}`, `ballot-review-${jobId}`, "width=1180,height=820");
};
$("#xlsx").onclick = async () => {
  if (!jobId || $("#xlsx").disabled) return;
  const button = $("#xlsx");
  button.disabled = true;
  button.textContent = "正在导出…";
  try {
    const response = await fetch(`/api/jobs/${jobId}/export/xlsx`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "导出失败");
    alert(`${data.filename} 已保存到桌面。`);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "导出 Excel 汇总表";
  }
};

function esc(v) {
  return String(v ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
}
function renderTemplates() {
  tplSelect.innerHTML =
    '<option value="">自动从 PDF 识别模板</option>' +
    templates
      .map((t, i) => `<option value="${i}">${esc(t.name)}</option>`)
      .join("");
}
renderTemplates();

$("#newTemplate").onclick = () => $("#templateDialog").showModal();
$("#saveTemplate").onclick = () => {
  const names = $("#tplPeople")
    .value.split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^\d+[.、\s-]*/, ""));
  const cats = $("#tplCategories")
    .value.split(/[,，、]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (names.length < 2 || cats.length < 2)
    return alert("请至少填写 2 名人员和 2 个评价选项");
  const t = {
    name: $("#tplName").value.trim() || "自定义模板",
    title:
      $("#tplTitle").value.trim() || $("#tplName").value.trim() || "选票统计表",
    categories: cats,
    people: names.map((name, i) => ({ serial: i + 1, name, evaluable: true })),
    layout: { generic: true, blocks: Number($("#tplBlocks").value) },
  };
  templates.push(t);
  localStorage.setItem("ballotTemplates", JSON.stringify(templates));
  renderTemplates();
  tplSelect.value = String(templates.length - 1);
  $("#templateDialog").close();
};

$("#choose").onclick = () => file.click();
file.onchange = () => file.files[0] && sendFile(file.files[0]);
for (const e of ["dragenter", "dragover"])
  upload.addEventListener(e, (x) => {
    x.preventDefault();
    upload.classList.add("drag");
  });
for (const e of ["dragleave", "drop"])
  upload.addEventListener(e, (x) => {
    x.preventDefault();
    upload.classList.remove("drag");
  });
upload.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) sendFile(f);
});

async function sendFile(f) {
  if (!f.name.toLowerCase().endsWith(".pdf")) return alert("请选择 PDF 文件");
  begin(f.name);
  const headers = {
    "Content-Type": "application/pdf",
    "X-Filename": encodeURIComponent(f.name),
  };
  if (tplSelect.value !== "") {
    const json = JSON.stringify(templates[Number(tplSelect.value)]);
    headers["X-Template"] = btoa(unescape(encodeURIComponent(json)));
  }
  const r = await fetch("/api/analyze", { method: "POST", headers, body: f }),
    d = await r.json();
  if (!r.ok) return fail(d.error);
  connect(d.id);
}
function begin(name) {
  $("#workspace").classList.remove("hidden");
  $("#filename").textContent = name;
  $("#workspace").scrollIntoView({ behavior: "smooth" });
  template = null;
  summary = null;
  renderReviewCount(null);
  $("#openReview").disabled = true;
  $("#xlsx").disabled = true;
  $("#xlsx").classList.add("disabled");
  setProgress(1, 2, "正在准备 PDF");
}
function connect(id) {
  jobId = id;
  if (jobEvents) jobEvents.close();
  const es = new EventSource(`/api/jobs/${id}/events`);
  jobEvents = es;
  es.addEventListener("status", (e) => {
    const d = JSON.parse(e.data);
    setProgress(d.stage, d.progress, d.message);
    if (d.total) {
      totalPages = d.total;
      $("#pagePill").textContent = `${d.current || 0} / ${d.total} 页`;
    }
  });
  es.addEventListener("template", (e) => {
    template = JSON.parse(e.data).template;
    renderTemplate();
    renderMatrix(null);
    renderReviewCount(null);
  });
  es.addEventListener("page", (e) => {
    const d = JSON.parse(e.data);
    summary = d.summary;
    $("#pageImage").src = `/api/jobs/${id}/pages/${d.result.page}`;
    $("#previewEmpty").style.display = "none";
    $("#pagePill").textContent = `${d.result.page} / ${d.result.total} 页`;
    renderMatrix(summary);
    renderReviewCount(summary);
  });
  es.addEventListener("summary", (e) => {
    summary = JSON.parse(e.data).summary;
    renderMatrix(summary);
    renderReviewCount(summary);
  });
  es.addEventListener("done", (e) => {
    const d = JSON.parse(e.data);
    summary = d.summary;
    setProgress(3, 100, "统计完成，可复核后手动导出");
    renderMatrix(summary);
    renderReviewCount(summary);
    $("#xlsx").classList.remove("disabled");
    $("#xlsx").disabled = false;
    $("#openReview").disabled = false;
  });
  es.addEventListener("joberror", (e) => {
    fail(JSON.parse(e.data).message);
    es.close();
    if (jobEvents === es) jobEvents = null;
  });
}
function setProgress(stage, n, text) {
  $("#bar").style.width = n + "%";
  $("#pct").textContent = n + "%";
  $("#progressText").textContent = text;
  document.querySelectorAll(".step").forEach((el, i) => {
    el.classList.toggle("active", i + 1 === stage);
    el.classList.toggle("done", i + 1 < stage);
  });
  if (stage === 1) $("#s1").textContent = text;
  if (stage === 2) {
    $("#s1").textContent = "结构识别完成";
    $("#s2").textContent = text;
  }
  if (stage === 3) {
    $("#s1").textContent = "结构识别完成";
    $("#s2").textContent = "逐页统计完成";
    $("#s3").textContent = text;
  }
}
function renderTemplate() {
  if (!template) return;
  $("#templateState").textContent = "识别完成";
  $("#templateState").classList.add("ok");
  $("#title").textContent = template.title || "未识别标题";
  $("#peopleCount").textContent = template.people.length;
  $("#categoryCount").textContent = template.categories.length;
  $("#peopleMetric").textContent = template.people.length;
  $("#categoryMetric").textContent = template.categories.length;
  $("#names").innerHTML = template.people
    .map(
      (p) =>
        `<span class="person ${p.evaluable ? "" : "muted"}"><i>${p.serial}</i>${esc(p.name)}</span>`,
    )
    .join("");
  $("#categories").innerHTML = template.categories
    .map((c, i) => `<span><i>${i + 1}</i>${esc(c)}</span>`)
    .join("");
  renderWorkspaceMetrics();
}
function renderWorkspaceMetrics(s) {
  $("#metricPeople").dataset.value = String(template?.people?.length || 0);
  $("#metricOptions").dataset.value = String(template?.categories?.length || 0);
  $("#metricMarks").dataset.value = String(s?.marks || 0);
}
function renderMatrix(s) {
  if (!template) return;
  const cats = template.categories;
  $("#matrix thead").innerHTML =
    `<tr><th>序号</th><th>姓名</th>${cats.map((c) => `<th>${esc(c)}</th>`).join("")}<th>小计</th></tr>`;
  const rows =
    s?.counts ||
    template.people.map((p) => ({
      serial: p.serial,
      name: p.name,
      evaluable: p.evaluable,
      values: Object.fromEntries(cats.map((c) => [c, 0])),
    }));
  $("#matrix tbody").innerHTML = rows
    .map(
      (r) =>
        `<tr class="${r.evaluable ? "" : "disabled-row"}"><td>${r.serial}</td><td>${esc(r.name)}</td>${r.evaluable ? cats.map((c) => `<td><b>${r.values[c] || 0}</b></td>`).join("") : `<td colspan="${cats.length}">不确定等次</td>`}<td>${r.evaluable ? cats.reduce((a, c) => a + (r.values[c] || 0), 0) : "—"}</td></tr>`,
    )
    .join("");
  if (s) {
    $("#pages").textContent = s.pages;
    $("#marks").textContent = s.marks;
  }
  renderWorkspaceMetrics(s);
}
function renderReviewCount(s) {
  const pending = s?.review?.length || 0;
  const reviewed = s?.reviewed?.length || 0;
  $("#reviewCount").textContent = `${pending} 人待复核`;
  $("#reviewHint").textContent = s
    ? pending
      ? `还有 ${pending} 项建议人工确认，已确认 ${reviewed} 项`
      : `当前没有待复核项目，已确认 ${reviewed} 项`
    : "识别过程中会自动汇集低置信度和空白项目";
  if (jobId && s) $("#openReview").disabled = false;
}
function fail(msg) {
  $("#progressText").textContent = "处理失败：" + msg;
  $("#pct").textContent = "!";
  alert(msg);
}
