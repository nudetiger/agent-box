/** Width in code points. Tables are plain text; wide (East Asian) characters are not handled. */
export function width(s: string): number {
  return [...s].length;
}

export function pad(s: string, w: number, align: "left" | "right" = "left"): string {
  const fill = " ".repeat(Math.max(0, w - width(s)));
  return align === "left" ? s + fill : fill + s;
}

/** Cuts `s` to fit in `max` characters, marking the cut with an ellipsis. */
export function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join("") + "…" : s;
}
