import { dayOfWeek, daysInMonth, formatDate, fromDays, parseDate, toDays, weekStart, type CivilDate } from "./dates.ts";

export type Rule =
  | { freq: "daily"; interval?: number; until?: CivilDate }
  | { freq: "weekly"; days: number[]; interval?: number; until?: CivilDate }
  | { freq: "monthly"; day: number; until?: CivilDate };

/** Every `interval` days, counted from `start`. */
export function expandDaily(rule: Extract<Rule, { freq: "daily" }>, start: CivilDate, from: CivilDate, to: CivilDate): CivilDate[] {
  const out: CivilDate[] = [];
  const step = rule.interval ?? 1;
  const last = rule.until !== undefined && rule.until < to ? rule.until : to;
  let n = toDays(start);
  const lo = toDays(from);
  // Jump to the first occurrence on or after `from` instead of walking from `start`.
  if (n < lo) n += Math.ceil((lo - n) / step) * step;
  for (; n <= toDays(last); n += step) out.push(fromDays(n));
  return out;
}

/** The listed weekdays of every `interval`-th week, counting weeks from the Monday of `start`'s week. */
export function expandWeekly(rule: Extract<Rule, { freq: "weekly" }>, start: CivilDate, from: CivilDate, to: CivilDate): CivilDate[] {
  const out: CivilDate[] = [];
  const step = rule.interval ?? 1;
  const last = rule.until !== undefined && rule.until < to ? rule.until : to;
  const anchor = toDays(weekStart(start));
  for (let n = Math.max(toDays(start), toDays(from)); n <= toDays(last); n++) {
    const week = Math.floor((n - anchor) / 7);
    if (week % step === 0 && rule.days.includes(dayOfWeek(fromDays(n)))) out.push(fromDays(n));
  }
  return out;
}

/** The given day of every month from `start`'s month on; months without that day are skipped, not clamped. */
export function expandMonthly(rule: Extract<Rule, { freq: "monthly" }>, start: CivilDate, from: CivilDate, to: CivilDate): CivilDate[] {
  const out: CivilDate[] = [];
  const last = rule.until !== undefined && rule.until < to ? rule.until : to;
  const lo = from > start ? from : start;
  let { y, m } = parseDate(start);
  while (formatDate(y, m, 1) <= last) {
    if (rule.day <= daysInMonth(y, m)) {
      const d = formatDate(y, m, rule.day);
      if (d >= lo && d <= last) out.push(d);
    }
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Dates in [from, to] on which an event starting on `start` occurs; no rule means once. */
export function occurrenceDates(rule: Rule | undefined, start: CivilDate, from: CivilDate, to: CivilDate): CivilDate[] {
  if (rule === undefined) return start >= from && start <= to ? [start] : [];
  switch (rule.freq) {
    case "daily":
      return expandDaily(rule, start, from, to);
    case "weekly":
      return expandWeekly(rule, start, from, to);
    case "monthly":
      return expandMonthly(rule, start, from, to);
  }
}
