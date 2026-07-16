const $ = (s) => document.querySelector(s);
const MAX_FILE_BYTES = 100 * 1024 * 1024;
let jobId = null, totalPages = 0, template = null, summary = null, currentFile = null, jobEvents = null, toastTimer = null;

function esc(v) { return String(v ?? "").replace(/[&<>'"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[c]); }
function formatBytes(bytes) { if (!bytes) return "正在读取文件"; return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`; }
function showToast(title, message = "", error = false) { const t = $("#toast"); clearTimeout(toastTimer); t.classList.toggle("error", error); t.querySelector(":scope > span").textContent = error ? "!" : "✓"; $("#toastTitle").textContent = title; $("#toastMessage").textContent = message; t.classList.add("show"); toastTimer = setTimeout(() => t.classList.remove("show"), error ? 5000 : 3000); }
function openReview() { if (jobId) window.open(`/review.html?job=${encodeURIComponent(jobId)}`, `ballot-review-${jobId}`, "width=1180,height=820"); }
const HISTORY_KEY = "ballotvision-export-history";
function readHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } }
function saveHistory(item) { const all = [item, ...readHistory().filter(x => x.filename !== item.filename)].slice(0, 30); localStorage.setItem(HISTORY_KEY, JSON.stringify(all)); renderHistory(); }
function renderHistory() { const list = $("#historyList"), items = readHistory(); if (!items.length) { list.innerHTML = '<div class="history-empty">暂未导出过统计汇总表</div>'; return; } list.innerHTML = items.map((item, index) => `<div class="history-item"><i class="history-x">X</i><div><b>${esc(item.filename)}</b><small>${esc(item.time)}</small><div class="history-actions"><button data-history-open="${index}">查看</button><button data-history-reveal="${index}">下载位置</button></div></div></div>`).join(""); }
function historyAction(index, reveal) { const item = readHistory()[Number(index)]; if (!item) return; if (window.desktopApp?.openHistoryFile) return reveal ? window.desktopApp.revealHistoryFile(item.filename) : window.desktopApp.openHistoryFile(item.filename); if (item.url) window.open(item.url, "_blank"); }

const upload = $("#upload"), file = $("#file");
$("#choose").onclick = (event) => { event.stopPropagation(); file.click(); };
file.onchange = () => file.files[0] && sendFile(file.files[0]);
upload.onclick = () => file.click();
["dragenter", "dragover"].forEach((name) => upload.addEventListener(name, (e) => { e.preventDefault(); upload.classList.add("drag"); }));
["dragleave", "drop"].forEach((name) => upload.addEventListener(name, (e) => { e.preventDefault(); upload.classList.remove("drag"); }));
upload.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) sendFile(f); });
$("#openReview").onclick = openReview;
$("#completionReview").onclick = openReview;
$("#xlsx").onclick = exportXlsx;
$("#completionExport").onclick = exportXlsx;
$("#historyButton").onclick = () => { renderHistory(); $("#historyPanel").classList.remove("hidden"); };
$("#historyClose").onclick = () => $("#historyPanel").classList.add("hidden");
$("#historyList").onclick = (event) => { const button = event.target.closest("button"); if (!button) return; historyAction(button.dataset.historyOpen ?? button.dataset.historyReveal, Boolean(button.dataset.historyReveal)); };
renderHistory();

async function sendFile(f) {
  if (!f.name.toLowerCase().endsWith(".pdf")) return showToast("文件格式不正确", "请选择 PDF 文件", true);
  if (f.size > MAX_FILE_BYTES) return showToast("文件超过大小限制", "请选择不超过 100MB 的 PDF 文件", true);
  currentFile = f; begin(f);
  try {
    const r = await fetch("/api/analyze", { method:"POST", headers:{"Content-Type":"application/pdf", "X-Filename":encodeURIComponent(f.name)}, body:f });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "无法开始识别"); connect(d.id);
  } catch (e) { fail(e.message); }
}
function begin(f) {
  if (jobEvents) jobEvents.close(); $("#completion").classList.add("hidden"); $(".progress").classList.remove("hidden"); $("#workspace").classList.remove("hidden"); $("#filename").textContent = f.name;
  $("#fileMeta").textContent = `文件大小：${formatBytes(f.size)} · 正在读取页数`;
  $("#scanCurrent").textContent = "0"; $("#scanTotal").textContent = "0"; $("#workspace").scrollIntoView({behavior:"smooth",block:"start"}); template = summary = null; totalPages = 0;
  $("#pageImage").removeAttribute("src"); $("#previewEmpty").style.display = "block"; $("#templateState").textContent = "识别中"; $("#templateState").classList.remove("ok");
  $("#names").innerHTML = "<span>识别完成后显示名单</span>"; $("#categories").innerHTML = ""; ["peopleCount","categoryCount","peopleMetric","categoryMetric","pages","marks"].forEach(id => $("#"+id).textContent = "0");
  $("#openReview").disabled = true; $("#xlsx").disabled = true; $("#xlsx").classList.add("disabled"); renderReviewCount(null); setProgress(1, 2, "正在准备 PDF");
}
function connect(id) {
  jobId = id; if (jobEvents) jobEvents.close(); const es = new EventSource(`/api/jobs/${id}/events`); jobEvents = es;
  es.addEventListener("status", (e) => { const d = JSON.parse(e.data); setProgress(d.stage || 1, d.progress, d.message); if (d.total) updatePageState(d.current || 0, d.total); });
  es.addEventListener("template", (e) => { template = JSON.parse(e.data).template; renderTemplate(); renderMatrix(null); renderReviewCount(null); });
  es.addEventListener("page", (e) => { const d = JSON.parse(e.data); summary = d.summary; updatePageState(d.result.page, d.result.total); $("#pageImage").src = `/api/jobs/${id}/pages/${d.result.page}`; $("#previewEmpty").style.display="none"; renderMatrix(summary); renderReviewCount(summary); });
  es.addEventListener("summary", (e) => { summary = JSON.parse(e.data).summary; renderMatrix(summary); renderReviewCount(summary); });
  es.addEventListener("done", (e) => { summary = JSON.parse(e.data).summary; setProgress(3,100,"统计完成，可复核后手动导出"); renderMatrix(summary); renderReviewCount(summary); $("#xlsx").classList.remove("disabled"); $("#xlsx").disabled=false; $("#openReview").disabled=false; showCompletion(); });
  es.addEventListener("joberror", (e) => { fail(JSON.parse(e.data).message); es.close(); if(jobEvents===es) jobEvents=null; });
}
function updatePageState(current, total) { totalPages = total || totalPages; $("#pagePill").textContent = `${current} / ${totalPages} 页`; $("#scanCurrent").textContent = current; $("#scanTotal").textContent = totalPages; if (current && totalPages && current === 1) $("#fileMeta").textContent = `文件大小：${formatBytes(currentFile?.size)} · 共${totalPages}页`; }
function setProgress(stage, n, text) {
  const p = Math.max(0,Math.min(100,Number(n)||0)); $("#bar").style.width = `${p}%`; $("#pct").textContent=`${p}%`; $("#progressText").textContent = text || "正在识别";
}
function showCompletion() { const title = template?.title?.trim() || currentFile?.name?.replace(/\.pdf$/i, "") || "选票"; $("#exportFilename").textContent = `${title}统计结果汇总表.xlsx`; $(".progress").classList.add("hidden"); $("#completion").classList.remove("hidden"); }
function renderTemplate() {
  if (!template) return; $("#templateState").textContent="识别完成"; $("#templateState").classList.add("ok"); $("#title").textContent=template.title||"未识别标题";
  $("#peopleCount").textContent=template.people.length; $("#categoryCount").textContent=template.categories.length; $("#peopleMetric").textContent=template.people.length; $("#categoryMetric").textContent=template.categories.length;
  $("#names").innerHTML=template.people.map(p=>`<span class="person ${p.evaluable===false?"muted":""}"><i>${p.serial}</i>${esc(p.name)}</span>`).join("");
  $("#categories").innerHTML=template.categories.map((c,i)=>`<span><i>${i+1}</i>${esc(c)}</span>`).join("");
}
function renderMatrix(s) {
  if (!template) return; const cats=template.categories;
  $("#matrix thead").innerHTML=`<tr><th>序号</th><th>姓名</th>${cats.map(c=>`<th>${esc(c)}</th>`).join("")}<th>小计</th></tr>`;
  const rows=s?.counts||template.people.map(p=>({serial:p.serial,name:p.name,evaluable:p.evaluable,values:Object.fromEntries(cats.map(c=>[c,0]))}));
  $("#matrix tbody").innerHTML=rows.map(r=>`<tr class="${r.evaluable===false?"disabled-row":""}"><td>${r.serial}</td><td>${esc(r.name)}</td>${r.evaluable===false?`<td colspan="${cats.length}">不确定等次</td>`:cats.map(c=>`<td><b>${r.values?.[c]||0}</b></td>`).join("")}<td>${r.evaluable===false?"—":cats.reduce((a,c)=>a+(r.values?.[c]||0),0)}</td></tr>`).join("");
  if(s){ $("#pages").textContent=s.pages||0; $("#marks").textContent=s.marks||0; }
}
function renderReviewCount(s) { const p=s?.review?.length||0,r=s?.reviewed?.length||0; $("#reviewCount").textContent=`${p} 人待复核`; $("#reviewHint").textContent=s?(p?`还有 ${p} 项建议人工确认，已确认 ${r} 项`:`当前没有待复核项目，已确认 ${r} 项`):"识别过程中会自动汇集低置信度和空白项目"; if(jobId&&s) $("#openReview").disabled=false; }
async function exportXlsx() { if(!jobId) return; const buttons=[$("#xlsx"),$("#completionExport")].filter(Boolean); buttons.forEach(b=>b.disabled=true); const old=$("#completionExport").textContent; $("#completionExport").textContent="正在导出…"; try { const r=await fetch(`/api/jobs/${jobId}/export/xlsx`,{method:"POST"}); const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error||"导出失败"); const filename=d.filename||$("#exportFilename").textContent; $("#exportFilename").textContent=filename; saveHistory({ filename, time: new Date().toLocaleString("zh-CN", { hour12:false }), url:d.url || "" }); showToast("已保存到桌面",filename); } catch(e) { const busy=/EBUSY|busy|locked|占用/i.test(e.message); showToast(busy?"文件正在使用":"导出失败",busy?"请关闭已打开的汇总表后重试":e.message,true); } finally { buttons.forEach(b=>b.disabled=false); $("#completionExport").textContent=old; } }
function fail(msg) { $("#pct").textContent="!"; $("#progressText").textContent="处理失败"; showToast("识别未完成",msg||"发生未知错误，请重新选择文件",true); }
