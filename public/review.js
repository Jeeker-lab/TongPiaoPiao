const $ = (s) => document.querySelector(s);
const jobId = new URLSearchParams(location.search).get("job");
let state = null, filter = "pending", pages = [], currentPage = null, selectedKey = null, toastTimer;
const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
function toast(message) { clearTimeout(toastTimer); $("#toast").textContent = message; $("#toast").classList.add("show"); toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2200); }
const key = (item) => `${item.page}:${item.serial}`;
function items() { return state?.summary?.reviewItems || []; }
function filtered() { const all = items(); return filter === "pending" ? all.filter(i => !i.reviewed) : filter === "blank" ? all.filter(i => i.recognizedCategory === "空白" && !i.reviewed) : filter === "reviewed" ? all.filter(i => i.reviewed) : all; }

function render() {
  const all = items(), visible = filtered(), blanks = all.filter(i => i.recognizedCategory === "空白" && !i.reviewed);
  $("#pendingCount").textContent = all.filter(i => !i.reviewed).length;
  $("#reviewedCount").textContent = all.filter(i => i.reviewed).length;
  $("#blankCount").textContent = blanks.length;
  $("#subtitle").textContent = state?.template?.title || "建议复核选票";
  const categories = state?.template?.categories || [], old = $("#blankCategory").value;
  $("#blankCategory").innerHTML = categories.map(c => `<option value="${esc(c)}">批量设为：${esc(c)}</option>`).join("");
  if (categories.includes(old)) $("#blankCategory").value = old;
  $("#confirmBlanks").disabled = !blanks.length || !categories.length;
  const grouped = new Map();
  visible.forEach(i => { const list = grouped.get(i.page) || []; list.push(i); grouped.set(i.page, list); });
  pages = [...grouped.keys()].sort((a,b) => a-b);
  if (!pages.includes(currentPage)) currentPage = pages[0] ?? null;
  $("#pageList").innerHTML = pages.length ? pages.map(p => `<button class="page-button ${p === currentPage ? "active" : ""}" data-page="${p}"><span>第 ${p} 页</span><em>${grouped.get(p).length} 人</em></button>`).join("") : '<div class="empty">当前筛选下没有复核页面</div>';
  document.querySelectorAll(".page-button").forEach(b => b.onclick = () => { currentPage = Number(b.dataset.page); selectedKey = null; render(); });
  renderPage(grouped.get(currentPage) || []);
}
function showFullPage() {
  if (!currentPage) return;
  $("#ballotImage").src = `/api/jobs/${jobId}/pages/${currentPage}`;
  $("#ballotImage").style.display = "block"; $("#personCrop").style.display = "none"; $("#imageEmpty").style.display = "none";
}
function showCrop(item) {
  const region = state?.template?.layout?.reviewRegions?.[item.serial];
  if (!region) { showFullPage(); $("#pageTitle").textContent = `第 ${item.page} 页 · ${item.serial}. ${item.name}`; return; }
  currentPage = item.page;
  const image = new Image();
  image.onload = () => {
    const x = region.x*image.naturalWidth, y = region.y*image.naturalHeight, w = region.width*image.naturalWidth, h = region.height*image.naturalHeight;
    const px = w*.025, py = h*1.35, cx = Math.max(0,x-px), cy = Math.max(0,y-py), cr = Math.min(image.naturalWidth,x+w+px), cb = Math.min(image.naturalHeight,y+h+py), cw=cr-cx, ch=cb-cy;
    const canvas=$("#personCrop"); canvas.width=Math.min(1500,Math.max(900,Math.round(cw))); canvas.height=Math.max(180,Math.round(canvas.width*ch/cw));
    const c=canvas.getContext("2d"); c.clearRect(0,0,canvas.width,canvas.height); c.drawImage(image,cx,cy,cw,ch,0,0,canvas.width,canvas.height);
    const rx=(x-cx)/cw*canvas.width, ry=(y-cy)/ch*canvas.height, rw=w/cw*canvas.width, rh=h/ch*canvas.height;
    c.fillStyle="rgba(255,205,52,.16)"; c.fillRect(rx,ry,rw,rh); c.strokeStyle="#087a58"; c.lineWidth=Math.max(7,canvas.width/210); c.strokeRect(rx,ry,rw,rh);
    $("#ballotImage").style.display="none"; canvas.style.display="block"; $("#imageEmpty").style.display="none";
  };
  image.onerror = showFullPage; image.src = `/api/jobs/${jobId}/pages/${item.page}`;
  $("#pageTitle").textContent = `第 ${item.page} 页 · ${item.serial}. ${item.name}`;
}
function select(item) { selectedKey=key(item); document.querySelectorAll(".review-person").forEach(c=>c.classList.toggle("active",c.dataset.key===selectedKey)); showCrop(item); }
function wheel(event) { event.preventDefault(); const s=event.currentTarget, n=Math.max(0,Math.min(s.options.length-1,s.selectedIndex+(event.deltaY>0?1:-1))); if(n!==s.selectedIndex) { s.selectedIndex=n; s.dispatchEvent(new Event("change",{bubbles:true})); } }
function renderPage(pageItems) {
  if (!currentPage) { $("#ballotImage").style.display="none"; $("#personCrop").style.display="none"; $("#imageEmpty").style.display="block"; $("#pageTitle").textContent="没有需要显示的选票"; $("#reviewItems").innerHTML='<div class="empty">暂无复核人员</div>'; return; }
  const categories=[...(state.template.categories||[])]; if(!categories.includes("空白")) categories.push("空白");
  if (!pageItems.some(i=>key(i)===selectedKey)) selectedKey=pageItems[0]?key(pageItems[0]):null;
  $("#reviewItems").innerHTML=pageItems.map(i=>`<article class="review-person ${key(i)===selectedKey?"active":""}" data-key="${key(i)}"><div class="person-head"><b>${i.serial}. ${esc(i.name)}</b><span>软件识别：${esc(i.recognizedCategory)}${i.confidence?` · ${Math.round(i.confidence*100)}%`:""}</span></div><div class="edit-row"><select data-page="${i.page}" data-serial="${i.serial}">${categories.map(c=>`<option value="${esc(c)}" ${c===i.effectiveCategory?"selected":""}>${esc(c)}</option>`).join("")}</select><button class="confirm" data-page="${i.page}" data-serial="${i.serial}">确认</button><button class="restore" data-page="${i.page}" data-serial="${i.serial}">恢复软件结果</button></div></article>`).join("");
  document.querySelectorAll(".review-person").forEach(card=>card.onclick=e=>{ if(e.target.closest("button,select")) return; const item=pageItems.find(i=>key(i)===card.dataset.key); if(item) select(item); });
  document.querySelectorAll(".review-person select").forEach(s=>{ const item=pageItems.find(i=>i.page===Number(s.dataset.page)&&i.serial===Number(s.dataset.serial)); s.addEventListener("wheel",wheel,{passive:false}); s.addEventListener("focus",()=>item&&select(item)); });
  document.querySelectorAll(".confirm").forEach(b=>b.onclick=()=>{ const card=b.closest(".review-person"), item=pageItems.find(i=>i.page===Number(b.dataset.page)&&i.serial===Number(b.dataset.serial)); if(item) select(item); save(Number(b.dataset.page),Number(b.dataset.serial),card.querySelector("select").value); });
  document.querySelectorAll(".restore").forEach(b=>b.onclick=()=>save(Number(b.dataset.page),Number(b.dataset.serial),null));
  const picked=pageItems.find(i=>key(i)===selectedKey); if(picked) showCrop(picked); else showFullPage();
}
async function load() { const r=await fetch(`/api/jobs/${jobId}/state`), data=await r.json(); if(!r.ok) throw new Error(data.error||"读取复核数据失败"); state=data; render(); }
async function save(page,serial,category) { const r=await fetch(`/api/jobs/${jobId}/review`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({page,serial,category})}),data=await r.json(); if(!r.ok) return toast(data.error||"保存失败"); state.summary=data.summary; toast(category===null?"已恢复软件结果":"人工复核结果已保存并同步汇总"); render(); }
async function bulk() { const category=$("#blankCategory").value; if(!category) return; const r=await fetch(`/api/jobs/${jobId}/review/blanks`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category})}),data=await r.json(); if(!r.ok) return toast(data.error||"批量确认失败"); state.summary=data.summary; selectedKey=null; toast(`已将 ${data.updated} 个空白项批量确认为“${category}”并同步汇总`); render(); }
document.querySelectorAll(".filters button").forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll(".filters button").forEach(x=>x.classList.toggle("active",x===b));currentPage=null;selectedKey=null;render();});
$("#previous").onclick=()=>{const i=pages.indexOf(currentPage);if(i>0){currentPage=pages[i-1];selectedKey=null;render();}};
$("#next").onclick=()=>{const i=pages.indexOf(currentPage);if(i>=0&&i<pages.length-1){currentPage=pages[i+1];selectedKey=null;render();}};
$("#showFullPage").onclick=showFullPage; $("#confirmBlanks").onclick=bulk; $("#closeWindow").onclick=()=>window.close();
if(!jobId) toast("缺少复核任务编号"); else { load().catch(e=>toast(e.message)); const es=new EventSource(`/api/jobs/${jobId}/events`); ["summary","page","done"].forEach(t=>es.addEventListener(t,()=>load().catch(()=>{}))); }
