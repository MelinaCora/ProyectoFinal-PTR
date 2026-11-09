import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = { location: { href: "http://localhost:8080/" } };
const api = await import("../js/api.js");
const { calculateMetrics, getPeriodRange } = await import("../js/metrics.js");

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

test("filtered incident pages and CSV URLs preserve selected query parameters", async (context) => {
  const originalFetch = globalThis.fetch;
  let calledUrl;
  globalThis.fetch = async (url) => {
    calledUrl = new URL(url);
    return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
  };
  context.after(() => { globalThis.fetch = originalFetch; });
  await api.getIncidentsPage(25, 50, {
    start: "2026-01-01T03:00:00.000Z",
    end: "2026-01-02T03:00:00.000Z",
    status: "INCOMPLETO",
    search: "31",
    order: "asc",
  });
  assert.equal(calledUrl.searchParams.get("limit"), "25");
  assert.equal(calledUrl.searchParams.get("offset"), "50");
  assert.equal(calledUrl.searchParams.get("estado"), "INCOMPLETO");
  assert.equal(calledUrl.searchParams.get("buscar"), "31");
  assert.equal(calledUrl.searchParams.get("orden"), "asc");
  const exportUrl = new URL(api.getIncidentsCsvUrl(
    { start: "2026-01-01T03:00:00.000Z", status: "RECUPERADA" },
    { href: "http://localhost:8080/" },
  ));
  assert.equal(exportUrl.origin, "http://localhost:8000");
  assert.equal(exportUrl.searchParams.get("estado"), "RECUPERADA");
  assert.equal(exportUrl.searchParams.has("desde"), true);
});

test("analytics endpoint rejects a stale or incomplete FastAPI response", async (context) => {
  const originalFetch = globalThis.fetch;
  const legacyPayload = {
    total: 455,
    response_count: 455,
    response_average_ms: 1606.6,
    response_min_ms: 0,
    response_max_ms: 3004,
  };
  globalThis.fetch = async () => new Response(JSON.stringify(legacyPayload), { status: 200 });
  context.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(
    api.getAnalytics(),
    /estadísticas incompletas.*completed.*pending/,
  );

  globalThis.fetch = async () => new Response(JSON.stringify({
    ...legacyPayload,
    completed: 455,
    pending: 0,
    duration_average_ms: null,
    recovery_average_ms: null,
    status_counts: { RECUPERADA: 455 },
    incidents_by_day: { "2026-01-01": 455 },
    response_series: [],
  }), { status: 200 });
  await assert.rejects(api.getAnalytics(), /estadísticas incoherentes/);
});

test("analytics accepts consistent chart data and preserves zero response times", async (context) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    total: 2,
    completed: 1,
    pending: 1,
    response_count: 2,
    response_average_ms: 150,
    response_min_ms: 0,
    response_max_ms: 300,
    duration_average_ms: 900,
    recovery_average_ms: 50,
    status_counts: { RECUPERADA: 1, PRIORIDAD_ACTIVADA: 1 },
    incidents_by_day: { "2026-01-01": 2 },
    response_series: [
      { incident_id: 1, response_ms: 0, first_received_at: "2026-01-01T00:00:00Z" },
      { incident_id: 2, response_ms: 300, first_received_at: "2026-01-01T00:01:00Z" },
    ],
  }), { status: 200 });
  context.after(() => { globalThis.fetch = originalFetch; });
  const data = await api.getAnalytics();
  assert.equal(data.total, 2);
  assert.equal(data.response_series[0].response_ms, 0);
  assert.equal(data.duration_average_ms, 900);
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

test("custom date filters use local inclusive calendar dates and an exclusive UTC end", () => {
  const range = getPeriodRange(
    "custom",
    "2026-01-01",
    "2026-01-02",
    new Date("2026-01-10T12:00:00Z"),
  );
  assert.equal(new Date(range.start).getTime(), new Date(2026, 0, 1).getTime());
  assert.equal(new Date(range.end).getTime(), new Date(2026, 0, 3).getTime());
  assert.match(getPeriodRange("custom", "", "").error, /dos fechas/);
  assert.match(getPeriodRange("custom", "2026-01-03", "2026-01-02").error, /anterior/);
});
