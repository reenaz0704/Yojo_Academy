/**
 * Academy day and week boundaries use India Standard Time (UTC+05:30, no daylight saving): daily patches reset at
 * midnight IST, the weekly league and weekly ops reset Monday 00:00 IST (the existing page copy).
 */
const IST_MS = 330 * 60_000;

/** IST calendar day of an instant, as YYYY-MM-DD. */
export function istDay(at: Date = new Date()): string {
  return new Date(at.getTime() + IST_MS).toISOString().slice(0, 10);
}

/** Monday (IST) of the week containing `at`, as YYYY-MM-DD. */
export function istWeekStart(at: Date = new Date()): string {
  const d = new Date(`${istDay(at)}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** The instant a YYYY-MM-DD IST day starts. */
export function istDayStart(day: string): Date {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - IST_MS);
}

/** A YYYY-MM-DD value for a Prisma @db.Date column. */
export const dateCol = (day: string) => new Date(`${day}T00:00:00Z`);
export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
