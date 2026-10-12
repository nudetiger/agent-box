// Civil dates ("YYYY-MM-DD") in the proleptic Gregorian calendar. No time zones and no Date objects,
// so the same input gives the same answer on every machine.

export type CivilDate = string;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function parseDate(d: CivilDate): { y: number; m: number; day: number } {
  const match = DATE.exec(d);
  if (!match) throw new Error(`not a date: ${d}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const day = Number(match[3]);
  if (m < 1 || m > 12 || day < 1 || day > daysInMonth(y, m)) throw new Error(`not a date: ${d}`);
  return { y, m, day };
}

export function formatDate(y: number, m: number, day: number): CivilDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Days since 1970-01-01 (Howard Hinnant's days_from_civil). */
export function toDays(d: CivilDate): number {
  const { y: year, m, day } = parseDate(d);
  const y = year - (m <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDays(n: number): CivilDate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return formatDate(yoe + era * 400 + (m <= 2 ? 1 : 0), m, day);
}

export function addDays(d: CivilDate, n: number): CivilDate {
  return fromDays(toDays(d) + n);
}

/** ISO weekday: 1 is Monday, 7 is Sunday. */
export function dayOfWeek(d: CivilDate): number {
  // 1970-01-01 was a Thursday.
  return ((((toDays(d) + 3) % 7) + 7) % 7) + 1;
}

/** The Monday on or before `d`. */
export function weekStart(d: CivilDate): CivilDate {
  return addDays(d, 1 - dayOfWeek(d));
}
