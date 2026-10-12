import type { CommandSpec } from "./args.ts";
import { pad } from "./text.ts";

export function formatHelp(spec: CommandSpec): string {
  const usage = ["clikit", spec.name, "[options]", ...spec.positionals.map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`))];
  const rows: [string, string][] = [];
  for (const [name, f] of Object.entries(spec.flags)) {
    rows.push([`${f.short ? `-${f.short}, ` : "    "}--${name}`, f.description]);
  }
  for (const [name, o] of Object.entries(spec.options)) {
    const def = o.default === undefined ? "" : ` (default ${o.default})`;
    rows.push([`${o.short ? `-${o.short}, ` : "    "}--${name} <${o.placeholder ?? "value"}>`, o.description + def]);
  }
  const w = Math.max(...rows.map(([left]) => left.length));
  return [
    spec.summary,
    "",
    `Usage: ${usage.join(" ")}`,
    "",
    ...spec.positionals.map((p) => `  ${p.name}  ${p.description}`),
    "",
    "Options:",
    ...rows.map(([left, text]) => `  ${pad(left, w)}  ${text}`),
  ].join("\n") + "\n";
}
