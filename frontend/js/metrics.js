export function calculateMetrics(records, serverMetrics = {}) {
  const valid = (field) => records
    .map((record) => record[field])
    .filter((value) => Number.isFinite(value) && value >= 0);
  const average = (values) => values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
  const statusCounts = records.reduce((counts, record) => {
    counts[record.status] = (counts[record.status] || 0) + 1;
    return counts;
  }, {});
  const byDay = records.reduce((days, record) => {
    if (!record.first_received_at) return days;
    const date = new Date(record.first_received_at);
    if (Number.isNaN(date.getTime())) return days;
    const key = date.toISOString().slice(0, 10);
    days[key] = (days[key] || 0) + 1;
    return days;
  }, {});
  const responseTimes = valid("response_ms");

  return {
    total: Number.isFinite(serverMetrics.total) ? serverMetrics.total : records.length,
    response_count: Number.isFinite(serverMetrics.response_count)
      ? serverMetrics.response_count
      : responseTimes.length,
    response_average_ms: serverMetrics.response_average_ms ?? null,
    response_min_ms: serverMetrics.response_min_ms ?? null,
    response_max_ms: serverMetrics.response_max_ms ?? null,
    duration_average_ms: average(valid("duration_ms")),
    recovery_average_ms: average(valid("recovery_ms")),
    status_counts: statusCounts,
    incidents_by_day: byDay,
  };
}
