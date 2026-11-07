import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = { location: { href: "http://localhost:8080/" } };
const api = await import("../js/api.js");
const { calculateMetrics } = await import("../js/metrics.js");

test("REST calls target the backend on the page host and retain endpoint shapes", async (context) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const path = new URL(url).pathname;
    const payload = {
      "/health": { status: "degraded", backend: "ok", serial: { connected: false } },
      "/api/estado": { semaforo_a: null, serial_connected: false, state_stale: true },
      "/api/metricas": { total: 0, response_count: 0, response_average_ms: null },
      "/api/emergencias": { items: [], total: 0, limit: 100, offset: 0 },
      "/api/emergencias/1": { id: 1, incident_id: 7, events: [] },
    }[path];
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const dashboard = await api.getDashboardData();
  assert.equal(dashboard.health.serial.connected, false);
  assert.equal(dashboard.state.semaforo_a, null);
  assert.deepEqual(dashboard.incidents, []);
  assert.equal(dashboard.metrics.total, 0);
  assert.ok(calls.every((url) => url.startsWith("http://localhost:8000/")));

  const detail = await api.getIncident(1);
  assert.equal(detail.events.length, 0);
});

test("incident pagination reaches every persisted page", async (context) => {
  const originalFetch = globalThis.fetch;
  const offsets = [];
  globalThis.fetch = async (url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    offsets.push(offset);
    const items = offset === 0
      ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }))
      : [{ id: 101 }];
    return new Response(JSON.stringify({ items, total: 101 }), { status: 200 });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const result = await api.getAllIncidents();
  assert.deepEqual(offsets, [0, 100]);
  assert.equal(result.total, 101);
  assert.equal(result.items.length, 101);
});

test("REST errors are surfaced instead of returning demo values", async (context) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  context.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(api.getHealth(), /FastAPI respondió 503/);
});

test("WebSocket URL follows the frontend host and protocol", () => {
  assert.equal(
    api.getMonitorUrl({ href: "http://127.0.0.1:8080/#resumen" }),
    "ws://127.0.0.1:8000/ws/monitor",
  );
  assert.equal(
    api.getMonitorUrl({ href: "https://siv.local:8443/" }),
    "wss://siv.local:8000/ws/monitor",
  );
});

test("statistics use API values and calculate available incident aggregates", () => {
  const metrics = calculateMetrics([
    { status: "RECUPERADA", response_ms: 1200, duration_ms: 8000, recovery_ms: 4000, first_received_at: "2026-11-07T10:00:00Z" },
    { status: "DETECTADA", response_ms: null, duration_ms: null, recovery_ms: null, first_received_at: "2026-11-07T11:00:00Z" },
  ], {
    total: 2,
    response_count: 1,
    response_average_ms: 1200,
    response_min_ms: 1200,
    response_max_ms: 1200,
  });
  assert.equal(metrics.total, 2);
  assert.equal(metrics.response_average_ms, 1200);
  assert.equal(metrics.duration_average_ms, 8000);
  assert.deepEqual(metrics.status_counts, { RECUPERADA: 1, DETECTADA: 1 });
});
