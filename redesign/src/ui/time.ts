/** "52 min", "2 h 17 min", "3 h". */
export function formatRuntimeLong(seconds: number): string {
  const total = Math.round(seconds / 60);
  if (total < 60) return `${Math.max(1, total)} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "32 min left", "1 h 4 min left"; nothing when the length isn't known. */
export function formatLeft(position: number, duration: number): string {
  if (!(duration > 0)) return "";
  return `${formatRuntimeLong(Math.max(0, duration - position))} left`;
}

/** "S2 E3", or nothing without a season. */
export function episodeCode(season?: number, episode?: number): string {
  if (season == null) return "";
  return episode == null ? `S${season}` : `S${season} E${episode}`;
}

/** "12 Mar 2022" from an ISO date. */
export function formatDay(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The year a title came out, from Cinemeta's "2019–" or "2019–2022" style releaseInfo. */
export function yearOf(releaseInfo?: string): string {
  return releaseInfo?.match(/\d{4}/)?.[0] ?? "";
}
