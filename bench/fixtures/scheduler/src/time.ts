/** Minutes after midnight. Values past 1440 belong to the next day. */
export type Minutes = number;

export const DAY = 1440;

export function parseTime(t: string): Minutes {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`not a time: ${t}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Wall-clock text for a minute count; 25:30 prints as 01:30. */
export function formatTime(minutes: Minutes): string {
  const m = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
