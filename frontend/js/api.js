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
  });
  if (!response.ok) {
    throw new Error(`FastAPI respondió ${response.status} en ${path}`);
  }
  return response.json();
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

export async function getIncidentsPage(limit = 100, offset = 0) {
  return request(`/api/emergencias?limit=${limit}&offset=${offset}`);
}

export async function getAllIncidents() {
  const firstPage = await getIncidentsPage();
  const incidents = [...firstPage.items];
  for (let offset = incidents.length; offset < firstPage.total; offset += 100) {
    const page = await getIncidentsPage(100, offset);
    incidents.push(...page.items);
  }
  return { items: incidents, total: firstPage.total };
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
