import {
  getAllIncidents,
  getHealth,
  getIncident,
  getMetrics,
  getState,
} from "./api.js";
import { calculateMetrics } from "./metrics.js";
import { connectMonitor } from "./websocket.js";

const UNKNOWN_STATE = {
  semaforo_a: null,
  semaforo_b: null,
  fase: null,
  modo: null,
  restante_ms: null,
  last_heartbeat_received_at: null,
  last_message_received_at: null,
  state_received_at: null,
  serial_connected: false,
  controller_observed: false,
  state_stale: true,
  active_session_id: null,
};

const state = {
  data: {
    state: { ...UNKNOWN_STATE },
    incidents: [],
    events: [],
    metrics: null,
    health: null,
    apiAvailable: false,
    websocketConnected: false,
  },
  activeView: "resumen",
  search: "",
  statusFilter: "todos",
  dateOrder: "desc",
  previousStale: true,
  disconnectSocket: null,
  refreshTimer: null,
  staleTimer: null,
  alertTimer: null,
  clockTimer: null,
  backendError: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const locale = "es-AR";
const dateTimeFormat = new Intl.DateTimeFormat(locale, {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat(locale, {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatDate(value, options = dateTimeFormat) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : options.format(date);
}

function formatDuration(milliseconds, precision = 1) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  if (milliseconds < 1000) return `${milliseconds} ms`;
  const seconds = milliseconds / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(precision)} s`;
}

function formatTimeOfDay(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
}

function statusLabel(status) {
  return ({
    RECUPERADA: "Recuperada",
    FINALIZADA: "Finalizada",
    PRIORIDAD_ACTIVADA: "Prioridad activa",
    DETECTADA: "Detectada",
    INCOMPLETO: "Incompleta",
  })[status] || status || "Sin estado";
}

function eventLabel(type) {
  return ({
    HEARTBEAT: "Heartbeat",
    STATE: "Cambio de estado",
    BOOT: "Inicio del controlador",
    EMERGENCIA_DETECTADA: "Emergencia detectada",
    PRIORIDAD_ACTIVADA: "Prioridad activada",
    EMERGENCIA_FINALIZADA: "Emergencia finalizada",
    CICLO_RECUPERADO: "Ciclo recuperado",
    FALLO_SEGURO: "Fallo seguro",
  })[type] || type || "Evento";
}

function eventDescription(type) {
  return ({
    HEARTBEAT: "Señal periódica recibida del controlador.",
    STATE: "El controlador informó un cambio de estado.",
    BOOT: "Se inició una nueva sesión del controlador.",
    EMERGENCIA_DETECTADA: "Solicitud acústica confirmada para el carril A.",
    PRIORIDAD_ACTIVADA: "Prioridad habilitada para el carril A.",
    EMERGENCIA_FINALIZADA: "Finalizó la emergencia; prioridad liberada.",
    CICLO_RECUPERADO: "El ciclo volvió al funcionamiento normal.",
    FALLO_SEGURO: "El controlador informó un estado de fallo seguro.",
  })[type] || "Evento recibido del sistema.";
}

function eventStatus(type) {
  return ({
    HEARTBEAT: "OK",
    STATE: "OK",
    BOOT: "OK",
    EMERGENCIA_DETECTADA: "DETECTADA",
    PRIORIDAD_ACTIVADA: "PRIORIDAD_ACTIVADA",
    EMERGENCIA_FINALIZADA: "FINALIZADA",
    CICLO_RECUPERADO: "RECUPERADA",
    FALLO_SEGURO: "FALLO",
  })[type] || "OK";
}

function statusTone(status) {
  if (status === "RECUPERADA" || status === "FINALIZADA" || status === "OK") return "green";
  if (status === "PRIORIDAD_ACTIVADA" || status === "DETECTADA") return "amber";
  if (status === "INCOMPLETO" || status === "FALLO") return "red";
  return "neutral";
}

function lightName(color) {
  return ({ R: "Rojo", A: "Amarillo", G: "Verde" })[color] || "No disponible";
}

function lightTone(color) {
  return ({ R: "red", A: "amber", G: "green" })[color] || "unknown";
}

function renderMetricCard({ label, value, note, tone = "neutral", marker = "" }) {
  return `<article class="metric-card">
    <div class="metric-label">${escapeHTML(label)}</div>
    <div class="metric-value ${tone !== "neutral" ? `metric-value--${tone}` : ""}">${marker ? `<span class="status-dot status-dot--${marker}" aria-hidden="true"></span>` : ""}${escapeHTML(value)}</div>
    <div class="metric-note">${escapeHTML(note)}</div>
  </article>`;
}

function stateMeasurementStale(current) {
  if (current.state_stale) return true;
  const observedAt = current.state_received_at || current.last_heartbeat_received_at;
  if (!observedAt) return true;
  const age = Date.now() - new Date(observedAt).getTime();
  return !Number.isFinite(age) || age > 5000;
}

function renderSignals() {
  const current = state.data.state;
  const stale = stateMeasurementStale(current);
  return ["a", "b"].map((lane) => {
    const color = current[`semaforo_${lane}`];
    const priority = lane === "a" && current.modo === "EMERGENCIA";
    const remaining = stale ? null : current.restante_ms;
    return `<article class="panel signal-card">
      <div class="signal-card-heading">
        <div><p class="eyebrow">CANAL ${lane.toUpperCase()}</p><h3>Semáforo ${lane.toUpperCase()}</h3></div>
        <span class="signal-state-tag signal-state-tag--${lightTone(color)}"><span class="status-dot status-dot--${lightTone(color)}" aria-hidden="true"></span>${escapeHTML(lightName(color))}</span>
      </div>
      <div class="signal-card-body">
        <div class="signal-stack" aria-label="Indicador de color: ${escapeHTML(lightName(color))}">
          <span class="signal-lamp signal-lamp--red ${color === "R" ? "is-on" : ""}"></span>
          <span class="signal-lamp signal-lamp--amber ${color === "A" ? "is-on" : ""}"></span>
          <span class="signal-lamp signal-lamp--green ${color === "G" ? "is-on" : ""}"></span>
        </div>
        <div class="signal-details">
          <div class="signal-phase"><span class="detail-label">FASE ACTUAL</span><strong>${escapeHTML(current.fase || "—")}</strong></div>
          <div class="signal-subdetails">
            <div><span class="detail-label">${lane === "a" ? "PRIORIDAD" : "OPERACIÓN"}</span><strong class="${priority ? "text-amber" : ""}">${lane === "a" ? (priority ? "Habilitada" : current.modo ? "No solicitada" : "—") : escapeHTML(current.modo || "—")}</strong></div>
            <div><span class="detail-label">RESTANTE</span><strong>${remaining == null ? "—" : escapeHTML(formatDuration(remaining))}</strong></div>
          </div>
        </div>
      </div>
    </article>`;
  }).join("");
}

function renderActivity(events, limit = events.length) {
  if (!events.length) {
    return `<div class="empty-state empty-state--compact"><strong>${state.data.apiAvailable ? "Sin actividad registrada" : "Backend no disponible"}</strong><span>${state.data.apiAvailable ? "No hay eventos recientes disponibles." : "La actividad se mostrará cuando FastAPI responda."}</span></div>`;
  }
  return events.slice(0, limit).map((event) => {
    const tone = event.type === "FALLO_SEGURO" ? "red" : statusTone(event.status);
    return `<article class="activity-item">
      <span class="activity-marker activity-marker--${tone}" aria-hidden="true"></span>
      <time class="activity-time" datetime="${escapeHTML(event.received_at || "")}">${escapeHTML(formatDate(event.received_at))}</time>
      <div class="activity-copy"><strong>${escapeHTML(eventLabel(event.type))}${event.incident_id ? ` <span class="inline-id">#${escapeHTML(event.incident_id)}</span>` : ""}</strong><span>${escapeHTML(event.description || eventDescription(event.type))}</span></div>
      <span class="status-badge status-badge--${tone}">${escapeHTML(statusLabel(event.status))}</span>
    </article>`;
  }).join("");
}

function dashboardMetrics() {
  return calculateMetrics(state.data.incidents, state.data.metrics || {});
}

function renderSummary() {
  const { data } = state;
  const metrics = dashboardMetrics();
  const latest = data.incidents[0];
  const controllerHealthy = data.state.controller_observed
    && !stateMeasurementStale(data.state)
    && (data.apiAvailable || data.websocketConnected);
  const responseNote = data.metrics
    ? `${metrics.response_count} registros con dato válido`
    : "No disponible";
  const controllerValue = !data.apiAvailable && !data.websocketConnected
    ? "No disponible"
    : controllerHealthy ? "Observado" : data.state.state_stale ? "Desactualizado" : "Sin telemetría";
  $("#summary-metrics").innerHTML = [
    renderMetricCard({
      label: "Controlador",
      value: controllerValue,
      note: `FSM · ${data.state.fase || "—"}`,
      tone: controllerHealthy ? "green" : "amber",
      marker: controllerHealthy ? "green" : "amber",
    }),
    renderMetricCard({
      label: "Emergencias",
      value: data.metrics ? String(metrics.total) : "—",
      note: "Incidentes persistidos",
    }),
    renderMetricCard({
      label: "Respuesta promedio",
      value: formatDuration(metrics.response_average_ms),
      note: responseNote,
    }),
    renderMetricCard({
      label: "Última emergencia",
      value: latest ? formatDate(latest.first_received_at) : "—",
      note: latest ? `Incidente #${latest.incident_id}` : "Sin registros",
    }),
    renderMetricCard({
      label: "Comunicación",
      value: !data.apiAvailable ? "No disponible" : data.state.serial_connected ? "Conectada" : "Desconectada",
      note: `Heartbeat · ${formatTimeOfDay(data.state.last_heartbeat_received_at)}`,
      tone: data.state.serial_connected ? "green" : "red",
      marker: data.state.serial_connected ? "green" : "red",
    }),
  ].join("");
  $("#summary-signals").innerHTML = renderSignals();
  $("#summary-activity").innerHTML = renderActivity(data.events, 5);
  const healthText = !data.apiAvailable
    ? data.websocketConnected
      ? "Estado en vivo disponible; API REST e historial no disponibles."
      : "No se puede consultar el backend."
    : controllerHealthy
      ? "Telemetría reciente recibida del controlador."
      : data.state.serial_connected
        ? "La telemetría del controlador está desactualizada."
        : "Sin conexión serial con el controlador.";
  $("#summary-health").innerHTML = `<div class="health-status"><span class="health-indicator ${controllerHealthy ? "health-indicator--green" : "health-indicator--amber"}"></span><div><strong>${controllerValue}</strong><span>${escapeHTML(healthText)}</span></div></div>
    <dl class="detail-list">
      <div><dt>Modo operativo</dt><dd><span class="mode-dot mode-dot--${escapeHTML((data.state.modo || "desconocido").toLowerCase())}"></span>${escapeHTML(data.state.modo || "—")}</dd></div>
      <div><dt>Último heartbeat</dt><dd>${escapeHTML(formatDate(data.state.last_heartbeat_received_at))}</dd></div>
      <div><dt>Sesión activa</dt><dd class="mono-value">${escapeHTML(data.state.active_session_id || "—")}</dd></div>
    </dl>`;
}

function renderMonitor() {
  const current = state.data.state;
  const mode = current.modo || "DESCONOCIDO";
  const modeClass = mode.toLowerCase();
  const stale = stateMeasurementStale(current);
  const remaining = stale ? null : current.restante_ms;
  $("#monitor-mode").className = `mode-badge mode-badge--${modeClass}`;
  $("#monitor-mode").innerHTML = `<span class="mode-dot mode-dot--${modeClass}" aria-hidden="true"></span>${escapeHTML(mode)}`;
  $("#monitor-signals").innerHTML = renderSignals();
  $("#monitor-fsm").innerHTML = `<div class="fsm-current"><span class="fsm-label">FASE ACTUAL</span><strong>${escapeHTML(current.fase || "—")}</strong><span class="fsm-mode mode-badge mode-badge--${modeClass}"><span class="mode-dot mode-dot--${modeClass}" aria-hidden="true"></span>${escapeHTML(mode)}</span></div>
    <div class="fsm-progress"><div class="fsm-progress-label"><span>Tiempo restante de fase</span><strong>${remaining == null ? "—" : escapeHTML(formatDuration(remaining))}</strong></div><div class="progress-track"><span style="width:${remaining == null ? 0 : Math.max(4, Math.min(100, (remaining / 10_000) * 100))}%"></span></div><small>${stale ? "Telemetría desactualizada; el tiempo restante no se muestra." : "Valor informado por la última telemetría recibida."}</small></div>
    <div class="mode-legend">${["NORMAL", "EMERGENCIA", "RECUPERACION", "FALLO"].map((item) => `<span class="${mode === item ? "is-current" : ""}"><span class="mode-dot mode-dot--${item.toLowerCase()}" aria-hidden="true"></span>${item}</span>`).join("")}</div>`;
  $("#monitor-telemetry").innerHTML = `<dl class="detail-list detail-list--telemetry">
      <div><dt>Controlador</dt><dd><span class="status-badge status-badge--${current.controller_observed ? "green" : "amber"}">${!state.data.apiAvailable ? "No disponible" : current.controller_observed ? "Observado" : "No observado"}</span></dd></div>
      <div><dt>Conexión serial</dt><dd><span class="status-dot status-dot--${current.serial_connected ? "green" : "red"}" aria-hidden="true"></span>${state.data.apiAvailable ? current.serial_connected ? "Conectada" : "Desconectada" : "No disponible"}</dd></div>
      <div><dt>Heartbeat recibido</dt><dd>${escapeHTML(formatDate(current.last_heartbeat_received_at))}</dd></div>
      <div><dt>Última señal (hora local)</dt><dd>${escapeHTML(formatTimeOfDay(current.last_heartbeat_received_at))}</dd></div>
      <div><dt>Sesión</dt><dd class="mono-value">${escapeHTML(current.active_session_id || "—")}</dd></div>
      <div><dt>Frescura del estado</dt><dd>${!state.data.apiAvailable ? "No disponible" : stale ? "Desactualizado" : "Actual"}</dd></div>
    </dl>`;
  $("#monitor-event-count").textContent = `${state.data.events.length} eventos`;
  $("#monitor-activity").innerHTML = renderActivity(state.data.events);
}

function filteredIncidents() {
  const query = state.search.trim().replace(/^#/, "").toLowerCase();
  return state.data.incidents
    .filter((incident) => !query || String(incident.incident_id).includes(query) || String(incident.id).includes(query))
    .filter((incident) => state.statusFilter === "todos" || incident.status === state.statusFilter)
    .sort((a, b) => {
      const difference = new Date(a.first_received_at) - new Date(b.first_received_at);
      return state.dateOrder === "asc" ? difference : -difference;
    });
}

function renderIncidents() {
  const incidents = filteredIncidents();
  const tbody = $("#incident-rows");
  tbody.innerHTML = incidents.map((incident) => `<tr>
    <td><span class="incident-id">#${escapeHTML(incident.incident_id)}</span><span class="cell-subtext">${escapeHTML((incident.session_id || "—").slice(0, 14))}${incident.session_id ? "…" : ""}</span></td>
    <td><span class="date-cell">${escapeHTML(formatDate(incident.first_received_at))}</span></td>
    <td><span class="status-badge status-badge--${statusTone(incident.status)}">${escapeHTML(statusLabel(incident.status))}</span></td>
    <td class="duration-cell">${escapeHTML(formatDuration(incident.response_ms))}</td>
    <td class="duration-cell">${escapeHTML(formatDuration(incident.duration_ms))}</td>
    <td class="duration-cell">${escapeHTML(formatDuration(incident.recovery_ms))}</td>
    <td><button class="row-action" type="button" data-incident-id="${escapeHTML(incident.id)}" aria-label="Ver detalle del incidente ${escapeHTML(incident.incident_id)}">Detalle <span aria-hidden="true">→</span></button></td>
  </tr>`).join("");
  $("#incident-count").textContent = state.data.metrics
    ? `${state.data.metrics.total} incidentes`
    : "— incidentes";
  $("#incident-empty").hidden = incidents.length > 0;
  $(".table-scroll").hidden = incidents.length === 0;
  $("#incident-results").textContent = state.data.apiAvailable
    ? `Mostrando ${incidents.length} de ${state.data.incidents.length} incidentes`
    : "Historial no disponible: backend desconectado";
  if (!incidents.length) {
    $("#incident-empty").querySelector("strong").textContent = state.data.apiAvailable
      ? "No hay incidentes para mostrar"
      : "Historial no disponible";
    $("#incident-empty").querySelector("span").textContent = state.data.apiAvailable
      ? "No hay registros o ningún incidente coincide con la búsqueda y los filtros."
      : "El historial persistido se mostrará al restablecer FastAPI.";
  }
}

async function renderIncidentDetail(rowId) {
  $("#dialog-title").textContent = "Cargando incidente…";
  $("#dialog-content").innerHTML = `<div class="empty-state empty-state--compact"><span>Consultando detalle persistido en FastAPI.</span></div>`;
  $("#incident-dialog").showModal();
  try {
    const incident = await getIncident(rowId);
    if (!$("#incident-dialog").open) return;
    const detail = incident.events || [];
    $("#dialog-title").textContent = `Incidente #${incident.incident_id}`;
    $("#dialog-content").innerHTML = `<div class="dialog-summary">
        <span class="status-badge status-badge--${statusTone(incident.status)}">${escapeHTML(statusLabel(incident.status))}</span>
        <span class="dialog-date">${escapeHTML(formatDate(incident.first_received_at))}</span>
      </div>
      <dl class="detail-list dialog-metrics">
        <div><dt>Respuesta</dt><dd>${escapeHTML(formatDuration(incident.response_ms))}</dd></div>
        <div><dt>Duración</dt><dd>${escapeHTML(formatDuration(incident.duration_ms))}</dd></div>
        <div><dt>Recuperación</dt><dd>${escapeHTML(formatDuration(incident.recovery_ms))}</dd></div>
        <div><dt>Sesión de Arduino</dt><dd class="mono-value">${escapeHTML(incident.session_id)}</dd></div>
      </dl>
      <div class="dialog-events"><p class="eyebrow">EVENTOS DEL INCIDENTE</p>${detail.length ? detail.map((event) => `<div class="dialog-event"><span class="activity-marker activity-marker--${event.type === "EMERGENCIA_DETECTADA" ? "amber" : event.type === "FALLO_SEGURO" ? "red" : "green"}" aria-hidden="true"></span><div><strong>${escapeHTML(eventLabel(event.type))}</strong><span>${escapeHTML(formatDate(event.received_at))}<span class="event-separator">·</span>uptime ${escapeHTML(formatDuration(event.arduino_uptime_ms))}</span></div></div>`).join("") : `<div class="empty-state empty-state--compact"><span>Sin eventos disponibles.</span></div>`}</div>`;
  } catch (error) {
    showBackendError(error);
    if ($("#incident-dialog").open) {
      $("#dialog-title").textContent = `Incidente #${escapeHTML(rowId)}`;
      $("#dialog-content").innerHTML = `<div class="empty-state empty-state--compact"><strong>No se pudo cargar el detalle</strong><span>${escapeHTML(error.message)}</span></div>`;
    }
  }
}

function renderStatistics() {
  const metrics = dashboardMetrics();
  const available = Boolean(state.data.metrics);
  $("#statistics-metrics").innerHTML = [
    renderMetricCard({ label: "Total de emergencias", value: available ? String(metrics.total) : "—", note: available ? "Registros persistidos" : "No disponible" }),
    renderMetricCard({ label: "Respuesta promedio", value: formatDuration(metrics.response_average_ms), note: available ? `${metrics.response_count} registros con medición` : "No disponible" }),
    renderMetricCard({ label: "Respuesta mínima", value: formatDuration(metrics.response_min_ms), note: "Según métricas de FastAPI" }),
    renderMetricCard({ label: "Respuesta máxima", value: formatDuration(metrics.response_max_ms), note: "Según métricas de FastAPI" }),
    renderMetricCard({ label: "Duración promedio", value: formatDuration(metrics.duration_average_ms), note: "Incidentes con finalización disponible" }),
  ].join("");
  renderDailyChart(metrics.incidents_by_day);
  renderStatusDistribution(metrics.status_counts, metrics.total);
}

function renderDailyChart(byDay) {
  const today = new Date();
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    const key = day.toISOString().slice(0, 10);
    days.push({ key, count: byDay[key] || 0, label: dateFormat.format(day) });
  }
  const maximum = Math.max(1, ...days.map((day) => day.count));
  const width = 560;
  const chartHeight = 170;
  const bottom = 136;
  const barWidth = 34;
  const gap = 42;
  const start = 25;
  const bars = days.map((day, index) => {
    const height = day.count ? Math.max(4, (day.count / maximum) * 102) : 0;
    const x = start + index * (barWidth + gap);
    const y = bottom - height;
    return `<g><title>${escapeHTML(day.label)}: ${day.count} ${day.count === 1 ? "incidente" : "incidentes"}</title><rect class="chart-bar ${day.count ? "chart-bar--active" : ""}" x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="3"></rect>${day.count ? `<text class="chart-value" x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle">${day.count}</text>` : ""}<text class="chart-label" x="${x + barWidth / 2}" y="158" text-anchor="middle">${escapeHTML(day.label)}</text></g>`;
  }).join("");
  $("#daily-chart").innerHTML = `<svg viewBox="0 0 ${width} ${chartHeight}" role="img" aria-label="Incidentes por día durante los últimos siete días">
    <line class="chart-axis" x1="14" y1="${bottom}" x2="${width - 10}" y2="${bottom}"></line>${bars}
  </svg>`;
}

function renderStatusDistribution(counts, total) {
  const statuses = ["RECUPERADA", "FINALIZADA", "PRIORIDAD_ACTIVADA", "DETECTADA", "INCOMPLETO"];
  const rows = statuses.filter((status) => counts[status]).map((status) => {
    const count = counts[status];
    const percentage = total ? Math.round((count / total) * 100) : 0;
    return `<div class="distribution-row">
      <div class="distribution-label"><span><span class="status-dot status-dot--${statusTone(status)}" aria-hidden="true"></span>${escapeHTML(statusLabel(status))}</span><strong>${count}<small>${percentage}%</small></strong></div>
      <div class="distribution-track"><span class="distribution-fill distribution-fill--${statusTone(status)}" style="width:${percentage}%"></span></div>
    </div>`;
  }).join("");
  $("#status-chart").innerHTML = rows || `<div class="empty-state empty-state--compact"><strong>${state.data.apiAvailable ? "Sin incidentes registrados" : "Métricas no disponibles"}</strong><span>${state.data.apiAvailable ? "La distribución aparecerá con los primeros incidentes." : "Se mostrarán al restablecer la conexión con FastAPI."}</span></div>`;
}

function renderAll() {
  renderSummary();
  renderMonitor();
  renderIncidents();
  renderStatistics();
}

function updateConnectionIndicator() {
  const label = $("#connection-label");
  const dot = $(".connection-pill .status-dot");
  const data = state.data;
  let text;
  let tone;
  if (!data.apiAvailable) {
    text = data.websocketConnected ? "API REST no disponible" : "Backend no disponible";
    tone = data.websocketConnected ? "amber" : "red";
  } else if (!data.state.serial_connected) {
    text = "Arduino desconectado";
    tone = "red";
  } else if (data.state.state_stale || !data.state.controller_observed) {
    text = "Telemetría desactualizada";
    tone = "amber";
  } else {
    text = "Controlador observado";
    tone = "green";
  }
  label.textContent = text;
  dot.className = `status-dot status-dot--${tone}`;

  const banner = $("#backend-status-banner");
  banner.classList.toggle("backend-status-banner--error", !data.apiAvailable);
  banner.classList.toggle("backend-status-banner--warning", data.apiAvailable && tone !== "green");
  const heading = $("#backend-status-title");
  const description = $("#backend-status-description");
  if (!data.apiAvailable) {
    heading.textContent = data.websocketConnected ? "API REST NO DISPONIBLE" : "BACKEND NO DISPONIBLE";
    description.textContent = data.websocketConnected
      ? "El WebSocket está conectado, pero no se pueden consultar el historial ni las métricas REST."
      : "No se pudieron consultar FastAPI ni los datos persistidos.";
  } else if (!data.state.serial_connected) {
    heading.textContent = "SIN CONEXIÓN SERIAL";
    description.textContent = "FastAPI responde; no hay conexión informada con el controlador.";
  } else if (data.state.state_stale || !data.state.controller_observed) {
    heading.textContent = "TELEMETRÍA DESACTUALIZADA";
    description.textContent = "El backend está disponible, pero no observa señales recientes del controlador.";
  } else {
    heading.textContent = "MONITOREO EN VIVO";
    description.textContent = "Estado y métricas obtenidos del backend; sin controles remotos.";
  }
}

function updateIncidentAlert(event) {
  const alert = $("#incident-alert");
  $("#incident-alert-title").textContent = eventLabel(event.event || event.type);
  $("#incident-alert-description").textContent = event.incident_id
    ? `Incidente #${event.incident_id} · ${eventDescription(event.event || event.type)}`
    : eventDescription(event.event || event.type);
  alert.hidden = false;
  window.clearTimeout(state.alertTimer);
  state.alertTimer = window.setTimeout(() => { alert.hidden = true; }, 8000);
}

function showBackendError(error) {
  const firstFailure = state.data.apiAvailable || state.backendError !== error.message;
  if (firstFailure) console.error("No se pudo completar la consulta a FastAPI:", error);
  state.backendError = error.message;
  state.data.apiAvailable = false;
  state.data.state = {
    ...state.data.state,
    controller_observed: false,
    state_stale: true,
    restante_ms: null,
  };
  updateConnectionIndicator();
  renderAll();
}

function mapIncidentEvent(event, incidentId) {
  const type = event.type;
  return {
    type,
    status: eventStatus(type),
    received_at: event.received_at,
    arduino_uptime_ms: event.arduino_uptime_ms,
    incident_id: incidentId,
    description: eventDescription(type),
    sequence: event.sequence,
  };
}

function mergeEvents(events) {
  const keys = new Set(state.data.events.map((event) => `${event.session_id || ""}:${event.sequence ?? ""}:${event.type}:${event.incident_id || ""}`));
  for (const event of events) {
    const key = `${event.session_id || ""}:${event.sequence ?? ""}:${event.type}:${event.incident_id || ""}`;
    if (!keys.has(key)) {
      state.data.events.push(event);
      keys.add(key);
    }
  }
  state.data.events.sort((a, b) => new Date(b.received_at || 0) - new Date(a.received_at || 0));
  state.data.events = state.data.events.slice(0, 40);
}

function acceptSnapshot(snapshot) {
  state.data.state = { ...UNKNOWN_STATE, ...snapshot };
}

function acceptWebSocketMessage(message) {
  if (!message || typeof message.type !== "string" || !message.data) return;
  const data = message.data;
  if (message.type === "snapshot") {
    acceptSnapshot(data);
    updateConnectionIndicator();
    renderAll();
    refreshFromApi({ includeIncidents: !state.data.apiAvailable });
    return;
  }
  if (message.type === "state" || message.type === "heartbeat") {
    const isHeartbeat = message.type === "heartbeat";
    const isBoot = data.state_stale === true;
    state.data.state = {
      ...state.data.state,
      semaforo_a: data.semaforo_a ?? null,
      semaforo_b: data.semaforo_b ?? null,
      fase: data.fase ?? null,
      modo: data.modo ?? null,
      restante_ms: data.restante_ms ?? null,
      state_received_at: data.received_at || null,
      last_message_received_at: data.received_at || state.data.state.last_message_received_at,
      last_heartbeat_received_at: isHeartbeat
        ? data.received_at
        : state.data.state.last_heartbeat_received_at,
      active_session_id: data.session_id || state.data.state.active_session_id,
      serial_connected: true,
      controller_observed: isHeartbeat ? true : state.data.state.controller_observed,
      state_stale: isHeartbeat ? false : isBoot || state.data.state.state_stale,
    };
    if (message.type === "state") {
      mergeEvents([{
        ...data,
        type: "STATE",
        status: "OK",
        description: eventDescription("STATE"),
      }]);
    }
  } else if (message.type === "connection") {
    state.data.state = { ...state.data.state, ...data };
  } else if (message.type === "incident") {
    const event = {
      ...data,
      type: data.event,
      status: eventStatus(data.event),
      description: eventDescription(data.event),
    };
    mergeEvents([event]);
    updateIncidentAlert(event);
    refreshIncidentsAndMetrics();
  } else {
    return;
  }
  updateConnectionIndicator();
  renderAll();
}

async function loadRecentEvents(incidents) {
  const latest = incidents.slice(0, 5);
  const details = await Promise.allSettled(latest.map((incident) => getIncident(incident.id)));
  const events = details.flatMap((result, index) => {
    if (result.status !== "fulfilled") return [];
    const incident = latest[index];
    return (result.value.events || []).map((event) => ({
      ...mapIncidentEvent(event, incident.incident_id),
      session_id: incident.session_id,
    }));
  });
  mergeEvents(events);
}

async function refreshFromApi({ includeIncidents = false, includeRecentEvents = false } = {}) {
  try {
    const [health, currentState, metrics] = await Promise.all([
      getHealth(),
      getState(),
      getMetrics(),
    ]);
    const incidents = includeIncidents || !state.data.apiAvailable
      ? await getAllIncidents()
      : { items: state.data.incidents };
    state.backendError = null;
    state.data = {
      ...state.data,
      state: { ...UNKNOWN_STATE, ...currentState },
      incidents: incidents.items,
      metrics,
      health,
      apiAvailable: true,
    };
    if (includeRecentEvents) await loadRecentEvents(incidents.items);
    updateConnectionIndicator();
    renderAll();
  } catch (error) {
    showBackendError(error);
  }
}

async function refreshIncidentsAndMetrics() {
  try {
    const [health, metrics, currentState, incidentsResponse] = await Promise.all([
      getHealth(),
      getMetrics(),
      getState(),
      getAllIncidents(),
    ]);
    state.backendError = null;
    state.data = {
      ...state.data,
      health,
      metrics,
      state: { ...UNKNOWN_STATE, ...currentState },
      incidents: incidentsResponse.items,
      apiAvailable: true,
    };
    updateConnectionIndicator();
    renderAll();
  } catch (error) {
    showBackendError(error);
  }
}

function switchView(view) {
  if (!["resumen", "monitoreo", "emergencias", "estadisticas"].includes(view)) return;
  state.activeView = view;
  $$("[data-panel]").forEach((panel) => {
    const active = panel.dataset.panel === view;
    panel.hidden = !active;
    panel.classList.toggle("is-visible", active);
  });
  $$(".nav-link").forEach((link) => {
    const active = link.dataset.view === view;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  window.history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0, behavior: "instant" });
}

function updateClock() {
  const clock = $("#local-clock");
  const now = new Date();
  clock.dateTime = now.toISOString();
  clock.textContent = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);
}

document.addEventListener("click", (event) => {
  const viewTarget = event.target.closest("[data-view]");
  if (viewTarget) {
    event.preventDefault();
    switchView(viewTarget.dataset.view);
  }
  const incidentTarget = event.target.closest("[data-incident-id]");
  if (incidentTarget) renderIncidentDetail(incidentTarget.dataset.incidentId);
});

$("#incident-search").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderIncidents();
});
$("#incident-status").addEventListener("change", (event) => {
  state.statusFilter = event.target.value;
  renderIncidents();
});
$("#incident-order").addEventListener("change", (event) => {
  state.dateOrder = event.target.value;
  renderIncidents();
});
$("#dialog-close").addEventListener("click", () => $("#incident-dialog").close());
$("#incident-dialog").addEventListener("click", (event) => {
  if (event.target === $("#incident-dialog")) $("#incident-dialog").close();
});
$("#incident-alert-close").addEventListener("click", () => {
  $("#incident-alert").hidden = true;
  window.clearTimeout(state.alertTimer);
});
window.addEventListener("hashchange", () => switchView(window.location.hash.slice(1) || "resumen"));

updateClock();
updateConnectionIndicator();
renderAll();
switchView(window.location.hash.slice(1) || "resumen");
refreshFromApi({ includeIncidents: true, includeRecentEvents: true });
state.disconnectSocket = connectMonitor({
  onMessage: acceptWebSocketMessage,
  onStatus(status) {
    if (status === "connected") {
      state.data.websocketConnected = true;
    } else if (status === "disconnected") {
      state.data.websocketConnected = false;
    } else if (status === "invalid-message") {
      console.error("Se recibió un mensaje WebSocket inválido.");
    }
    updateConnectionIndicator();
    renderSummary();
    renderMonitor();
  },
});
state.refreshTimer = window.setInterval(() => refreshFromApi(), 5000);
state.staleTimer = window.setInterval(() => {
  const stale = stateMeasurementStale(state.data.state);
  if (stale !== state.previousStale) {
    state.previousStale = stale;
    updateConnectionIndicator();
    renderSummary();
    renderMonitor();
  }
}, 1000);
state.clockTimer = window.setInterval(updateClock, 1000);
window.addEventListener("beforeunload", () => {
  state.disconnectSocket?.();
  window.clearInterval(state.refreshTimer);
  window.clearInterval(state.staleTimer);
  window.clearInterval(state.clockTimer);
  window.clearTimeout(state.alertTimer);
});
