export function classifyBackendStatus({
  healthFailures,
  lastApiSuccessAt,
  now = Date.now(),
  resourceErrors,
}) {
  const recentApiSuccess = lastApiSuccessAt !== null
    && now - lastApiSuccessAt < 30_000;
  if (healthFailures >= 2 && !recentApiSuccess) return "unavailable";
  if (healthFailures > 0 || Object.keys(resourceErrors).length > 0) return "temporary";
  return lastApiSuccessAt === null ? "checking" : "connected";
}
