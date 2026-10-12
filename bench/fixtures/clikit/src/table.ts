import { pad, truncate, width } from "./text.ts";

export interface TableOptions {
  maxWidth?: number;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** A column is numeric when every non-empty cell is a number. */
export function isNumericColumn(rows: string[][], col: number): boolean {
  const cells = rows.map((r) => r[col] ?? "").filter((c) => c !== "");
  return cells.length > 0 && cells.every((c) => NUMBER.test(c));
}

/** Header, a dashed rule, then the rows; numeric columns align right. */
export function formatTable(header: string[], rows: string[][], options: TableOptions = {}): string {
  const maxWidth = options.maxWidth ?? 24;
  const cells = [header, ...rows].map((r) => header.map((_, c) => truncate(r[c] ?? "", maxWidth)));
  const widths = header.map((_, c) => Math.max(...cells.map((r) => width(r[c]))));
  const right = header.map((_, c) => isNumericColumn(rows, c));
  const line = (r: string[]) =>
    r
      .map((cell, c) => pad(cell, widths[c], right[c] ? "right" : "left"))
      .join("  ")
      .trimEnd();
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(cells[0]), rule, ...cells.slice(1).map(line)].join("\n") + "\n";
}
