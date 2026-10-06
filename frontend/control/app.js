import { api, apiUrl, getToken, setToken, subscribeState } from "../shared/api.js";
import { Stage } from "./stage.js?v=20261006-exhibition";
import {EndingControl} from './ending.js';

const $ = selector => document.querySelector(selector);
let state, busy = false, libraryView = "active", selectedCell = 0, selectedPageId, notificationTimer;

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
    const result = await subscription.refresh(); notice(message); return result;
  } catch (error) {
    notice(error.message, true);
    if (error.status === 401) openLogin();
    if (state) stage.render(state);
  } finally {
    busy = false; access(); renderCells(); renderLibrary();
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
  $("#library-target").textContent = `Thêm nét vẽ vào ô ${String(selectedCell + 1).padStart(2, "0")}`;
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
  const host = $("#library"); host.replaceChildren();
  const query = $("#library-search").value.trim().toLowerCase();
  const page = currentPage(), cells = page?.cells || [];
  const membership = new Map(cells.flatMap(cell => cell.drawing_ids.map(id => [id, cell.id])));
  const visible = new Set(cells.map(cell => cell.active).filter(Boolean));
  const drawings = state.drawings.filter(drawing => {
    const inFolder = libraryView === "trash" ? Boolean(drawing.deleted) : !drawing.deleted && (libraryView !== "favorites" || drawing.favorite);
    return inFolder && drawing.id.toLowerCase().includes(query) && (!$("#only-visible").checked || visible.has(drawing.id));
  }).slice().sort((a, b) => b.created_at - a.created_at);
  $("#library-count").textContent = drawings.length;
  if (!drawings.length) {
    const empty = document.createElement("p"); empty.className = "empty";
    empty.textContent = query || $("#only-visible").checked ? "Không có hình khớp bộ lọc." : libraryView === "trash" ? "Thùng rác đang trống." : libraryView === "favorites" ? "Chưa có nét vẽ yêu thích." : "Chưa có nét vẽ.";
    host.append(empty);
  }
  for (const drawing of drawings) {
    const card = document.createElement("article"); card.className = "library-card";
    const image = document.createElement("img"); image.src = apiUrl(drawing.image_path); image.alt = `Nét vẽ ${drawing.id.slice(0, 8)}`; image.loading = "lazy";
    const meta = document.createElement("div"); meta.className = "library-meta";
    meta.textContent = `#${drawing.id.slice(0, 6)}${membership.has(drawing.id) ? ` · Ô ${membership.get(drawing.id) + 1}` : ""}`;
    const favorite = makeButton(drawing.favorite ? "♥" : "♡", () => mutate(`/api/drawings/${drawing.id}/favorite`, "PATCH", { favorite: !drawing.favorite }, drawing.favorite ? "Đã bỏ khỏi Yêu thích." : "Đã thêm vào Yêu thích."));
    favorite.classList.add("favorite-button");
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
        makeButton(label, () => mutate(`/api/pages/${page.id}/items`, "POST", { drawing_id: drawing.id, cell_id: selectedCell }, oldCell === undefined ? `Đã thêm hình vào ô ${selectedCell + 1}.` : `Đã chuyển hình vào ô ${selectedCell + 1}.`), { disabled: inTargetCell }),
        makeButton("Cất đi", () => { if (confirm("Cất nét vẽ này khỏi tất cả các trang? Bạn có thể khôi phục từ thùng rác.")) mutate(`/api/drawings/${drawing.id}`, "DELETE", {}, "Đã đưa hình vào thùng rác."); }, { danger: true }));
    }
    if (visible.has(drawing.id)) card.classList.add("on-stage");
    if (drawing.favorite) {
      const download = document.createElement("a");
      download.href = apiUrl(`/api/favorites/${drawing.id}`);
      download.download = `${drawing.id}.svg`;
      download.textContent = "↓ Tải SVG";
      actions.append(download);
    }
    card.append(image, favorite, meta, actions); host.append(card);
  }
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

function render(value) {
  state = value;
  if (!value.pages.some(page => page.id === selectedPageId)) selectedPageId = value.current_page_id;
  stage.render({ ...value, current_page_id: selectedPageId });
  const page = currentPage();
  if (document.activeElement !== $("#rotation-seconds") && !$("#rotation-seconds").dataset.dirty) $("#rotation-seconds").value = value.settings.rotation_seconds;
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

const subscription = subscribeState(render, status => { $("#connection-status").textContent = `${status.connected ? "●" : "○"} ${status.message}`; $("#connection-status").classList.toggle("connected", status.connected); });

$("#library-search").addEventListener("input", renderLibrary);
$("#only-visible").addEventListener("change", renderLibrary);
$("#led-cell-select").addEventListener("change", event => { selectedCell = Number(event.target.value); renderCells(); renderLibrary(); });
$("#refresh-button").addEventListener("click", () => subscription.refresh());
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
  renderLibrary();
}
$("#show-active").addEventListener("click", () => showLibraryFolder("active"));
$("#show-favorites").addEventListener("click", () => showLibraryFolder("favorites"));
$("#show-trash").addEventListener("click", () => showLibraryFolder("trash"));
$("#pause-button").addEventListener("click", () => mutate("/api/settings", "PATCH", { paused: !state.settings.paused }, state.settings.paused ? "Đã tiếp tục luân phiên." : "Đã tạm dừng luân phiên."));
$("#page-select").addEventListener("change", event => { selectedPageId=event.target.value; selectedCell=0; render(state); });
$("#show-page").addEventListener("click", () => mutate(`/api/pages/${selectedPageId}/activate`, "POST", {}, "Đã chiếu trang được chọn."));
$("#new-page").addEventListener("click", async () => { const known=new Set(state.pages.map(page=>page.id)); const result=await mutate("/api/pages", "POST", {}, "Đã tạo trang mới để chỉnh sửa."); if(result){selectedPageId=result.pages.find(page=>!known.has(page.id))?.id||result.current_page_id;selectedCell=0;render(result);} });
$("#rename-page").addEventListener("click", () => { const page=currentPage(); $("#page-name").value=page?.name||""; $("#page-name").dataset.pageId=page?.id||""; $("#rename-page-dialog").showModal(); $("#page-name").select(); });
$("#cancel-rename").addEventListener("click", () => $("#rename-page-dialog").close());
$("#delete-page").addEventListener("click", async () => { const page=currentPage(); if(page&&state.pages.length>1&&confirm(`Xóa trang “${page.name}”? Bố cục của trang này sẽ bị xóa.`)){const index=state.pages.indexOf(page),result=await mutate(`/api/pages/${page.id}`, "DELETE", {}, "Đã xóa trang.");if(result){selectedPageId=result.pages[Math.min(index,result.pages.length-1)].id;selectedCell=0;render(result);}} });
$("#rotation-seconds").addEventListener("input", () => { $("#rotation-seconds").dataset.dirty = "true"; });
$("#rename-page-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#page-name"), name = input.value.trim();
  if (!name) { notice("Hãy nhập tên trang.", true); return; }
  const result = await mutate(`/api/pages/${input.dataset.pageId}`, "PATCH", { name }, "Đã đổi tên trang.");
  if (result) { $("#rename-page-dialog").close(); render(result); }
});
$("#rotation-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#rotation-seconds"), seconds = Number(input.value);
  if (!Number.isInteger(seconds) || seconds < 2 || seconds > 120) { notice("Nhập số giây từ 2 đến 120.", true); return; }
  const result = await mutate("/api/settings", "PATCH", { rotation_seconds: seconds }, `Đã đặt luân phiên mỗi ${seconds} giây.`);
  if (result) { delete input.dataset.dirty; render(result); }
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
    await subscription.refresh(); notice("Đã lưu khoảnh khắc.");
  } catch (error) { notice(error.message, true); }
  finally { busy = false; access(); }
});

window.addEventListener("pagehide", () => { subscription.close(); stage.destroy();endingControl.destroy(); });
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
access(); if (!getToken()) openLogin();
