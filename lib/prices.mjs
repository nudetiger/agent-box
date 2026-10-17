// Prices per model, applied when the ledger is read: a run's cost is its tokens times the price table,
// unless OpenCode already priced it. Editing prices.conf reprices every past run as well.
//
// prices.conf (and prices.local.conf, not in git, which wins): one line per model,
//   <model id or glob> <input> <output> <cache read>      USD per 1M tokens; # starts a comment
// Reasoning tokens are billed as output. A model with no line stays unpriced (cost null, never 0).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parsePrices(text) {
  const out = [];
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [id, ...n] = line.split(/\s+/);
    const [input, output, cached = input] = n.map(Number);
    if (!id || ![input, output, cached].every(Number.isFinite)) continue;
    const re = new RegExp(`^${id.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    out.push({ id, re, input, output, cached });
  }
  return out;
}

let table;
export function prices(dir = BOX) {
  if (table && dir === BOX) return table;
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), "utf8"); } catch { return ""; } };
  // Local lines first: the first match wins.
  const t = [...parsePrices(read("prices.local.conf")), ...parsePrices(read("prices.conf"))];
  if (dir === BOX) table = t;
  return t;
}

export function priceOf(model, table = prices()) {
  const m = String(model ?? "");
  return table.find((p) => p.re.test(m)) ?? null;
}

// USD for one run event, or null when neither OpenCode nor the table priced it.
export function costOf(run, table = prices()) {
  if (typeof run?.cost === "number" && run.cost > 0) return run.cost;
  const p = priceOf(run?.model, table), t = run?.tokens;
  if (!p || !t) return null;
  return ((t.input ?? 0) * p.input + ((t.output ?? 0) + (t.reasoning ?? 0)) * p.output + (t.cache_read ?? 0) * p.cached) / 1e6;
}
