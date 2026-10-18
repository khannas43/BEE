/** Observation countdown from stored instants — pass `nowMs` in tests; components use live clock by default. */
export function observationCountdown(
  observationEndsAt: string | null | undefined,
  nowMs: number = Date.now(),
): { daysRemaining: number; hoursRemaining: number; expired: boolean } | null {
  if (!observationEndsAt) return null;
  const end = new Date(observationEndsAt).getTime();
  if (Number.isNaN(end)) return null;
  const diffMs = end - nowMs;
  if (diffMs <= 0) return { daysRemaining: 0, hoursRemaining: 0, expired: true };
  const totalHours = Math.ceil(diffMs / (1000 * 60 * 60));
  const daysRemaining = Math.floor(totalHours / 24);
  const hoursRemaining = totalHours % 24;
  return { daysRemaining, hoursRemaining, expired: false };
}
