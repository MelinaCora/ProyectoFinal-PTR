import { calculateMetrics, demoData } from "./mock-data.js";

const state = {
  data: demoData,
  activeView: "resumen",
  search: "",
  statusFilter: "todos",
  dateOrder: "desc",
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
const dateFormat = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", timeZone: "UTC" });

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
  return value ? options.format(new Date(value)) : "—";
}

function formatDuration(milliseconds, precision = 1) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  if (milliseconds < 1000) return `${milliseconds} ms`;
  const seconds = milliseconds / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(precision)} s`;
}

function formatTimeOfDay(value) {
  return value ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "—";
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
  })[type] || type;
}

function statusTone(status) {
  if (status === "RECUPERADA" || status === "FINALIZADA" || status === "OK" || status === "ATENDIDA") return "green";
  if (status === "PRIORIDAD_ACTIVADA" || status === "DETECTADA") return "amber";
  if (status === "INCOMPLETO" || status === "FALLO") return "red";
  return "neutral";
}

function lightName(color) {
  return ({ R: "Rojo", A: "Amarillo", G: "Verde" })[color] || "Desconocido";
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

function renderSignals() {
  const current = state.data.state;
  return ["a", "b"].map((lane) => {
    const color = current[`semaforo_${lane}`];
    const priority = lane === "a" && current.modo === "EMERGENCIA";
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
            <div><span class="detail-label">${lane === "a" ? "PRIORIDAD" : "OPERACIÓN"}</span><strong class="${priority ? "text-amber" : ""}">${lane === "a" ? (priority ? "Habilitada" : "No solicitada") : escapeHTML(current.modo || "—")}</strong></div>
            <div><span class="detail-label">RESTANTE</span><strong>${current.restante_ms == null ? "—" : escapeHTML(formatDuration(current.restante_ms, 1))}</strong></div>
          </div>
        </div>
      </div>
    </article>`;
  }).join("");
}

function renderActivity(events, limit = events.length) {
  if (!events.length) {
    return `<div class="empty-state empty-state--compact"><strong>Sin actividad registrada</strong><span>Los eventos aparecerán cuando estén disponibles.</span></div>`;
  }
  return events.slice(0, limit).map((event) => {
    const tone = event.type === "FALLO_SEGURO" ? "red" : statusTone(event.status);
    return `<article class="activity-item">
      <span class="activity-marker activity-marker--${tone}" aria-hidden="true"></span>
      <time class="activity-time" datetime="${escapeHTML(event.received_at)}">${escapeHTML(formatDate(event.received_at))}</time>
      <div class="activity-copy"><strong>${escapeHTML(eventLabel(event.type))}${event.incident_id ? ` <span class="inline-id">#${escapeHTML(event.incident_id)}</span>` : ""}</strong><span>${escapeHTML(event.description || "Evento recibido del sistema.")}</span></div>
      <span class="status-badge status-badge--${tone}">${escapeHTML(statusLabel(event.status))}</span>
    </article>`;
  }).join("");
}

function renderSummary() {
  const { data } = state;
  const metrics = calculateMetrics(data.incidents);
  const latest = [...data.incidents].sort((a, b) => new Date(b.first_received_at) - new Date(a.first_received_at))[0];
  const controllerHealthy = data.state.controller_observed && !data.state.state_stale;
  $("#summary-metrics").innerHTML = [
    renderMetricCard({ label: "Controlador", value: controllerHealthy ? "Observado" : "Desactualizado", note: `FSM · ${data.state.fase || "Sin estado"}`, tone: controllerHealthy ? "green" : "amber", marker: controllerHealthy ? "green" : "amber" }),
    renderMetricCard({ label: "Emergencias", value: String(metrics.total), note: "Incidentes en el historial" }),
    renderMetricCard({ label: "Respuesta promedio", value: formatDuration(metrics.response_average_ms), note: `${metrics.response_count} de ${metrics.total} con dato válido` }),
    renderMetricCard({ label: "Última emergencia", value: latest ? formatDate(latest.first_received_at) : "—", note: latest ? `Incidente #${latest.incident_id}` : "Sin registros" }),
    renderMetricCard({ label: "Comunicación", value: data.state.serial_connected ? "Conectada" : "Desconectada", note: `Heartbeat · ${formatTimeOfDay(data.state.last_heartbeat_received_at)}`, tone: data.state.serial_connected ? "green" : "red", marker: data.state.serial_connected ? "green" : "red" }),
  ].join("");
  $("#summary-signals").innerHTML = renderSignals();
  $("#summary-activity").innerHTML = renderActivity(data.events, 5);
  $("#summary-health").innerHTML = `<div class="health-status"><span class="health-indicator ${controllerHealthy ? "health-indicator--green" : "health-indicator--amber"}"></span><div><strong>${controllerHealthy ? "Controlador observado" : "Sin telemetría reciente"}</strong><span>${data.state.serial_connected ? "Puerto serial disponible en los datos de demostración." : "Sin conexión serial informada."}</span></div></div>
    <dl class="detail-list">
      <div><dt>Modo operativo</dt><dd><span class="mode-dot mode-dot--${escapeHTML((data.state.modo || "normal").toLowerCase())}"></span>${escapeHTML(data.state.modo || "Desconocido")}</dd></div>
      <div><dt>Último heartbeat</dt><dd>${escapeHTML(formatDate(data.state.last_heartbeat_received_at))}</dd></div>
      <div><dt>Sesión activa</dt><dd class="mono-value">${escapeHTML(data.state.active_session_id || "—")}</dd></div>
    </dl>`;
}

function renderMonitor() {
  const current = state.data.state;
  const mode = current.modo || "DESCONOCIDO";
  $("#monitor-mode").className = `mode-badge mode-badge--${mode.toLowerCase()}`;
  $("#monitor-mode").innerHTML = `<span class="mode-dot mode-dot--${mode.toLowerCase()}" aria-hidden="true"></span>${escapeHTML(mode)}`;
  $("#monitor-signals").innerHTML = renderSignals();
  $("#monitor-fsm").innerHTML = `<div class="fsm-current"><span class="fsm-label">FASE ACTUAL</span><strong>${escapeHTML(current.fase || "Sin información")}</strong><span class="fsm-mode mode-badge mode-badge--${mode.toLowerCase()}"><span class="mode-dot mode-dot--${mode.toLowerCase()}" aria-hidden="true"></span>${escapeHTML(mode)}</span></div>
    <div class="fsm-progress"><div class="fsm-progress-label"><span>Tiempo restante de fase</span><strong>${current.restante_ms == null ? "—" : escapeHTML(formatDuration(current.restante_ms))}</strong></div><div class="progress-track"><span style="width:${current.restante_ms == null ? 0 : Math.max(4, Math.min(100, (current.restante_ms / 10_000) * 100))}%"></span></div><small>Valor informado por la telemetría de demostración.</small></div>
    <div class="mode-legend">${["NORMAL", "EMERGENCIA", "RECUPERACION", "FALLO"].map((item) => `<span class="${mode === item ? "is-current" : ""}"><span class="mode-dot mode-dot--${item.toLowerCase()}" aria-hidden="true"></span>${item}</span>`).join("")}</div>`;
  $("#monitor-telemetry").innerHTML = `<dl class="detail-list detail-list--telemetry">
      <div><dt>Controlador</dt><dd><span class="status-badge status-badge--${current.controller_observed ? "green" : "amber"}">${current.controller_observed ? "Observado" : "No observado"}</span></dd></div>
      <div><dt>Conexión serial</dt><dd><span class="status-dot status-dot--${current.serial_connected ? "green" : "red"}" aria-hidden="true"></span>${current.serial_connected ? "Conectada" : "Desconectada"}</dd></div>
      <div><dt>Heartbeat recibido</dt><dd>${escapeHTML(formatDate(current.last_heartbeat_received_at))}</dd></div>
      <div><dt>Última señal (hora local)</dt><dd>${escapeHTML(formatTimeOfDay(current.last_heartbeat_received_at))}</dd></div>
      <div><dt>Sesión</dt><dd class="mono-value">${escapeHTML(current.active_session_id || "—")}</dd></div>
      <div><dt>Frescura del estado</dt><dd>${current.state_stale ? "Desactualizado" : "Actual"}</dd></div>
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
    <td><span class="incident-id">#${escapeHTML(incident.incident_id)}</span><span class="cell-subtext">${escapeHTML(incident.session_id.slice(0, 14))}…</span></td>
    <td><span class="date-cell">${escapeHTML(formatDate(incident.first_received_at))}</span></td>
    <td><span class="status-badge status-badge--${statusTone(incident.status)}">${escapeHTML(statusLabel(incident.status))}</span></td>
    <td class="duration-cell">${escapeHTML(formatDuration(incident.response_ms))}</td>
    <td class="duration-cell">${escapeHTML(formatDuration(incident.duration_ms))}</td>
    <td class="duration-cell">${escapeHTML(formatDuration(incident.recovery_ms))}</td>
    <td><button class="row-action" type="button" data-incident-id="${escapeHTML(incident.id)}" aria-label="Ver detalle del incidente ${escapeHTML(incident.incident_id)}">Detalle <span aria-hidden="true">→</span></button></td>
  </tr>`).join("");
  $("#incident-count").textContent = `${state.data.incidents.length} incidentes`;
  $("#incident-empty").hidden = incidents.length > 0;
  $(".table-scroll").hidden = incidents.length === 0;
  $("#incident-results").textContent = `Mostrando ${incidents.length} de ${state.data.incidents.length} incidentes`;
}

function renderIncidentDetail(rowId) {
  const incident = state.data.incidents.find((item) => item.id === Number(rowId));
  if (!incident) return;
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
    <div class="dialog-events"><p class="eyebrow">EVENTOS DEL INCIDENTE</p>${incident.events.length ? incident.events.map((event) => `<div class="dialog-event"><span class="activity-marker activity-marker--${event.type === "EMERGENCIA_DETECTADA" ? "amber" : "green"}" aria-hidden="true"></span><div><strong>${escapeHTML(eventLabel(event.type))}</strong><span>${escapeHTML(formatDate(event.received_at))}<span class="event-separator">·</span>uptime ${escapeHTML(formatDuration(event.arduino_uptime_ms))}</span></div></div>`).join("") : `<div class="empty-state empty-state--compact"><span>Sin eventos disponibles.</span></div>`}</div>`;
  $("#incident-dialog").showModal();
}

function renderStatistics() {
  const records = state.data.incidents;
  const metrics = calculateMetrics(records);
  $("#statistics-metrics").innerHTML = [
    renderMetricCard({ label: "Total de emergencias", value: String(metrics.total), note: "Registros en el conjunto local" }),
    renderMetricCard({ label: "Respuesta promedio", value: formatDuration(metrics.response_average_ms), note: `${metrics.response_count} registros con medición` }),
    renderMetricCard({ label: "Respuesta mínima", value: formatDuration(metrics.response_min_ms), note: "Solo respuestas disponibles" }),
    renderMetricCard({ label: "Respuesta máxima", value: formatDuration(metrics.response_max_ms), note: "Solo respuestas disponibles" }),
    renderMetricCard({ label: "Duración promedio", value: formatDuration(metrics.duration_average_ms), note: "Incidentes con finalización recibida" }),
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
  $("#status-chart").innerHTML = rows || `<div class="empty-state empty-state--compact"><strong>Sin incidentes registrados</strong><span>La distribución aparecerá con los primeros datos.</span></div>`;
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

function renderAll() {
  renderSummary();
  renderMonitor();
  renderIncidents();
  renderStatistics();
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
window.addEventListener("hashchange", () => switchView(window.location.hash.slice(1) || "resumen"));

updateClock();
window.setInterval(updateClock, 1000);
renderAll();
switchView(window.location.hash.slice(1) || "resumen");
