import { getMonitorUrl } from "./api.js";

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

export function connectMonitor({
  onMessage,
  onStatus,
  WebSocketImpl = WebSocket,
  location = window.location,
}) {
  let socket = null;
  let retryTimer = null;
  let stableTimer = null;
  let retryDelay = INITIAL_RETRY_MS;
  let closed = false;

  function connect() {
    if (closed) return;
    onStatus("connecting");
    try {
      socket = new WebSocketImpl(getMonitorUrl(location));
    } catch (error) {
      onStatus("disconnected", error);
      scheduleReconnect();
      return;
    }

    socket.addEventListener("open", () => {
      if (closed) return;
      onStatus("connected");
      stableTimer = window.setTimeout(() => {
        stableTimer = null;
        retryDelay = INITIAL_RETRY_MS;
      }, MAX_RETRY_MS);
    });
    socket.addEventListener("message", (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch (error) {
        onStatus("invalid-message", error);
      }
    });
    socket.addEventListener("error", () => onStatus("disconnected"));
    socket.addEventListener("close", () => {
      if (closed) return;
      if (stableTimer !== null) window.clearTimeout(stableTimer);
      stableTimer = null;
      onStatus("disconnected");
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (closed || retryTimer !== null) return;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
  }

  connect();
  return () => {
    closed = true;
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    if (stableTimer !== null) window.clearTimeout(stableTimer);
    retryTimer = null;
    stableTimer = null;
    if (socket && socket.readyState < WebSocketImpl.CLOSING) socket.close();
  };
}
