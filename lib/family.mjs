// Model family: the vendor whose model an OmniRoute id names, not the router or subscription it comes
// through. The spec reviewer is never the implementer's family: a model rates its own output higher,
// and a mixed pair of reviews finds more than a same-model pair (research/workflow.md §3).
//
//   node lib/family.mjs spec-role <implementer model> <review-spec model> [<review-spec-alt model>]
//     prints review-spec, or review-spec-alt when review-spec is the implementer's family
//   node lib/family.mjs use-alt <implementer model> <reviewer model> [<alt model>]
//     prints alt when the reviewer is the implementer's family and the alt is not, else main
import { fileURLToPath } from "node:url";
import path from "node:path";

export function family(model) {
  const m = String(model ?? "").toLowerCase().trim().split(/\s+/)[0];
  if (/deepseek/.test(m)) return "deepseek";
  if (/gemini/.test(m)) return "google";
  if (/claude|opus|sonnet|haiku/.test(m)) return "anthropic";
  if (/kimi/.test(m)) return "moonshot";
  if (/gpt|codex|^cx\//.test(m)) return "openai";
  if (/grok/.test(m)) return "xai";
  if (/composer/.test(m)) return "cursor";
  return m;
}

// True when a reviewer on `model` would review its own family's code and `alt` would not.
export function useAlt(implementer, model, alt) {
  return !!implementer && family(implementer) === family(model) && !!alt && family(alt) !== family(implementer);
}
export function specRole(implementer, spec, alt) {
  return useAlt(implementer, spec, alt) ? "review-spec-alt" : "review-spec";
}

const main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main && process.argv[2] === "spec-role") console.log(specRole(process.argv[3], process.argv[4], process.argv[5]));
if (main && process.argv[2] === "use-alt") console.log(useAlt(process.argv[3], process.argv[4], process.argv[5]) ? "alt" : "main");
