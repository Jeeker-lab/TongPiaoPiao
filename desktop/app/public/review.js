const $ = (selector) => document.querySelector(selector);
const jobId = new URLSearchParams(location.search).get("job");
let state = null;
let filter = "pending";
let pages = [];
let currentPage = null;
let selectedKey = null;

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
function showToast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 1800);
}
function itemKey(item) {
  return `${item.page}:${item.serial}`;
}
function filteredItems() {
  const items = state?.summary?.reviewItems || [];
  if (filter === "pending") return items.filter((item) => !item.reviewed);
  if (filter === "blank") return items.filter((item) => item.recognizedCategory === "空白" && !item.reviewed);
  if (filter === "reviewed") return items.filter((item) => item.reviewed);
  return items;
}
function render() {
  const all = state?.summary?.reviewItems || [];
  const blanks = all.filter((item) => item.recognizedCategory === "空白" && !item.reviewed);
  $("#pendingCount").textContent = all.filter((item) => !item.reviewed).length;
  $("#reviewedCount").textContent = all.filter((item) => item.reviewed).length;
  $("#blankCount").textContent = blanks.length;
  $("#subtitle").textContent = state?.template?.title || "建议复核选票";

  const previousCategory = $("#blankCategory").value;
  const categories = state?.template?.categories || [];
  $("#blankCategory").innerHTML = state.template.categories.map((category) => `<option value="${esc(category)}">批量设为：${esc(category)}</option>`).join("");
  if (categories.includes(previousCategory)) $("#blankCategory").value = previousCategory;
  $("#confirmBlanks").disabled = blanks.length === 0 || categories.length === 0;

  const grouped = new Map();
  for (const item of filteredItems()) {
    const list = grouped.get(item.page) || [];
    list.push(item);
    grouped.set(item.page, list);
  }
  pages = [...grouped.keys()].sort((a, b) => a - b);
  if (!pages.includes(currentPage)) currentPage = pages[0] ?? null;
  $("#pageList").innerHTML = pages.length
    ? pages.map((page) => `<button class="page-button ${page === currentPage ? "active" : ""}" data-page="${page}"><span>第 ${page} 页</span><em>${grouped.get(page).length} 人</em></button>`).join("")
    : '<div class="empty">当前筛选下没有复核页面</div>';
  document.querySelectorAll(".page-button").forEach((button) => button.onclick = () => {
    currentPage = Number(button.dataset.page);
    selectedKey = null;
    render();
  });
  renderPage(grouped.get(currentPage) || []);
}
function showFullPage() {
  const image = $("#ballotImage");
  const canvas = $("#personCrop");
  if (!currentPage) return;
  image.src = `/api/jobs/${jobId}/pages/${currentPage}`;
  image.style.display = "block";
  canvas.style.display = "none";
  $("#imageEmpty").style.display = "none";
}
function showPersonCrop(item) {
  const region = state?.template?.layout?.reviewRegions?.[item.serial];
  if (!region) {
    showFullPage();
    $("#pageTitle").textContent = `第 ${item.page} 页 · ${item.serial}. ${item.name}`;
    return;
  }
  currentPage = item.page;
  const source = new Image();
  source.onload = () => {
    const rowX = region.x * source.naturalWidth;
    const rowY = region.y * source.naturalHeight;
    const rowW = region.width * source.naturalWidth;
    const rowH = region.height * source.naturalHeight;
    const padX = rowW * 0.025;
    const padY = rowH * 1.35;
    const cropX = Math.max(0, rowX - padX);
    const cropY = Math.max(0, rowY - padY);
    const cropRight = Math.min(source.naturalWidth, rowX + rowW + padX);
    const cropBottom = Math.min(source.naturalHeight, rowY + rowH + padY);
    const cropW = cropRight - cropX;
    const cropH = cropBottom - cropY;
    const canvas = $("#personCrop");
    canvas.width = Math.min(1500, Math.max(900, Math.round(cropW)));
    canvas.height = Math.max(180, Math.round(canvas.width * cropH / cropW));
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#e36b00";
    context.lineWidth = Math.max(7, canvas.width / 210);
    context.strokeRect(
      (rowX - cropX) / cropW * canvas.width,
      (rowY - cropY) / cropH * canvas.height,
      rowW / cropW * canvas.width,
      rowH / cropH * canvas.height,
    );
    $("#ballotImage").style.display = "none";
    canvas.style.display = "block";
    $("#imageEmpty").style.display = "none";
  };
  source.onerror = showFullPage;
  source.src = `/api/jobs/${jobId}/pages/${item.page}`;
  $("#pageTitle").textContent = `第 ${item.page} 页 · ${item.serial}. ${item.name}`;
}
function selectPerson(item) {
  selectedKey = itemKey(item);
  document.querySelectorAll(".review-person").forEach((card) => card.classList.toggle("active", card.dataset.key === selectedKey));
  showPersonCrop(item);
}
function changeCategoryWithWheel(event) {
  event.preventDefault();
  const select = event.currentTarget;
  const direction = event.deltaY > 0 ? 1 : -1;
  const nextIndex = Math.max(0, Math.min(select.options.length - 1, select.selectedIndex + direction));
  if (nextIndex === select.selectedIndex) return;
  select.selectedIndex = nextIndex;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
function renderPage(items) {
  const image = $("#ballotImage");
  const canvas = $("#personCrop");
  if (!currentPage) {
    image.style.display = "none";
    canvas.style.display = "none";
    $("#imageEmpty").style.display = "block";
    $("#pageTitle").textContent = "没有需要显示的选票";
    $("#reviewItems").innerHTML = '<div class="empty">暂无复核人员</div>';
    return;
  }
  const categories = [...state.template.categories, "空白"];
  if (!items.some((item) => itemKey(item) === selectedKey)) selectedKey = items[0] ? itemKey(items[0]) : null;
  $("#reviewItems").innerHTML = items.map((item) => `
    <article class="review-person ${itemKey(item) === selectedKey ? "active" : ""}" data-key="${itemKey(item)}">
      <div class="person-head"><b>${item.serial}. ${esc(item.name)}</b><span>软件识别：${esc(item.recognizedCategory)}${item.confidence ? ` · ${Math.round(item.confidence * 100)}%` : ""}</span></div>
      <div class="edit-row">
        <select data-page="${item.page}" data-serial="${item.serial}">${categories.map((category) => `<option value="${esc(category)}" ${category === item.effectiveCategory ? "selected" : ""}>${esc(category)}</option>`).join("")}</select>
        <button class="confirm" data-page="${item.page}" data-serial="${item.serial}">确认</button>
        <button class="restore" data-page="${item.page}" data-serial="${item.serial}">恢复软件结果</button>
      </div>
    </article>`).join("");
  document.querySelectorAll(".review-person").forEach((card) => card.onclick = (event) => {
    if (event.target.closest("button,select")) return;
    const item = items.find((candidate) => itemKey(candidate) === card.dataset.key);
    if (item) selectPerson(item);
  });
  document.querySelectorAll(".review-person select").forEach((select) => {
    const item = items.find((candidate) => candidate.page === Number(select.dataset.page) && candidate.serial === Number(select.dataset.serial));
    select.addEventListener("wheel", changeCategoryWithWheel, { passive: false });
    select.addEventListener("focus", () => { if (item) selectPerson(item); });
  });
  document.querySelectorAll(".confirm").forEach((button) => button.onclick = () => {
    const item = items.find((candidate) => candidate.page === Number(button.dataset.page) && candidate.serial === Number(button.dataset.serial));
    if (item) selectPerson(item);
    const select = button.closest(".review-person").querySelector("select");
    saveReview(Number(button.dataset.page), Number(button.dataset.serial), select.value);
  });
  document.querySelectorAll(".restore").forEach((button) => button.onclick = () => saveReview(Number(button.dataset.page), Number(button.dataset.serial), null));
  const selected = items.find((item) => itemKey(item) === selectedKey);
  if (selected) showPersonCrop(selected);
  else showFullPage();
}
async function loadState() {
  const response = await fetch(`/api/jobs/${jobId}/state`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "读取复核数据失败");
  state = data;
  render();
}
async function saveReview(page, serial, category) {
  const response = await fetch(`/api/jobs/${jobId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page, serial, category }),
  });
  const data = await response.json();
  if (!response.ok) return alert(data.error || "保存失败");
  state.summary = data.summary;
  showToast(category === null ? "已恢复软件结果" : "人工复核结果已保存并同步汇总");
  render();
}
async function bulkReviewBlanks() {
  const category = $("#blankCategory").value;
  if (!category) return;
  const response = await fetch(`/api/jobs/${jobId}/review/blanks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category }),
  });
  const data = await response.json();
  if (!response.ok) return alert(data.error || "批量确认失败");
  state.summary = data.summary;
  selectedKey = null;
  showToast(`已将 ${data.updated} 个空白项批量确认为“${category}”并同步汇总`);
  render();
}
document.querySelectorAll(".filters button").forEach((button) => button.onclick = () => {
  filter = button.dataset.filter;
  document.querySelectorAll(".filters button").forEach((item) => item.classList.toggle("active", item === button));
  currentPage = null;
  selectedKey = null;
  render();
});
$("#previous").onclick = () => { const index = pages.indexOf(currentPage); if (index > 0) { currentPage = pages[index - 1]; selectedKey = null; render(); } };
$("#next").onclick = () => { const index = pages.indexOf(currentPage); if (index >= 0 && index < pages.length - 1) { currentPage = pages[index + 1]; selectedKey = null; render(); } };
$("#showFullPage").onclick = showFullPage;
$("#confirmBlanks").onclick = bulkReviewBlanks;
$("#closeWindow").onclick = () => window.close();

if (!jobId) alert("缺少复核任务编号");
else {
  loadState().catch((error) => alert(error.message));
  const events = new EventSource(`/api/jobs/${jobId}/events`);
  for (const type of ["summary", "page", "done"])
    events.addEventListener(type, () => loadState().catch(() => {}));
}
