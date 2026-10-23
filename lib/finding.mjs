// One review finding in the shape every reader expects: {issue, severity, category, file, line,
// scenario, basis, repro: {file, content, cmd}}. Reviewers drift from it: RakunLoots P9 (2026-10-22)
// wrote findings with no `issue` (fix prompts read "2.both.1 undefined"), and title/expected/actual
// with repro.command. The original keys stay; the expected ones are filled in from the others.
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const firstSentence = (t) => { const s = str(t); if (!s) return null; const m = s.match(/^(.{20,200}?[.!?])(\s|$)/); return m ? m[1] : s.slice(0, 200); };

export function normalizeFinding(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return x;
  const f = { ...x };
  if (!str(f.scenario)) {
    const ea = [str(f.expected) && `expected ${str(f.expected)}`, str(f.actual) && `actual ${str(f.actual)}`].filter(Boolean).join(", ");
    const s = str(f.failure_scenario) ?? str(f.fails_when) ?? (ea || null);
    if (s) f.scenario = s;
  }
  if (!str(f.issue)) {
    const i = str(f.title) ?? str(f.summary) ?? str(f.description) ?? str(f.problem) ?? firstSentence(f.scenario);
    if (i) f.issue = i;
  }
  if (f.repro && typeof f.repro === "object" && !Array.isArray(f.repro)) {
    const r = { ...f.repro };
    if (!str(r.cmd)) { const c = str(r.command) ?? str(r.run); if (c) r.cmd = c; }
    if (typeof r.content !== "string") { const c = r.code ?? r.source ?? r.test; if (typeof c === "string") r.content = c; }
    if (!str(r.file)) { const p = str(r.path); if (p) r.file = p; }
    f.repro = r;
  }
  return f;
}

export const normalizeFindings = (xs) => (Array.isArray(xs) ? xs.map(normalizeFinding) : xs);

// The ids a selector names: a finding's own `id` when the reviewer gave one, else its 1-based position.
// RakunLoots P9 (2026-10-23): `--findings run:6` selected nothing; 6 was the finding's id, not its position.
export function selectFindings(all, nums) {
  if (!nums) return { pick: all, by: "all" };
  const want = nums.map(String);
  const byId = all.filter((x) => x.id !== undefined && x.id !== null && want.includes(String(x.id)));
  if (byId.length) return { pick: byId, by: "id" };
  return { pick: all.filter((x, i) => want.includes(String(i + 1))), by: "position" };
}
