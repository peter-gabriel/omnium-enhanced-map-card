// Custom date/time window shown instead of the last N hours. Times are epoch ms; inputs use the
// browser's local time, like <input type="datetime-local">.

export interface TimeRange {
  start: number;
  end: number;
}

/** longest window allowed (history requests grow with it) */
export const MAX_RANGE_DAYS = 31;
const DAY = 86_400_000;
/** a window ending more than this before now is "in the past": nothing in it is ongoing */
const PAST_MARGIN = 60_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** epoch ms → "YYYY-MM-DDTHH:mm" in local time, for datetime-local inputs */
export function toInputValue(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" (local time) → epoch ms, or NaN */
export function fromInputValue(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi).getTime();
}

/** Whether a window can be shown: start before end, at most MAX_RANGE_DAYS long, not starting in the future. */
export function isValidRange(r: TimeRange, now: number): boolean {
  return (
    Number.isFinite(r.start) && Number.isFinite(r.end) && r.start < r.end && r.end - r.start <= MAX_RANGE_DAYS * DAY && r.start < now
  );
}

/** A whole local day: 0 = today (until now), 1 = yesterday, … */
export function dayRange(daysAgo: number, now: number): TimeRange {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo).getTime();
  const end = daysAgo === 0 ? now : new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo + 1).getTime() - 1;
  return { start, end };
}

export function isPastRange(r: TimeRange | undefined, now: number): boolean {
  return !!r && r.end < now - PAST_MARGIN;
}
