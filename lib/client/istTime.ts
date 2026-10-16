/**
 * Times on the demonstration screens in Indian Standard Time, as "YYYY-MM-DD HH:mm:ss" (the service sends UTC instants). A value that is not
 * a date comes back as it was, so a screen never shows "Invalid Date".
 */
const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

export function istStamp(iso: string | null | undefined, withSeconds = true): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = Object.fromEntries(PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}${withSeconds ? `:${p.second}` : ""}`;
}
