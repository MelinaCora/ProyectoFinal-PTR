function getApiBaseUrl(location = window.location) {
  const url = new URL(location.href);
  url.port = "8000";
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
}

async function request(path) {
  const response = await fetch(new URL(path, `${getApiBaseUrl()}/`), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`FastAPI respondió ${response.status} en ${path}`);
  }
  return response.json();
}

function validateAnalytics(payload) {
  const requiredNumbers = [
    "total",
    "completed",
    "pending",
    "response_count",
  ];
  const missing = requiredNumbers.filter((field) => !Number.isFinite(payload?.[field]));
  const nullableMeasurements = [
    "response_average_ms",
    "response_min_ms",
    "response_max_ms",
    "duration_average_ms",
    "recovery_average_ms",
  ];
  for (const field of nullableMeasurements) {
    if (!Object.hasOwn(payload || {}, field)
      || (payload[field] !== null
        && (!Number.isFinite(payload[field]) || payload[field] < 0))) {
      missing.push(field);
    }
  }
  for (const field of ["status_counts", "incidents_by_day"]) {
    if (!payload?.[field] || typeof payload[field] !== "object" || Array.isArray(payload[field])) {
      missing.push(field);
    }
  }
  if (!Array.isArray(payload?.response_series)) missing.push("response_series");
  if (missing.length) {
    throw new Error(
      `FastAPI devolvió estadísticas incompletas (${missing.join(", ")}); reiniciá el backend actualizado.`,
    );
  }
  const validCounts = (counts) => Object.values(counts)
    .every((count) => Number.isSafeInteger(count) && count >= 0);
  if (!validCounts(payload.status_counts) || !validCounts(payload.incidents_by_day)
    || !payload.response_series.every((item) => Number.isFinite(item?.response_ms)
      && item.response_ms >= 0)) {
    throw new Error("FastAPI devolvió estadísticas con valores inválidos.");
  }
  const statusTotal = Object.values(payload.status_counts)
    .reduce((sum, count) => sum + count, 0);
  const dailyTotal = Object.values(payload.incidents_by_day)
    .reduce((sum, count) => sum + count, 0);
  if (payload.completed + payload.pending !== payload.total
    || statusTotal !== payload.total
    || dailyTotal !== payload.total
    || (payload.response_count > 0
      && !payload.response_series.some((item) => Number.isFinite(item.response_ms)))) {
    throw new Error(
      "FastAPI devolvió estadísticas incoherentes para el período; revisá la versión del backend.",
    );
  }
  return payload;
}

export async function getHealth() {
  return request("/health");
}

export async function getState() {
  return request("/api/estado");
}

export async function getMetrics() {
  return request("/api/metricas");
}

function filterParams(filters = {}) {
  const params = new URLSearchParams();
  if (filters.start) params.set("desde", filters.start);
  if (filters.end) params.set("hasta", filters.end);
  if (filters.status && filters.status !== "todos") params.set("estado", filters.status);
  if (filters.search?.trim()) params.set("buscar", filters.search.trim());
  if (filters.order) params.set("orden", filters.order);
  return params;
}

export async function getAnalytics(filters = {}) {
  const params = filterParams(filters);
  params.set("detalle", "true");
  return validateAnalytics(await request(`/api/metricas?${params}`));
}

export async function getIncidentsPage(limit = 25, offset = 0, filters = {}) {
  const params = filterParams(filters);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return request(`/api/emergencias?${params}`);
}

export async function getAllIncidents() {
  const firstPage = await getIncidentsPage(100, 0);
  const incidents = [...firstPage.items];
  for (let offset = incidents.length; offset < firstPage.total; offset += 100) {
    const page = await getIncidentsPage(100, offset);
    incidents.push(...page.items);
  }
  return { items: incidents, total: firstPage.total };
}

export function getIncidentsCsvUrl(filters = {}, location = window.location) {
  const url = new URL("/api/emergencias/export.csv", getApiBaseUrl(location));
  url.search = filterParams(filters).toString();
  return url.toString();
}

export async function getIncident(id) {
  return request(`/api/emergencias/${encodeURIComponent(id)}`);
}

export async function getDashboardData() {
  const [health, state, metrics, incidentPage] = await Promise.all([
    getHealth(),
    getState(),
    getMetrics(),
    getAllIncidents(),
  ]);
  return { health, state, metrics, incidents: incidentPage.items };
}

export function getMonitorUrl(location = window.location) {
  const url = new URL(location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.port = "8000";
  url.pathname = "/ws/monitor";
  url.search = "";
  url.hash = "";
  return url.toString();
}
