/**
 * `formatLocalTime` lives here rather than in render.ts because the state reducer names a
 * user removal by its local time and render.ts is about drawing, not about clocks.
 */

/** Local time as `HH:MM`, ASCII digits and a colon in any locale; `--:--` if unusable. */
export function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
