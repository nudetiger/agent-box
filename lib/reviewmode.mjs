// Review mode: who reviews a change. `split` (the default): two reviewers, one axis each, review-spec
// and review-std. `both`: one reviewer covering both axes, review-both. A project sets REVIEW_MODE in
// its projects/<name>.env; a command overrides it with --review-mode, or names the roles with --roles.
// REVIEW_ROLES, when a project sets it, is the same list as --roles.
//
// Precedence: --roles, then --review-mode, then REVIEW_ROLES, then REVIEW_MODE.
//
//   node lib/reviewmode.mjs roles <mode or ""> <REVIEW_ROLES or ""> <REVIEW_MODE or "">
//     prints the reviewer roles, comma-separated; exit 2 on an unknown mode
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MODES = { split: ["review-spec", "review-std"], both: ["review-both"] };

const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[\s,]+/)).map((x) => x.trim()).filter(Boolean);

// roles: an explicit list (array or "a,b"); mode: an explicit mode; listed/defaultMode: the settings.
export function reviewRoles({ roles, mode, listed, defaultMode } = {}) {
  if (list(roles).length) return list(roles);
  if (mode) {
    if (!MODES[mode]) throw new Error(`unknown review mode ${mode} (split or both)`);
    return [...MODES[mode]];
  }
  if (list(listed).length) return list(listed);
  const m = defaultMode || "split";
  if (!MODES[m]) throw new Error(`unknown REVIEW_MODE ${m} (split or both)`);
  return [...MODES[m]];
}

// The axis a reviewer role covers: spec, std, or both.
export const axisOf = (role) => (/^review-both/.test(role ?? "") ? "both" : role === "review-std" ? "std" : "spec");
// The role that covers an axis, when no run says which role it was.
export const roleOfAxis = (axis) => (axis === "both" ? "review-both" : axis === "std" ? "review-std" : "review-spec");
// The prompt file (lib/ticket/) a reviewer role reads.
export const promptOf = (role) => ({ spec: "review-spec.md", std: "review-standards.md", both: "review-both.md" })[axisOf(role)];

const main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main && process.argv[2] === "roles") {
  try { console.log(reviewRoles({ mode: process.argv[3], listed: process.argv[4], defaultMode: process.argv[5] }).join(",")); }
  catch (e) { console.error(`agent-box: ${e.message}`); process.exit(2); }
}
