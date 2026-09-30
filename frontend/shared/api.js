// All three interfaces use the same API; port 4173 is supported for local UI development.
export const API_BASE = location.port === "4173"
  ? `${location.protocol}//${location.hostname}:8000`
  : location.origin;

export function apiUrl(path) {
  return new URL(path, API_BASE).href;
}

export function getToken() {
  try { return sessionStorage.getItem("cos_admin_token") || ""; }
  catch { return ""; }
}

export function setToken(value) {
  if (value) sessionStorage.setItem("cos_admin_token", value);
  else sessionStorage.removeItem("cos_admin_token");
}

export async function api(path, { method = "GET", body, auth = false, timeout = 15000, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (auth && getToken()) headers.set("Authorization", `Bearer ${getToken()}`);
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(apiUrl(path), { ...options, method, headers, body, signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const detail = typeof data?.detail === "string" ? data.detail : `Yêu cầu thất bại (${response.status}). Vui lòng thử lại.`;
      const error = new Error(detail);
      error.status = response.status;
      if (response.status === 401 && auth) setToken("");
      throw error;
    }
    if (text && data === null) throw new Error("Server trả dữ liệu không hợp lệ. Vui lòng tải lại trang.");
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Server phản hồi quá lâu. Kiểm tra kết nối rồi thử lại.");
    if (error instanceof TypeError) throw new Error("Không kết nối được server. Kiểm tra Wi-Fi và thử lại.");
    throw error;
  } finally { clearTimeout(timer); }
}

// HTTP gives a complete state; WebSocket only signals that it has changed.
export function subscribeState(onState, onStatus = () => {}) {
  let closed = false;
  let socket;
  let reconnect;
  let heartbeat;
  let inFlight;
  let queued = false;
  let lastRevision = -1;

  async function refresh() {
    if (closed) return;
    if (inFlight) { queued = true; return inFlight; }
    inFlight = (async () => {
      try {
        const state = await api("/api/state");
        if (!closed && (state.revision ?? 0) >= lastRevision) {
          lastRevision = state.revision ?? 0;
          onState(state);
          if (socket?.readyState === WebSocket.OPEN) onStatus({ connected: true, message: "Đang đồng bộ trực tiếp" });
        }
        return state;
      } catch (error) {
        if (!closed) onStatus({ connected: false, message: error.message });
        return null;
      }
    })();
    try { return await inFlight; }
    finally {
      inFlight = null;
      if (queued && !closed) { queued = false; void refresh(); }
    }
  }

  function connect() {
    if (closed) return;
    const url = new URL("/ws/display", API_BASE);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      onStatus({ connected: true, message: "Đang đồng bộ trực tiếp" });
      void refresh();
      clearInterval(heartbeat);
      heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send("ping"); }, 20000);
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (["state_changed", "drawing_created"].includes(message.type)) void refresh();
      } catch { /* Ignore a transport heartbeat that contains no state. */ }
    });
    socket.addEventListener("close", () => {
      clearInterval(heartbeat);
      if (closed) return;
      onStatus({ connected: false, message: "Mất kết nối — đang nối lại…" });
      reconnect = setTimeout(connect, 2500);
    });
    socket.addEventListener("error", () => socket.close());
  }

  // A periodic reconciliation also recovers from a missed notification.
  const reconcile = setInterval(() => void refresh(), 20000);
  void refresh();
  connect();
  return {
    refresh,
    close() {
      closed = true;
      clearTimeout(reconnect);
      clearInterval(heartbeat);
      clearInterval(reconcile);
      socket?.close();
    },
  };
}
