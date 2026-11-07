import assert from "node:assert/strict";
import test from "node:test";
import { connectMonitor } from "../js/websocket.js";

class FakeWebSocket {
  static CLOSING = 2;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback);
    this.listeners.set(type, callbacks);
  }

  emit(type, payload = {}) {
    for (const callback of this.listeners.get(type) || []) {
      callback(payload);
    }
  }

  close() {
    this.readyState = FakeWebSocket.CLOSING;
    this.emit("close");
  }
}

test("monitor handles snapshots, reconnects progressively, and cleans up", () => {
  FakeWebSocket.instances = [];
  const timers = new Map();
  const delays = [];
  let nextTimer = 1;
  const statuses = [];
  const messages = [];
  const errors = [];
  globalThis.window = {
    location: { href: "http://localhost:8080/" },
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, callback);
      delays.push(delay);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };

  const disconnect = connectMonitor({
    WebSocketImpl: FakeWebSocket,
    onStatus: (status, error) => {
      statuses.push(status);
      if (error) errors.push(error);
    },
    onMessage: (message) => messages.push(message),
  });
  const first = FakeWebSocket.instances[0];
  assert.equal(first.url, "ws://localhost:8000/ws/monitor");
  first.emit("open");
  first.emit("message", { data: JSON.stringify({ type: "snapshot", data: {} }) });
  for (const type of ["state", "heartbeat", "incident", "connection"]) {
    first.emit("message", { data: JSON.stringify({ type, data: { uptime_ms: 10 } }) });
  }
  first.emit("message", { data: "not-json" });
  first.emit("close");
  assert.deepEqual(messages.map((message) => message.type), [
    "snapshot",
    "state",
    "heartbeat",
    "incident",
    "connection",
  ]);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof SyntaxError);
  assert.deepEqual(delays, [30_000, 1000]);

  const [timerId, reconnect] = [...timers.entries()][0];
  timers.delete(timerId);
  reconnect();
  assert.equal(FakeWebSocket.instances.length, 2);
  FakeWebSocket.instances[1].emit("close");
  assert.deepEqual(delays, [30_000, 1000, 2000]);

  disconnect();
  assert.equal(timers.size, 0);
  assert.ok(statuses.includes("connected"));
  assert.ok(statuses.includes("disconnected"));
});
