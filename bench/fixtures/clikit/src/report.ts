import { UsageError } from "./args.ts";
import { parseCsv } from "./csv.ts";
import { formatTable } from "./table.ts";

export interface ReportOptions {
  columns?: string[];
  limit?: number;
  maxWidth?: number;
}

export function report(csvText: string, options: ReportOptions = {}): string {
  const [header, ...body] = parseCsv(csvText).filter((r) => r.some((c) => c !== ""));
  if (!header) throw new UsageError("the file has no header row");
  const shown = options.columns ?? header;
  const index = shown.map((name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new UsageError(`unknown column: ${name}`);
    return i;
  });
  let rows = body.map((r) => index.map((i) => r[i] ?? ""));
  if (options.limit !== undefined) rows = rows.slice(0, options.limit);
  return formatTable(shown, rows, { maxWidth: options.maxWidth });
}
