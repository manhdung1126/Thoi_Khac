import { api, apiUrl, getToken, setToken, subscribeState } from "../shared/api.js";
import { Stage } from "./stage.js?v=20261006-exhibition";
import {EndingControl} from './ending.js';

const $ = selector => document.querySelector(selector);
// Server-owned pages, drawings, cells, Ending, live page and revision from HTTP.
let state;
// Local Control UI; selection and in-progress inputs are not server state.
let busy = false, libraryView = "active", selectedCell = 0, selectedPageId, notificationTimer;
const LIBRARY_PAGE_SIZE = 72;
let libraryPage = 0;
let pendingSync = false, connectionStatus = { connected: false, message: "Đang kết nối…" };
// Renderer-only cache: one card per drawing still in authoritative state.
const libraryCards = new Map();

function notice(message, error = false) {
  const node = $("#notice");
  node.textContent = message;
  node.className = error ? "notice error" : "notice";
  node.hidden = false;
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(() => { node.hidden = true; }, 6000);
}

function access() {
  document.querySelectorAll("[data-admin]").forEach(node => { node.disabled = busy || !getToken() || node.hasAttribute("data-locked"); });
  $("#login-button").textContent = getToken() ? "Đăng xuất" : "Đăng nhập";
  $("#sync-retry").disabled = busy;
}

function renderConnectionStatus(status = connectionStatus) {
  connectionStatus = status;
  const node = $("#connection-status");
  node.textContent = pendingSync ? `Chưa đồng bộ · ${status.message}` : status.message.replace("Mất kết nối — đang nối lại…", "Đang nối lại…");
  node.classList.toggle("connected", status.connected && !pendingSync);
  node.classList.toggle("stale", pendingSync || !status.connected && !status.message.includes("nối lại"));
}

async function refreshAfterSave(message) {
  const refreshed = await subscription.refresh();
  if (refreshed) notice(message);
  else {
    pendingSync = true;
    $("#sync-warning").hidden = false;
    $("#rename-sync-message").hidden = !$("#rename-page-dialog").open;
    notice("Đã lưu trên máy chủ nhưng giao diện chưa đồng bộ.", true);
    $("#notice").classList.add("warning");
    renderConnectionStatus();
  }
  return refreshed;
}

async function refreshView() {
  $("#sync-retry").disabled = true;
  try { await subscription.refresh(); }
  finally { $("#sync-retry").disabled = busy; }
}

function openLogin() {
  $("#login-error").textContent = "";
  if (!$("#login-dialog").open) $("#login-dialog").showModal();
}

const stage = new Stage($("#stage"), {
  onCell: index => { selectedCell = index; renderCells(); renderLibrary(); },
  onError: message => notice(message, true),
});
const endingControl=new EndingControl({mutate,notice,getState:()=>state,onAccess:access});

async function mutate(path, method = "POST", body = {}, message = "Đã cập nhật.") {
  if (busy) return;
  if (!getToken()) { openLogin(); return; }
  busy = true; access(); notice("Đang lưu thay đổi…");
  try {
    await api(path, { method, body: method === "DELETE" ? undefined : body, auth: true });
    // The subscription applies HTTP state before refresh resolves.
    return await refreshAfterSave(message);
  } catch (error) {
    notice(error.message, true);
    if (error.status === 401) openLogin();
    if (state) stage.render(state);
  } finally {
    busy = false; access();
  }
}

function makeButton(text, action, { disabled = false, danger = false } = {}) {
  const button = document.createElement("button");
  button.textContent = text; button.type = "button"; button.dataset.admin = "";
  if (disabled) button.dataset.locked = "";
  button.disabled = disabled || busy || !getToken();
  if (danger) button.className = "danger";
  button.addEventListener("click", action);
  return button;
}

// The selected preview page is not necessarily the server's live page.
const currentPage = () => state?.pages.find(page => page.id === selectedPageId);

function renderCells() {
  $("#led-management").hidden = false;
  $("#live-display").style.aspectRatio = "2 / 1";
  const cells = currentPage()?.cells || [];
  if (selectedCell >= cells.length) selectedCell = 0;
  const select = $("#led-cell-select"); select.replaceChildren();
  for (const cell of cells) {
    const option = document.createElement("option");
    option.value = cell.id; option.textContent = `Ô ${cell.id + 1} · ${cell.drawing_ids.length} hình`;
    select.append(option);
  }
  select.value = String(selectedCell);
  stage.selectCell(selectedCell);
  $("#library-target").textContent = `${currentPage()?.name || "Trang đang chỉnh"} · Ô ${String(selectedCell + 1).padStart(2, "0")}`;
  $("#cell-context").textContent = `Ô ${String(selectedCell + 1).padStart(2, "0")} của trang đang chỉnh`;
  const cell = cells[selectedCell];
  $("#led-cell-count").textContent = `${cell?.drawing_ids.length || 0} hình`;
  const queue = $("#led-queue"); queue.replaceChildren();
  for (const id of cell?.drawing_ids || []) {
    const drawing = state.drawings.find(item => item.id === id);
    if (!drawing) continue;
    const row = document.createElement("div"); row.className = "led-queue-row";
    const image = document.createElement("img"); image.src = apiUrl(drawing.image_path); image.alt = `Nét vẽ ${id.slice(0, 6)}`;
    const text = document.createElement("span"); text.textContent = `#${id.slice(0, 6)}${cell.active === id ? " · đang hiện" : ""}`;
    row.append(image, text,
      makeButton("Hiện ngay", () => mutate(`/api/pages/${currentPage().id}/cells/${selectedCell}`, "PATCH", { drawing_id: id }, "Đã đổi hình trong trang đã chọn."), { disabled: cell.active === id }),
      makeButton("Bỏ khỏi ô", () => mutate(`/api/pages/${currentPage().id}/items/${id}`, "DELETE", {}, "Đã bỏ hình khỏi ô; hình vẫn còn trong kho."), { danger: true }));
    queue.append(row);
  }
  if (!cell?.drawing_ids.length) {
    const empty = document.createElement("p"); empty.className = "empty";
    empty.textContent = "Ô này chưa có hình. Chọn hình trong Kho nét vẽ để thêm vào."; queue.append(empty);
  }
}

function renderLibrary() {
  if (!state) return;
  const host = $("#library");
  const query = $("#library-search").value.trim().toLowerCase();
  for (const [selector, value] of [["#active-count", state.drawings.filter(d => !d.deleted).length], ["#favorite-count", state.drawings.filter(d => !d.deleted && d.favorite).length], ["#trash-count", state.drawings.filter(d => d.deleted).length]]) {
    const node = $(selector);
    if (node.textContent !== String(value)) node.textContent = value;
  }
  $("#clear-library-filter").disabled = !$("#library-search").value && !$("#only-visible").checked;
  const page = currentPage(), cells = page?.cells || [];
  const membership = new Map(cells.flatMap(cell => cell.drawing_ids.map(id => [id, cell.id])));
  const visible = new Set(cells.map(cell => cell.active).filter(Boolean));
  const drawings = state.drawings.filter(drawing => {
    const inFolder = libraryView === "trash" ? Boolean(drawing.deleted) : !drawing.deleted && (libraryView !== "favorites" || drawing.favorite);
    return inFolder && drawing.id.toLowerCase().includes(query) && (!$("#only-visible").checked || visible.has(drawing.id));
  }).slice().sort((a, b) => b.created_at - a.created_at);
  const count = $("#library-count");
  if (count.textContent !== String(drawings.length)) count.textContent = drawings.length;
  const pages = Math.max(1, Math.ceil(drawings.length / LIBRARY_PAGE_SIZE));
  const validPage = Math.min(libraryPage, pages - 1);
  if (libraryPage !== validPage) host.scrollTop = 0;
  libraryPage = validPage;
  const mounted = drawings.slice(libraryPage * LIBRARY_PAGE_SIZE, (libraryPage + 1) * LIBRARY_PAGE_SIZE);
  const pageLabel = `${libraryPage + 1} / ${pages}`;
  const rangeLabel = drawings.length ? `${libraryPage * LIBRARY_PAGE_SIZE + 1}-${libraryPage * LIBRARY_PAGE_SIZE + mounted.length} / ${drawings.length} hình` : "0 hình";
  if ($("#library-page").textContent !== pageLabel) $("#library-page").textContent = pageLabel;
  if ($("#library-range").textContent !== rangeLabel) $("#library-range").textContent = rangeLabel;
  $("#library-prev").disabled = libraryPage === 0;
  $("#library-next").disabled = libraryPage === pages - 1;
  const available = new Set(state.drawings.map(drawing => drawing.id));
  for (const [id, entry] of libraryCards) {
    if (!available.has(id)) { entry.card.remove(); libraryCards.delete(id); }
  }
  if (!drawings.length) {
    const empty = document.createElement("p"); empty.className = "empty";
    empty.textContent = query || $("#only-visible").checked ? "Không có hình khớp. Thử mã ngắn hơn hoặc chọn Bỏ lọc." : libraryView === "trash" ? "Thùng rác đang trống." : libraryView === "favorites" ? "Chọn trái tim trên hình để lưu vào Yêu thích." : "Nét vẽ của khách sẽ xuất hiện ở đây.";
    host.replaceChildren(empty); return;
  }
  const retained = new Set(mounted.map(drawing => drawing.id));
  for (const [id, entry] of libraryCards) {
    if (!retained.has(id) && entry.card.parentNode === host) entry.card.remove();
  }
  host.querySelector(".empty")?.remove();
  // An empty result host can be populated off-DOM and inserted once.
  const batch = host.childElementCount ? null : document.createDocumentFragment();
  let previous;
  for (const drawing of mounted) {
    // Asset/favorite/folder changes rebuild a card; page/cell context only
    // updates its labels and state. Revision/runtime are never cache keys.
    const key = JSON.stringify([drawing.image_path, Boolean(drawing.favorite), libraryView]);
    const cached = libraryCards.get(drawing.id);
    if (cached?.key === key) {
      const oldCell = membership.get(drawing.id), inTargetCell = oldCell === selectedCell;
      const metaText = `#${drawing.id.slice(0, 6)}${oldCell === undefined ? "" : ` · Ô ${oldCell + 1}`}${visible.has(drawing.id) ? " (đang hiện)" : ""}`;
      if (cached.meta.textContent !== metaText) cached.meta.textContent = metaText;
      cached.card.classList.toggle("on-stage", visible.has(drawing.id));
      const button = cached.target;
      if (button) {
        const label = inTargetCell ? `Đang ở ô ${selectedCell + 1}` : oldCell === undefined ? `＋ Thêm vào ô ${selectedCell + 1}` : `Chuyển vào ô ${selectedCell + 1}`;
        const shortLabel = inTargetCell ? `Ở ô ${selectedCell + 1}` : oldCell === undefined ? "Thêm" : "Chuyển";
        if (button.textContent !== shortLabel) button.textContent = shortLabel;
        if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
        if (button.hasAttribute("data-locked") !== inTargetCell) button.toggleAttribute("data-locked", inTargetCell);
      }
      for (const button of cached.buttons) {
        const disabled = button.hasAttribute("data-locked") || busy || !getToken();
        if (button.disabled !== disabled) button.disabled = disabled;
      }
      if (batch) batch.append(cached.card);
      else {
        const next = previous ? previous.nextElementSibling : host.firstElementChild;
        if (next !== cached.card) host.insertBefore(cached.card, next);
      }
      previous = cached.card;
      continue;
    }
    const card = document.createElement("article"); card.className = "library-card";
    const image = document.createElement("img"); image.src = apiUrl(drawing.image_path); image.alt = `Nét vẽ ${drawing.id.slice(0, 8)}`; image.loading = "lazy";
    const meta = document.createElement("div"); meta.className = "library-meta";
    meta.textContent = `#${drawing.id.slice(0, 6)}${membership.has(drawing.id) ? ` · Ô ${membership.get(drawing.id) + 1}` : ""}${visible.has(drawing.id) ? " (đang hiện)" : ""}`;
    meta.title = drawing.id;
    const favorite = makeButton(drawing.favorite ? "♥" : "♡", () => mutate(`/api/drawings/${drawing.id}/favorite`, "PATCH", { favorite: !drawing.favorite }, drawing.favorite ? "Đã bỏ khỏi Yêu thích." : "Đã thêm vào Yêu thích."));
    favorite.classList.add("favorite-button");
    favorite.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 20 3.8 12A5 5 0 0 1 12 5a5 5 0 0 1 8.2 7Z"/></svg>';
    favorite.setAttribute("aria-label", drawing.favorite ? "Bỏ khỏi yêu thích" : "Thêm vào yêu thích");
    favorite.setAttribute("aria-pressed", String(Boolean(drawing.favorite)));
    favorite.title = favorite.getAttribute("aria-label");
    const actions = document.createElement("div"); actions.className = "library-actions";
    if (libraryView === "trash") {
      actions.append(
        makeButton("Khôi phục", () => mutate(`/api/drawings/${drawing.id}/restore`, "POST", {}, "Đã khôi phục vào kho nét vẽ.")),
        makeButton("Xóa vĩnh viễn", () => { if (confirm(`Xóa vĩnh viễn hình #${drawing.id.slice(0, 6)}? Thao tác này không thể hoàn tác.`)) mutate(`/api/drawings/${drawing.id}/purge`, "DELETE", {}, "Đã xóa vĩnh viễn hình và dữ liệu liên quan."); }, { danger: true }));
    } else {
      const oldCell = membership.get(drawing.id), inTargetCell = oldCell === selectedCell;
      const label = inTargetCell ? `Đang ở ô ${selectedCell + 1}` : oldCell === undefined ? `＋ Thêm vào ô ${selectedCell + 1}` : `Chuyển vào ô ${selectedCell + 1}`;
      actions.append(
        makeButton(label, () => {
          const page = currentPage(), oldCell = page.cells.find(cell => cell.drawing_ids.includes(drawing.id))?.id;
          return mutate(`/api/pages/${page.id}/items`, "POST", { drawing_id: drawing.id, cell_id: selectedCell }, oldCell === undefined ? `Đã thêm hình vào ô ${selectedCell + 1}.` : `Đã chuyển hình vào ô ${selectedCell + 1}.`);
        }, { disabled: inTargetCell }),
        makeButton("Cất đi", () => { if (confirm("Cất nét vẽ này khỏi tất cả các trang? Bạn có thể khôi phục từ thùng rác.")) mutate(`/api/drawings/${drawing.id}`, "DELETE", {}, "Đã đưa hình vào thùng rác."); }, { danger: true }));
    }
    if (visible.has(drawing.id)) card.classList.add("on-stage");
    if (drawing.favorite) {
      const download = document.createElement("a");
      download.href = apiUrl(`/api/favorites/${drawing.id}`);
      download.download = `${drawing.id}.svg`;
      download.textContent = "Tải SVG";
      actions.append(download);
    }
    const target = libraryView === "trash" ? null : actions.firstElementChild;
    if (target) {
      target.setAttribute("aria-label", target.textContent);
      target.textContent = membership.get(drawing.id) === selectedCell ? `Ở ô ${selectedCell + 1}` : membership.has(drawing.id) ? "Chuyển" : "Thêm";
    }
    const menu = document.createElement("div");
    menu.className = "library-menu"; menu.id = `artwork-actions-${drawing.id}`;
    menu.setAttribute("popover", "auto"); menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", `Thao tác hình #${drawing.id.slice(0, 8)}`);
    while (actions.childElementCount > 1) menu.append(actions.children[1]);
    const more = document.createElement("button"); more.type = "button"; more.className = "icon-button";
    more.setAttribute("aria-label", `Thao tác khác cho hình #${drawing.id.slice(0, 8)}`);
    more.setAttribute("popovertarget", menu.id);
    more.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>';
    // Native popover owns dismissal, Escape and focus; position once on opening.
    menu.addEventListener("beforetoggle", event => {
      if (event.newState !== "open") return;
      const bounds = more.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(bounds.right - 200, innerWidth - 208))}px`;
      menu.style.top = `${Math.max(8, Math.min(bounds.bottom + 8, innerHeight - menu.childElementCount * 48 - 24))}px`;
    });
    actions.append(more, menu);
    card.append(image, favorite, meta, actions);
    libraryCards.set(drawing.id, { key, card, meta, buttons: [favorite, ...actions.querySelectorAll("[data-admin]")], target });
    if (cached) cached.card.replaceWith(card);
    if (batch) batch.append(card);
    else {
      const next = previous ? previous.nextElementSibling : host.firstElementChild;
      if (next !== card) host.insertBefore(card, next);
    }
    previous = card;
  }
  if (batch) host.append(batch);
}

function renderSnapshots() {
  const host = $("#snapshots"); host.replaceChildren();
  $("#snapshot-count").textContent = `${state.snapshots.length} bố cục`;
  for (const snapshot of state.snapshots.slice().reverse()) {
    const card = document.createElement("article"); card.className = "snapshot-card";
    const image = document.createElement("img"); image.src = apiUrl(snapshot.image_path); image.alt = snapshot.name; image.loading = "lazy";
    const info = document.createElement("div"), name = document.createElement("span"), download = document.createElement("a");
    name.textContent = snapshot.name; download.href = apiUrl(snapshot.image_path); download.download = `${snapshot.name}.png`; download.textContent = "Tải"; download.target = "_blank";
    const remove = makeButton("Xóa", () => { if (confirm(`Xóa khoảnh khắc “${snapshot.name}”?`)) mutate(`/api/snapshots/${snapshot.id}`, "DELETE", {}, "Đã xóa khoảnh khắc."); }, { danger: true });
    info.append(name);
    if (snapshot.page_id) {
      info.append(makeButton(state.current_page_id === snapshot.page_id ? "Đang chiếu" : "Chiếu khoảnh khắc", () => mutate(`/api/pages/${snapshot.page_id}/activate`, "POST", {}, "Đã chiếu khoảnh khắc."), { disabled: state.current_page_id === snapshot.page_id }));
    }
    download.textContent = "Tải ảnh";
    info.append(download, remove); card.append(image, info); host.append(card);
  }
  if (!state.snapshots.length) host.innerHTML = '<p class="empty">Chưa có khoảnh khắc nào.</p>';
}

function applyAuthoritativeState(value) {
  state = value;
  pendingSync = false;
  $("#sync-warning").hidden = true;
  $("#rename-sync-message").hidden = true;
  renderConnectionStatus();
  renderControl();
}

function renderRotationSeconds() {
  const input = $("#rotation-seconds");
  if (document.activeElement !== input && !input.dataset.dirty) input.value = state.settings.rotation_seconds;
}

function renderControl() {
  const value = state;
  if (!value.pages.some(page => page.id === selectedPageId)) selectedPageId = value.current_page_id;
  stage.render({ ...value, current_page_id: selectedPageId });
  const page = currentPage();
  renderRotationSeconds();
  const visibleCount = (page?.cells || []).filter(cell => cell.active).length;
  $("#stage-count").textContent = `${page?.name || "Trang"} · ${visibleCount} hình · ${selectedPageId === value.current_page_id ? "đang chiếu" : "đang xem trước"}`;
  $("#pause-button").textContent = value.settings.paused ? "Tiếp tục" : "Tạm dừng";
  const select = $("#page-select");
  if (document.activeElement !== select) {
    select.replaceChildren();
    for (const item of value.pages) { const option = document.createElement("option"); option.value = item.id; option.textContent = `${item.id === value.current_page_id ? "● " : ""}${item.name}`; select.append(option); }
    select.value = selectedPageId;
  }
  const showing = selectedPageId === value.current_page_id;
  $("#live-page-name").textContent = value.pages.find(item => item.id === value.current_page_id)?.name || "Trang";
  $("#live-cycle").textContent = value.ending ? "Dấu Ấn" : value.settings.paused ? "Luân phiên đang dừng" : `Luân phiên mỗi ${value.settings.rotation_seconds} giây`;
  $("#editing-status").textContent = showing ? "Cùng trang đang chiếu" : "Ngoài màn chiếu";
  $("#editing-status").toggleAttribute("data-off-air", !showing);
  $(".stage-panel").toggleAttribute("data-preview", !showing);
  $("#stage-title").textContent = showing&&value.ending?.start_time?"Dấu Ấn · trực tiếp":showing ? "Trình chiếu trực tiếp" : "Bản xem trước trang";
  $("#show-page").textContent = showing ? "Đang chiếu" : "Chiếu trang";
  $("#show-page").toggleAttribute("data-locked", showing||!!value.ending);
  $("#snapshot-button").toggleAttribute("data-locked",showing&&!!value.ending);
  $("#pause-button").toggleAttribute("data-locked",!!value.ending);
  $("#delete-page").toggleAttribute("data-locked", value.pages.length <= 1);
  $("#delete-page").title = value.pages.length <= 1 ? "Cần giữ ít nhất một trang" : "Xóa trang";
  renderCells(); renderLibrary(); renderSnapshots(); endingControl.render(value);access();
}

const subscription = subscribeState(applyAuthoritativeState, renderConnectionStatus);

function resetLibraryPage() { libraryPage = 0; $("#library").scrollTop = 0; renderLibrary(); }
$("#library-search").addEventListener("input", resetLibraryPage);
$("#only-visible").addEventListener("change", resetLibraryPage);
$("#clear-library-filter").addEventListener("click", () => { $("#library-search").value = ""; $("#only-visible").checked = false; resetLibraryPage(); $("#library-search").focus(); });
$("#library-prev").addEventListener("click", () => { libraryPage--; $("#library").scrollTop = 0; renderLibrary(); });
$("#library-next").addEventListener("click", () => { libraryPage++; $("#library").scrollTop = 0; renderLibrary(); });
$("#led-cell-select").addEventListener("change", event => { selectedCell = Number(event.target.value); renderCells(); renderLibrary(); });
$("#refresh-button").addEventListener("click", refreshView);
$("#sync-retry").addEventListener("click", refreshView);
$("#login-button").addEventListener("click", () => { if (getToken()) { setToken(""); access(); notice("Đã đăng xuất."); } else openLogin(); });
$("#cancel-login").addEventListener("click", () => $("#login-dialog").close());
$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  try { const result = await api("/api/admin/login", { method: "POST", body: { pin: $("#admin-pin").value } }); setToken(result.token); $("#admin-pin").value = ""; $("#login-dialog").close(); access(); notice("Bàn điều khiển đã mở."); }
  catch (error) { $("#login-error").textContent = error.message; }
});
function showLibraryFolder(view) {
  libraryView = view;
  for (const button of document.querySelectorAll(".segmented button")) { const selected = button.id === `show-${view}`; button.classList.toggle("active", selected); button.setAttribute("aria-pressed", String(selected)); }
  resetLibraryPage();
}
$("#show-active").addEventListener("click", () => showLibraryFolder("active"));
$("#show-favorites").addEventListener("click", () => showLibraryFolder("favorites"));
$("#show-trash").addEventListener("click", () => showLibraryFolder("trash"));
$("#pause-button").addEventListener("click", () => mutate("/api/settings", "PATCH", { paused: !state.settings.paused }, state.settings.paused ? "Đã tiếp tục luân phiên." : "Đã tạm dừng luân phiên."));
$("#page-select").addEventListener("change", event => { selectedPageId=event.target.value; selectedCell=0; renderControl(); });
$("#show-page").addEventListener("click", () => mutate(`/api/pages/${selectedPageId}/activate`, "POST", {}, "Đã chiếu trang được chọn."));
$("#new-page").addEventListener("click", async () => { const known=new Set(state.pages.map(page=>page.id)); const result=await mutate("/api/pages", "POST", {}, "Đã tạo trang mới để chỉnh sửa."); if(result){selectedPageId=result.pages.find(page=>!known.has(page.id))?.id||result.current_page_id;selectedCell=0;renderControl();} });
$("#rename-page").addEventListener("click", () => { const page=currentPage(); $("#page-name").value=page?.name||""; $("#page-name").dataset.pageId=page?.id||""; $("#rename-page-dialog").showModal(); $("#page-name").select(); });
$("#cancel-rename").addEventListener("click", () => $("#rename-page-dialog").close());
$("#delete-page").addEventListener("click", async () => { const page=currentPage(); if(page&&state.pages.length>1&&confirm(`Xóa trang “${page.name}”? Bố cục của trang này sẽ bị xóa.`)){const index=state.pages.indexOf(page),result=await mutate(`/api/pages/${page.id}`, "DELETE", {}, "Đã xóa trang.");if(result){selectedPageId=result.pages[Math.min(index,result.pages.length-1)].id;selectedCell=0;renderControl();}} });
$("#rotation-seconds").addEventListener("input", () => { $("#rotation-seconds").dataset.dirty = "true"; });
$("#rename-page-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#page-name"), name = input.value.trim();
  if (!name) { notice("Hãy nhập tên trang.", true); return; }
  const result = await mutate(`/api/pages/${input.dataset.pageId}`, "PATCH", { name }, "Đã đổi tên trang.");
  if (result) $("#rename-page-dialog").close();
});
$("#rotation-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#rotation-seconds"), seconds = Number(input.value);
  if (!Number.isInteger(seconds) || seconds < 2 || seconds > 120) { notice("Nhập số giây từ 2 đến 120.", true); return; }
  const result = await mutate("/api/settings", "PATCH", { rotation_seconds: seconds }, `Đã đặt luân phiên mỗi ${seconds} giây.`);
  if (result) { delete input.dataset.dirty; renderRotationSeconds(); }
});
$("#snapshot-button").addEventListener("click", async () => {
  if (busy) return; if (!getToken()) { openLogin(); return; }
  busy = true; access(); notice("Đang lưu khoảnh khắc…");
  try {
    const frozen = structuredClone(state); frozen.current_page_id = selectedPageId;
    const cells = frozen.pages.find(p => p.id === frozen.current_page_id).cells;
    const blob = await stage.capture(frozen), name = `Khoảnh khắc ${new Date().toLocaleString("vi-VN")}`;
    const form = new FormData(); form.append("snapshot", blob, "snapshot.png"); form.append("name", name);
    form.append("layout", JSON.stringify(cells.map(cell => cell.active)));
    await api("/api/snapshots", { method: "POST", body: form, auth: true, timeout: 30000 });
    await refreshAfterSave("Đã lưu khoảnh khắc.");
  } catch (error) { notice(error.message, true); }
  finally { busy = false; access(); }
});

window.addEventListener("pagehide", () => { subscription.close(); stage.destroy();endingControl.destroy(); });
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
access(); if (!getToken()) openLogin();
