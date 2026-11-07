const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const hoursAgo = (hours) => minutesAgo(hours * 60);

const sessionId = "demo-int001-20261107-a4f2";

const incidents = [
  {
    id: 248,
    session_id: sessionId,
    incident_id: 248,
    first_received_at: minutesAgo(18),
    detected_received_at: minutesAgo(18),
    detected_uptime_ms: 8_420_000,
    priority_uptime_ms: 8_422_100,
    finished_uptime_ms: 8_441_700,
    recovered_uptime_ms: 8_446_200,
    status: "RECUPERADA",
    response_ms: 2100,
    duration_ms: 19_600,
    recovery_ms: 4500,
    events: [
      { type: "EMERGENCIA_DETECTADA", arduino_uptime_ms: 8_420_000, received_at: minutesAgo(18), data: { carril: "A", semaforo_a: "R", semaforo_b: "G" } },
      { type: "PRIORIDAD_ACTIVADA", arduino_uptime_ms: 8_422_100, received_at: minutesAgo(18), data: { respuesta_ms: 2100, semaforo_a: "G", semaforo_b: "R" } },
      { type: "EMERGENCIA_FINALIZADA", arduino_uptime_ms: 8_441_700, received_at: minutesAgo(17), data: { duracion_ms: 19_600 } },
      { type: "CICLO_RECUPERADO", arduino_uptime_ms: 8_446_200, received_at: minutesAgo(17), data: { recuperacion_ms: 4500 } },
    ],
  },
  {
    id: 247,
    session_id: sessionId,
    incident_id: 247,
    first_received_at: hoursAgo(3),
    detected_received_at: hoursAgo(3),
    detected_uptime_ms: 7_102_000,
    priority_uptime_ms: 7_103_400,
    finished_uptime_ms: 7_126_000,
    recovered_uptime_ms: 7_131_800,
    status: "RECUPERADA",
    response_ms: 1400,
    duration_ms: 24_000,
    recovery_ms: 5800,
    events: [
      { type: "EMERGENCIA_DETECTADA", arduino_uptime_ms: 7_102_000, received_at: hoursAgo(3), data: { carril: "A", semaforo_a: "R", semaforo_b: "G" } },
      { type: "PRIORIDAD_ACTIVADA", arduino_uptime_ms: 7_103_400, received_at: hoursAgo(3), data: { respuesta_ms: 1400, semaforo_a: "G", semaforo_b: "R" } },
      { type: "EMERGENCIA_FINALIZADA", arduino_uptime_ms: 7_126_000, received_at: hoursAgo(3), data: { duracion_ms: 24_000 } },
      { type: "CICLO_RECUPERADO", arduino_uptime_ms: 7_131_800, received_at: hoursAgo(3), data: { recuperacion_ms: 5800 } },
    ],
  },
  {
    id: 246,
    session_id: sessionId,
    incident_id: 246,
    first_received_at: hoursAgo(9),
    detected_received_at: hoursAgo(9),
    detected_uptime_ms: 6_014_000,
    priority_uptime_ms: 6_016_800,
    finished_uptime_ms: 6_041_000,
    recovered_uptime_ms: 6_047_600,
    status: "RECUPERADA",
    response_ms: 2800,
    duration_ms: 24_200,
    recovery_ms: 6600,
    events: [
      { type: "EMERGENCIA_DETECTADA", arduino_uptime_ms: 6_014_000, received_at: hoursAgo(9), data: { carril: "A", semaforo_a: "R", semaforo_b: "G" } },
      { type: "PRIORIDAD_ACTIVADA", arduino_uptime_ms: 6_016_800, received_at: hoursAgo(9), data: { respuesta_ms: 2800, semaforo_a: "G", semaforo_b: "R" } },
      { type: "EMERGENCIA_FINALIZADA", arduino_uptime_ms: 6_041_000, received_at: hoursAgo(9), data: { duracion_ms: 24_200 } },
      { type: "CICLO_RECUPERADO", arduino_uptime_ms: 6_047_600, received_at: hoursAgo(9), data: { recuperacion_ms: 6600 } },
    ],
  },
  {
    id: 245,
    session_id: sessionId,
    incident_id: 245,
    first_received_at: hoursAgo(27),
    detected_received_at: hoursAgo(27),
    detected_uptime_ms: 4_911_000,
    priority_uptime_ms: 4_912_600,
    finished_uptime_ms: 4_925_800,
    recovered_uptime_ms: 4_931_100,
    status: "RECUPERADA",
    response_ms: 1600,
    duration_ms: 13_200,
    recovery_ms: 5300,
    events: [
      { type: "EMERGENCIA_DETECTADA", arduino_uptime_ms: 4_911_000, received_at: hoursAgo(27), data: { carril: "A", semaforo_a: "G", semaforo_b: "R" } },
      { type: "PRIORIDAD_ACTIVADA", arduino_uptime_ms: 4_912_600, received_at: hoursAgo(27), data: { respuesta_ms: 1600, semaforo_a: "G", semaforo_b: "R" } },
      { type: "EMERGENCIA_FINALIZADA", arduino_uptime_ms: 4_925_800, received_at: hoursAgo(27), data: { duracion_ms: 13_200 } },
      { type: "CICLO_RECUPERADO", arduino_uptime_ms: 4_931_100, received_at: hoursAgo(27), data: { recuperacion_ms: 5300 } },
    ],
  },
  {
    id: 244,
    session_id: sessionId,
    incident_id: 244,
    first_received_at: hoursAgo(53),
    detected_received_at: hoursAgo(53),
    detected_uptime_ms: 3_014_000,
    priority_uptime_ms: 3_016_100,
    finished_uptime_ms: 3_037_900,
    recovered_uptime_ms: 3_043_300,
    status: "RECUPERADA",
    response_ms: 2100,
    duration_ms: 21_800,
    recovery_ms: 5400,
    events: [
      { type: "EMERGENCIA_DETECTADA", arduino_uptime_ms: 3_014_000, received_at: hoursAgo(53), data: { carril: "A", semaforo_a: "R", semaforo_b: "G" } },
      { type: "PRIORIDAD_ACTIVADA", arduino_uptime_ms: 3_016_100, received_at: hoursAgo(53), data: { respuesta_ms: 2100, semaforo_a: "G", semaforo_b: "R" } },
      { type: "EMERGENCIA_FINALIZADA", arduino_uptime_ms: 3_037_900, received_at: hoursAgo(53), data: { duracion_ms: 21_800 } },
      { type: "CICLO_RECUPERADO", arduino_uptime_ms: 3_043_300, received_at: hoursAgo(53), data: { recuperacion_ms: 5400 } },
    ],
  },
  {
    id: 243,
    session_id: sessionId,
    incident_id: 243,
    first_received_at: hoursAgo(74),
    detected_received_at: hoursAgo(74),
    detected_uptime_ms: 2_104_000,
    priority_uptime_ms: 2_106_200,
    finished_uptime_ms: 2_125_100,
    recovered_uptime_ms: null,
    status: "FINALIZADA",
    response_ms: 2200,
    duration_ms: 19_100,
    recovery_ms: null,
    events: [
      { type: "EMERGENCIA_DETECTADA", arduino_uptime_ms: 2_104_000, received_at: hoursAgo(74), data: { carril: "A", semaforo_a: "R", semaforo_b: "G" } },
      { type: "PRIORIDAD_ACTIVADA", arduino_uptime_ms: 2_106_200, received_at: hoursAgo(74), data: { respuesta_ms: 2200, semaforo_a: "G", semaforo_b: "R" } },
      { type: "EMERGENCIA_FINALIZADA", arduino_uptime_ms: 2_125_100, received_at: hoursAgo(74), data: { duracion_ms: 19_100 } },
    ],
  },
  {
    id: 242,
    session_id: sessionId,
    incident_id: 242,
    first_received_at: hoursAgo(101),
    detected_received_at: hoursAgo(101),
    detected_uptime_ms: 1_003_000,
    priority_uptime_ms: 1_006_500,
    finished_uptime_ms: null,
    recovered_uptime_ms: null,
    status: "PRIORIDAD_ACTIVADA",
    response_ms: 3500,
    duration_ms: null,
    recovery_ms: null,
    events: [
      { type: "EMERGENCIA_DETECTADA", arduino_uptime_ms: 1_003_000, received_at: hoursAgo(101), data: { carril: "A", semaforo_a: "R", semaforo_b: "G" } },
      { type: "PRIORIDAD_ACTIVADA", arduino_uptime_ms: 1_006_500, received_at: hoursAgo(101), data: { respuesta_ms: 3500, semaforo_a: "G", semaforo_b: "R" } },
    ],
  },
  {
    id: 241,
    session_id: sessionId,
    incident_id: 241,
    first_received_at: hoursAgo(126),
    detected_received_at: hoursAgo(126),
    detected_uptime_ms: 248_000,
    priority_uptime_ms: null,
    finished_uptime_ms: null,
    recovered_uptime_ms: null,
    status: "DETECTADA",
    response_ms: null,
    duration_ms: null,
    recovery_ms: null,
    events: [
      { type: "EMERGENCIA_DETECTADA", arduino_uptime_ms: 248_000, received_at: hoursAgo(126), data: { carril: "A", semaforo_a: "R", semaforo_b: "G" } },
    ],
  },
];

export const demoData = {
  state: {
    semaforo_a: "R",
    semaforo_b: "G",
    fase: "B_VERDE",
    modo: "NORMAL",
    restante_ms: 4_200,
    last_heartbeat_received_at: minutesAgo(0.08),
    last_message_received_at: minutesAgo(0.08),
    serial_connected: true,
    controller_observed: true,
    state_stale: false,
    active_session_id: sessionId,
    state_received_at: minutesAgo(0.08),
  },
  incidents,
  events: [
    { type: "HEARTBEAT", status: "OK", received_at: minutesAgo(0.08), arduino_uptime_ms: 8_439_200, incident_id: null, description: "Señal periódica recibida; controlador observado." },
    { type: "CICLO_RECUPERADO", status: "OK", received_at: minutesAgo(17), arduino_uptime_ms: 8_446_200, incident_id: 248, description: "El ciclo volvió al funcionamiento normal." },
    { type: "EMERGENCIA_FINALIZADA", status: "OK", received_at: minutesAgo(17.2), arduino_uptime_ms: 8_441_700, incident_id: 248, description: "Finalizó la emergencia; prioridad liberada." },
    { type: "PRIORIDAD_ACTIVADA", status: "OK", received_at: minutesAgo(17.5), arduino_uptime_ms: 8_422_100, incident_id: 248, description: "Prioridad habilitada para el carril A." },
    { type: "EMERGENCIA_DETECTADA", status: "ATENDIDA", received_at: minutesAgo(18), arduino_uptime_ms: 8_420_000, incident_id: 248, description: "Solicitud acústica confirmada para el carril A." },
    { type: "STATE", status: "OK", received_at: minutesAgo(23), arduino_uptime_ms: 8_100_000, incident_id: null, description: "Estado operativo actualizado: A rojo, B verde." },
    { type: "CICLO_RECUPERADO", status: "OK", received_at: hoursAgo(3), arduino_uptime_ms: 7_131_800, incident_id: 247, description: "El ciclo volvió al funcionamiento normal." },
  ],
};

export function calculateMetrics(records) {
  const average = (values) => values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
  const valid = (field) => records
    .map((record) => record[field])
    .filter((value) => Number.isFinite(value) && value >= 0);
  const statusCounts = records.reduce((counts, record) => {
    counts[record.status] = (counts[record.status] || 0) + 1;
    return counts;
  }, {});
  const byDay = records.reduce((days, record) => {
    const date = new Date(record.first_received_at).toISOString().slice(0, 10);
    days[date] = (days[date] || 0) + 1;
    return days;
  }, {});

  const responseTimes = valid("response_ms");
  return {
    total: records.length,
    response_count: responseTimes.length,
    response_average_ms: average(responseTimes),
    response_min_ms: responseTimes.length ? Math.min(...responseTimes) : null,
    response_max_ms: responseTimes.length ? Math.max(...responseTimes) : null,
    duration_average_ms: average(valid("duration_ms")),
    recovery_average_ms: average(valid("recovery_ms")),
    status_counts: statusCounts,
    incidents_by_day: byDay,
  };
}
