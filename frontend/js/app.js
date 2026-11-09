import {
  getAnalytics,
  getIncidentsCsvUrl,
  getIncidentsPage,
  getHealth,
  getIncident,
  getMetrics,
  getState,
} from "./api.js";
import { classifyBackendStatus } from "./backend-status.js";
import { calculateMetrics, getPeriodRange } from "./metrics.js";
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
    incidentTotal: 0,
    latestIncident: null,
    latestIncidentLoaded: false,
    events: [],
    metrics: null,
    analytics: null,
    health: null,
    apiAvailable: false,
    websocketConnected: false,
    backendStatus: "checking",
    resourceErrors: {},
    incidentsLoaded: false,
  },
  activeView: "resumen",
  search: "",
  statusFilter: "todos",
  dateOrder: "desc",
  historyPage: 0,
  pageSize: 25,
  historyRequestId: 0,
  analyticsRequestId: 0,
  historyLoading: false,
  analyticsLoading: false,
  period: { value: "7d", from: "", to: "" },
  periodRange: null,
  previousStale: true,
  disconnectSocket: null,
  refreshTimer: null,
  staleTimer: null,
  alertTimer: null,
  searchTimer: null,
  clockTimer: null,
  healthTimer: null,
  incidentRefreshTimer: null,
  refreshPromise: null,
  healthFailures: 0,
  lastApiSuccessAt: null,
  websocketHasConnected: false,
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
  const latest = data.latestIncident;
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

function selectedPeriod() {
  if (!state.periodRange) {
    state.periodRange = getPeriodRange(state.period.value, state.period.from, state.period.to);
  }
  return state.periodRange;
}

function renewPeriodRange() {
  state.periodRange = getPeriodRange(
    state.period.value,
    state.period.from,
    state.period.to,
  );
}

function historyFilters() {
  const period = selectedPeriod();
  return {
    ...(period.error ? {} : { start: period.start, end: period.end }),
    status: state.statusFilter,
    search: state.search,
    order: state.dateOrder,
  };
}

function statisticsFilters() {
  const period = selectedPeriod();
  return period.error ? null : { start: period.start, end: period.end };
}

function renderIncidents() {
  const incidents = state.data.incidents;
  const total = state.data.incidentTotal;
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
  $("#incident-count").textContent = `${total} ${total === 1 ? "incidente" : "incidentes"}`;
  $("#incident-empty").hidden = incidents.length > 0;
  $(".table-scroll").hidden = incidents.length === 0;
  $("#incident-results").textContent = state.historyLoading
    ? "Consultando historial…"
    : state.data.apiAvailable
    ? `Mostrando ${incidents.length ? state.historyPage * state.pageSize + 1 : 0}–${state.historyPage * state.pageSize + incidents.length} de ${total}`
    : "Historial no disponible: backend desconectado";
  if (!incidents.length) {
    $("#incident-empty").querySelector("strong").textContent = state.data.apiAvailable
      ? state.historyLoading ? "Cargando historial" : "No hay incidentes para mostrar"
      : "Historial no disponible";
    $("#incident-empty").querySelector("span").textContent = state.data.apiAvailable
      ? state.historyLoading
        ? "Se están consultando los registros persistidos."
        : "No hay registros o ningún incidente coincide con la búsqueda y los filtros."
      : "El historial persistido se mostrará al restablecer FastAPI.";
  }
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
  $("#incident-page").textContent = `Página ${Math.min(state.historyPage + 1, pageCount)} de ${pageCount}`;
  $("#incident-previous").disabled = state.historyLoading || state.historyPage === 0;
  $("#incident-next").disabled = state.historyLoading || state.historyPage + 1 >= pageCount;
  $("#incident-export").disabled = state.historyLoading
    || !state.data.apiAvailable
    || Boolean(selectedPeriod().error);
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
    reportApiFailure("detalle", error);
    if ($("#incident-dialog").open) {
      $("#dialog-title").textContent = `Incidente #${escapeHTML(rowId)}`;
      $("#dialog-content").innerHTML = `<div class="empty-state empty-state--compact"><strong>No se pudo cargar el detalle</strong><span>${escapeHTML(error.message)}</span></div>`;
    }
  }
}

function renderStatistics() {
  const metrics = state.data.analytics;
  const available = Boolean(metrics);
  const statisticsError = Boolean(state.data.resourceErrors["estadísticas"]);
  $("#statistics-metrics").innerHTML = [
    renderMetricCard({ label: "Total de emergencias", value: available ? String(metrics.total) : "—", note: "En el período seleccionado" }),
    renderMetricCard({ label: "Completadas", value: available ? String(metrics.completed) : "—", note: "Finalizadas o recuperadas" }),
    renderMetricCard({ label: "Pendientes / incompletas", value: available ? String(metrics.pending) : "—", note: "Estado actual no completado" }),
    renderMetricCard({ label: "Respuesta promedio", value: formatDuration(metrics?.response_average_ms), note: available ? `${metrics.response_count} con medición` : "No disponible" }),
    renderMetricCard({ label: "Respuesta mínima", value: formatDuration(metrics?.response_min_ms), note: "Milisegundos persistidos" }),
    renderMetricCard({ label: "Respuesta máxima", value: formatDuration(metrics?.response_max_ms), note: "Milisegundos persistidos" }),
    renderMetricCard({ label: "Duración promedio", value: formatDuration(metrics?.duration_average_ms), note: "Solo emergencias con dato" }),
    renderMetricCard({ label: "Recuperación promedio", value: formatDuration(metrics?.recovery_average_ms), note: "Solo emergencias con dato" }),
  ].join("");
  renderDailyChart(metrics?.incidents_by_day || {});
  renderStatusDistribution(metrics?.status_counts || {}, metrics?.total || 0);
  renderResponseChart(metrics?.response_series || []);
  $("#statistics-period-note").textContent = metrics
    ? `Agregados completos del período · agrupación diaria en UTC · ${metrics.response_count} tiempos de respuesta disponibles`
    : state.analyticsLoading
      ? "Consultando estadísticas reales en FastAPI…"
      : statisticsError
        ? `Error al consultar estadísticas: ${state.data.resourceErrors["estadísticas"]}`
        : "Estadísticas no disponibles; se reintentarán sin sustituirlas por datos ficticios.";
}

function renderDailyChart(byDay) {
  const days = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
  if (!days.length) {
    $("#daily-chart").innerHTML = emptyStatisticsChart(
      state.data.analytics?.total > 0
        ? "No se recibieron datos diarios para incidentes existentes."
        : "Sin emergencias en este período",
    );
    return;
  }
  const width = 760;
  const bottom = 150;
  const top = 14;
  const slot = width / days.length;
  const barWidth = Math.max(1, Math.min(20, slot * 0.62));
  const maximum = Math.max(1, ...days.map(([, count]) => count));
  const labelStep = Math.max(1, Math.ceil(days.length / 8));
  const bars = days.map(([key, count], index) => {
    const height = count ? Math.max(2, (count / maximum) * (bottom - top)) : 0;
    const x = index * slot + (slot - barWidth) / 2;
    const y = bottom - height;
    const label = dateFormat.format(new Date(`${key}T00:00:00Z`));
    const showLabel = index % labelStep === 0 || index === days.length - 1;
    return `<g><title>${escapeHTML(key)} UTC: ${count} ${count === 1 ? "emergencia" : "emergencias"}</title><rect class="chart-bar ${count ? "chart-bar--active" : ""}" x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="2"></rect>${showLabel ? `<text class="chart-label" x="${x + barWidth / 2}" y="174" text-anchor="middle">${escapeHTML(label)}</text>` : ""}</g>`;
  }).join("");
  $("#daily-chart").innerHTML = `<svg viewBox="0 0 ${width} 184" role="img" aria-label="Emergencias por día, fechas agrupadas en UTC">
    <line class="chart-axis" x1="0" y1="${bottom}" x2="${width}" y2="${bottom}"></line>${bars}
  </svg>`;
}

function renderStatusDistribution(counts, total) {
  const rows = Object.entries(counts).filter(([, count]) => count > 0).map(([status, count]) => {
    const percentage = total ? Math.round((count / total) * 100) : 0;
    return `<div class="distribution-row">
      <div class="distribution-label"><span><span class="status-dot status-dot--${statusTone(status)}" aria-hidden="true"></span>${escapeHTML(statusLabel(status))}</span><strong>${count}<small>${percentage}%</small></strong></div>
      <div class="distribution-track"><span class="distribution-fill distribution-fill--${statusTone(status)}" style="width:${percentage}%"></span></div>
    </div>`;
  }).join("");
  $("#status-chart").innerHTML = rows || emptyStatisticsChart(
    total > 0 ? "No se recibió una distribución de estados válida." : "Sin incidentes registrados",
  );
}

function renderResponseChart(series) {
  const measurements = series.filter((item) => Number.isFinite(item.response_ms));
  if (!measurements.length) {
    const responseCount = state.data.analytics?.response_count || 0;
    $("#response-chart").innerHTML = emptyStatisticsChart(
      responseCount > 0
        ? `El backend informa ${responseCount} mediciones, pero no envió puntos para el gráfico.`
        : "Sin tiempos de respuesta disponibles; se excluyen mediciones nulas.",
    );
    return;
  }
  const width = 760;
  const height = 190;
  const left = 38;
  const right = 12;
  const top = 14;
  const bottom = 154;
  const values = measurements.map((item) => item.response_ms);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = measurements.map((item, index) => {
    const x = measurements.length === 1
      ? (left + width - right) / 2
      : left + index * (width - left - right) / (measurements.length - 1);
    const y = bottom - ((item.response_ms - min) / range) * (bottom - top);
    return { x, y, item };
  });
  const line = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const dots = points.map(({ x, y, item }) => `<circle class="response-point" cx="${x}" cy="${y}" r="3"><title>Incidente #${escapeHTML(item.incident_id)} · ${escapeHTML(formatDate(item.first_received_at))} · ${item.response_ms} ms</title></circle>`).join("");
  $("#response-chart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Tiempo de respuesta en milisegundos por incidente real; ${measurements.length} puntos mostrados">
    <line class="chart-axis" x1="${left}" y1="${bottom}" x2="${width - right}" y2="${bottom}"></line>
    <text class="chart-label" x="0" y="${top + 3}">${escapeHTML(max.toLocaleString(locale))} ms</text>
    <text class="chart-label" x="0" y="${bottom}">${escapeHTML(min.toLocaleString(locale))} ms</text>
    ${measurements.length > 1 ? `<polyline class="response-line" points="${line}"></polyline>` : ""}${dots}
  </svg>`;
}

function emptyStatisticsChart(emptyMessage) {
  const hasError = Boolean(state.data.resourceErrors["estadísticas"]);
  const title = state.analyticsLoading
    ? "Consultando estadísticas"
    : hasError
      ? "Error de consulta de estadísticas"
      : state.data.analytics
        ? emptyMessage
        : "Estadísticas no disponibles";
  const description = hasError
    ? state.data.resourceErrors["estadísticas"]
    : state.analyticsLoading
      ? "Esperando la respuesta de FastAPI."
      : "Se mostrarán datos al recibir estadísticas válidas del período.";
  return `<div class="empty-state empty-state--compact"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(description)}</span></div>`;
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
  if (data.backendStatus === "unavailable") {
    text = "Backend no disponible";
    tone = "red";
  } else if (data.backendStatus === "temporary") {
    text = "Backend con fallos temporales";
    tone = "amber";
  } else if (!data.apiAvailable) {
    text = "Conectando con backend";
    tone = "amber";
  } else if (!data.state.serial_connected) {
    text = "Arduino desconectado";
    tone = "red";
  } else if (data.state.state_stale || !data.state.controller_observed) {
    text = "Telemetría desactualizada";
    tone = "amber";
  } else if (!data.websocketConnected) {
    text = "WebSocket desconectado";
    tone = "amber";
  } else {
    text = "Controlador observado";
    tone = "green";
  }
  label.textContent = text;
  dot.className = `status-dot status-dot--${tone}`;

  const banner = $("#backend-status-banner");
  banner.classList.toggle("backend-status-banner--error", data.backendStatus === "unavailable");
  banner.classList.toggle(
    "backend-status-banner--warning",
    data.backendStatus === "temporary"
      || (data.backendStatus !== "unavailable" && tone !== "green"),
  );
  const heading = $("#backend-status-title");
  const description = $("#backend-status-description");
  if (data.backendStatus === "unavailable") {
    heading.textContent = "BACKEND NO DISPONIBLE";
    description.textContent = "Fallaron varias verificaciones consecutivas de FastAPI.";
  } else if (data.backendStatus === "temporary") {
    heading.textContent = "FALLO TEMPORAL DE COMUNICACIÓN";
    const failedResources = Object.keys(data.resourceErrors).join(", ");
    description.textContent = failedResources
      ? `Reintento automático; fallo puntual en: ${failedResources}.`
      : "Una consulta falló; FastAPI respondió recientemente y se reintentará.";
  } else if (!data.apiAvailable) {
    heading.textContent = "CONECTANDO CON FASTAPI";
    description.textContent = "Consultando estado e historial persistido…";
  } else if (!data.state.serial_connected) {
    heading.textContent = "SIN CONEXIÓN SERIAL";
    description.textContent = "FastAPI responde; no hay conexión informada con el controlador.";
  } else if (data.state.state_stale || !data.state.controller_observed) {
    heading.textContent = "TELEMETRÍA DESACTUALIZADA";
    description.textContent = "El backend está disponible, pero no observa señales recientes del controlador.";
  } else if (!data.websocketConnected) {
    heading.textContent = "WEBSOCKET DESCONECTADO";
    description.textContent = "REST está disponible; intentando restablecer las actualizaciones en vivo.";
  } else {
    heading.textContent = "MONITOREO EN VIVO";
    description.textContent = "Estado actualizado por WebSocket; historial y métricas consultados por REST.";
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

function reportApiFailure(resource, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (state.data.resourceErrors[resource] !== message) {
    console.error(`Falló la consulta REST de ${resource}:`, error);
  }
  state.data.resourceErrors[resource] = message;
  if (resource === "health") {
    state.healthFailures += 1;
  }
  state.data.backendStatus = classifyBackendStatus({
    healthFailures: state.healthFailures,
    lastApiSuccessAt: state.lastApiSuccessAt,
    resourceErrors: state.data.resourceErrors,
  });
  if (state.data.backendStatus === "unavailable") {
    state.data.apiAvailable = false;
    state.data.state = {
      ...state.data.state,
      controller_observed: false,
      state_stale: true,
      restante_ms: null,
    };
  }
  updateConnectionIndicator();
  renderAll();
}

function reportApiSuccess(resource) {
  delete state.data.resourceErrors[resource];
  state.lastApiSuccessAt = Date.now();
  state.data.apiAvailable = true;
  if (resource === "health") state.healthFailures = 0;
  state.data.backendStatus = classifyBackendStatus({
    healthFailures: state.healthFailures,
    lastApiSuccessAt: state.lastApiSuccessAt,
    resourceErrors: state.data.resourceErrors,
  });
  state.backendError = null;
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
      state_stale: isHeartbeat ? false : isBoot,
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
  const failed = details.some((result) => result.status !== "fulfilled");
  if (failed) {
    const failure = details.find((result) => result.status === "rejected");
    reportApiFailure("detalles", failure.reason);
  } else {
    reportApiSuccess("detalles");
  }
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

async function loadResource(resource, request, apply, isCurrent = () => true) {
  try {
    const value = await request();
    if (!isCurrent()) return true;
    reportApiSuccess(resource);
    apply(value);
    return true;
  } catch (error) {
    if (isCurrent()) reportApiFailure(resource, error);
    return false;
  }
}

async function loadHistoryPage({ includeRecentEvents = false } = {}) {
  const filters = historyFilters();
  const period = selectedPeriod();
  if (period.error) return false;
  const requestId = ++state.historyRequestId;
  state.historyLoading = true;
  renderIncidents();
  let loaded = false;
  try {
    loaded = await loadResource(
      "historial",
      () => getIncidentsPage(state.pageSize, state.historyPage * state.pageSize, filters),
      (result) => {
        state.data.incidents = result.items;
        state.data.incidentTotal = result.total;
        state.data.incidentsLoaded = true;
        const lastPage = Math.max(0, Math.ceil(result.total / state.pageSize) - 1);
        if (state.historyPage > lastPage) state.historyPage = lastPage;
      },
      () => requestId === state.historyRequestId,
    );
    if (loaded && includeRecentEvents && requestId === state.historyRequestId) {
      await loadRecentEvents(state.data.incidents);
    }
  } finally {
    if (requestId === state.historyRequestId) state.historyLoading = false;
    renderIncidents();
  }
  return loaded;
}

async function loadAnalytics() {
  const filters = statisticsFilters();
  if (!filters) return false;
  const requestId = ++state.analyticsRequestId;
  state.analyticsLoading = true;
  try {
    return await loadResource(
      "estadísticas",
      () => getAnalytics(filters),
      (analytics) => { state.data.analytics = analytics; },
      () => requestId === state.analyticsRequestId,
    );
  } finally {
    if (requestId === state.analyticsRequestId) state.analyticsLoading = false;
  }
}

async function loadLatestIncident() {
  return loadResource("última-emergencia", () => getIncidentsPage(1, 0), (result) => {
    state.data.latestIncident = result.items[0] || null;
    state.data.latestIncidentLoaded = true;
  });
}

async function refreshFromApi({ includeIncidents = false, includeRecentEvents = false } = {}) {
  if (state.refreshPromise) return state.refreshPromise;
  renewPeriodRange();
  state.refreshPromise = (async () => {
    const healthRequest = loadResource("health", getHealth, (health) => {
      state.data.health = health;
    });
    const stateRequest = !state.data.websocketConnected
      ? loadResource("estado", getState, (currentState) => {
        state.data.state = { ...UNKNOWN_STATE, ...currentState };
      })
      : Promise.resolve(true);
    const metricsRequest = loadResource("métricas", getMetrics, (metrics) => {
      state.data.metrics = metrics;
    });
    const incidentsRequest = includeIncidents || !state.data.incidentsLoaded
      ? loadHistoryPage({ includeRecentEvents })
      : Promise.resolve(true);
    const analyticsRequest = loadAnalytics();
    const latestRequest = loadLatestIncident();

    await Promise.all([
      healthRequest,
      stateRequest,
      metricsRequest,
      incidentsRequest,
      analyticsRequest,
      latestRequest,
    ]);
    updateConnectionIndicator();
    renderAll();
  })();
  try {
    await state.refreshPromise;
  } finally {
    state.refreshPromise = null;
  }
}

async function refreshHealth() {
  const healthy = await loadResource("health", getHealth, (health) => {
    state.data.health = health;
  });
  if (!healthy) return;
  if (state.data.resourceErrors["estado"] && !state.data.websocketConnected) {
    await loadResource("estado", getState, (currentState) => {
      state.data.state = { ...UNKNOWN_STATE, ...currentState };
    });
  }
  if (state.data.resourceErrors["métricas"] || !state.data.metrics) {
    await loadResource("métricas", getMetrics, (metrics) => {
      state.data.metrics = metrics;
    });
  }
  if (state.data.resourceErrors["historial"] || !state.data.incidentsLoaded) {
    await loadHistoryPage();
  }
  if (state.data.resourceErrors["detalles"] && state.data.incidentsLoaded) {
    await loadRecentEvents(state.data.incidents);
  }
  if (state.data.resourceErrors["estadísticas"] || !state.data.analytics) {
    await loadAnalytics();
  }
  if (state.data.resourceErrors["última-emergencia"] || !state.data.latestIncidentLoaded) {
    await loadLatestIncident();
  }
  updateConnectionIndicator();
  renderAll();
}

function refreshIncidentsAndMetrics() {
  if (state.incidentRefreshTimer !== null) {
    window.clearTimeout(state.incidentRefreshTimer);
  }
  state.incidentRefreshTimer = window.setTimeout(async () => {
    state.incidentRefreshTimer = null;
    renewPeriodRange();
    await Promise.all([
      loadHistoryPage(),
      loadResource("métricas", getMetrics, (metrics) => {
        state.data.metrics = metrics;
      }),
      loadAnalytics(),
      loadLatestIncident(),
    ]);
    updateConnectionIndicator();
    renderAll();
  }, 200);
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

function syncPeriodControls() {
  $$("[data-period-select]").forEach((select) => { select.value = state.period.value; });
  $("#incident-from").value = state.period.from;
  $("#statistics-from").value = state.period.from;
  $("#incident-to").value = state.period.to;
  $("#statistics-to").value = state.period.to;
  const custom = state.period.value === "custom";
  $("#incident-date-range").hidden = !custom;
  $("#statistics-date-range").hidden = !custom;
  const error = selectedPeriod().error || "";
  $("#incident-period-error").textContent = error;
  $("#statistics-period-error").textContent = error;
}

async function refreshPeriodData() {
  renewPeriodRange();
  syncPeriodControls();
  const period = selectedPeriod();
  if (period.error) {
    state.historyLoading = false;
    state.analyticsLoading = false;
    state.data.analytics = null;
    state.data.incidents = [];
    state.data.incidentTotal = 0;
    renderAll();
    return;
  }
  state.historyPage = 0;
  state.data.analytics = null;
  state.historyLoading = true;
  state.analyticsLoading = true;
  renderStatistics();
  await Promise.all([loadAnalytics(), loadHistoryPage()]);
  renderAll();
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
  state.historyPage = 0;
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(loadHistoryPage, 250);
});
$("#incident-status").addEventListener("change", (event) => {
  state.statusFilter = event.target.value;
  state.historyPage = 0;
  loadHistoryPage();
});
$("#incident-order").addEventListener("change", (event) => {
  state.dateOrder = event.target.value;
  state.historyPage = 0;
  loadHistoryPage();
});
$$("[data-period-select]").forEach((select) => {
  select.addEventListener("change", () => {
    state.period.value = select.value;
    void refreshPeriodData();
  });
});
["incident", "statistics"].forEach((prefix) => {
  for (const suffix of ["from", "to"]) {
    $(`#${prefix}-${suffix}`).addEventListener("change", (event) => {
      state.period[suffix] = event.target.value;
      if (state.period.value === "custom") void refreshPeriodData();
    });
  }
});
$("#incident-previous").addEventListener("click", () => {
  if (state.historyPage === 0) return;
  state.historyPage -= 1;
  void loadHistoryPage();
});
$("#incident-next").addEventListener("click", () => {
  if ((state.historyPage + 1) * state.pageSize >= state.data.incidentTotal) return;
  state.historyPage += 1;
  void loadHistoryPage();
});
$("#incident-export").addEventListener("click", () => {
  const period = selectedPeriod();
  if (period.error || !state.data.apiAvailable) return;
  const anchor = document.createElement("a");
  anchor.href = getIncidentsCsvUrl(historyFilters());
  anchor.download = "emergencias-siv.csv";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
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
syncPeriodControls();
updateConnectionIndicator();
renderAll();
switchView(window.location.hash.slice(1) || "resumen");
refreshFromApi({ includeIncidents: true, includeRecentEvents: true });
state.disconnectSocket = connectMonitor({
  onMessage: acceptWebSocketMessage,
  onStatus(status) {
    if (status === "connected") {
      state.data.websocketConnected = true;
      const reconnect = state.websocketHasConnected;
      state.websocketHasConnected = true;
      if (reconnect) refreshFromApi({ includeIncidents: true });
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
state.healthTimer = window.setInterval(refreshHealth, 15_000);
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
  window.clearInterval(state.healthTimer);
  window.clearInterval(state.staleTimer);
  window.clearInterval(state.clockTimer);
  window.clearTimeout(state.alertTimer);
  window.clearTimeout(state.incidentRefreshTimer);
  window.clearTimeout(state.searchTimer);
});
