// Running workers: one `ps` per refresh, then one `exec cat /out/progress.json` per container.
// STATS_LIVE_FIXTURE=<json file> replaces the probe (tests run without an engine).
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { ui, S, T, cat, box, flow, kv, segw, padr, clip, fdur, fnum, fpct, fago, shortModel, note, section, rep } from "./style.mjs";

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      timeout, windowsHide: true, maxBuffer: 4 << 20,
      // Git Bash would rewrite /out/progress.json into a Windows path
      env: { ...process.env, MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*" },
    }, (err, stdout) => resolve(err ? { err } : { out: String(stdout) }));
  });
}

function parsePs(text) {
  const t = text.trim();
  if (!t) return [];
  try { const j = JSON.parse(t); return Array.isArray(j) ? j : [j]; } catch { /* docker: one object per line */ }
  return t.split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}
function labelsOf(c) {
  if (c.Labels && typeof c.Labels === "object") return c.Labels;
  return Object.fromEntries(String(c.Labels ?? "").split(",").filter(Boolean).map((kv) => kv.split(/=(.*)/s).slice(0, 2)));
}

export async function probe(env = process.env) {
  if (env.STATS_LIVE_FIXTURE) {
    try { return { workers: JSON.parse(readFileSync(env.STATS_LIVE_FIXTURE, "utf8")), error: null }; }
    catch (e) { return { workers: [], error: `fixture: ${e.message}` }; }
  }
  const engine = env.AGENT_BOX_ENGINE || "podman";
  const ps = await run(engine, ["ps", "--filter", "label=agent-box=1", "--format", "json"], 3000);
  if (ps.err) return { workers: [], error: `${engine} ps failed: ${String(ps.err.code ?? ps.err.message).slice(0, 80)}` };
  const cs = parsePs(ps.out);
  const workers = await Promise.all(cs.map(async (c) => {
    const name = String(Array.isArray(c.Names) ? c.Names[0] : String(c.Names ?? c.Name ?? "").split(",")[0]).replace(/^\//, "");
    const project = labelsOf(c)["agent-box.project"] ?? null;
    const pre = project ? `agent-box-${project}-` : "agent-box-";
    const created = num(c.StartedAt) && c.StartedAt > 0 ? c.StartedAt * 1000 : num(c.Created) ? c.Created * 1000 : Date.parse(c.CreatedAt ?? "") || null;
    const r = await run(engine, ["exec", name, "cat", "/out/progress.json"], 3000);
    let progress = null;
    if (!r.err) try { progress = JSON.parse(r.out); } catch { /* not written yet */ }
    return { name, project, run: name.startsWith(pre) ? name.slice(pre.length) : name, created, progress };
  }));
  return { workers, error: null };
}
const num = (x) => typeof x === "number" && Number.isFinite(x);

// Plain model for `json live` and the cards.
export function liveModel(p, nowMs) {
  return {
    error: p.error ?? null,
    workers: (p.workers ?? []).map((w) => {
      const g = w.progress && typeof w.progress === "object" ? w.progress : null;
      const tk = g?.tokens ?? null;
      const started = num(g?.started) ? g.started : w.created ?? null;
      return {
        name: w.name ?? null, project: w.project ?? null, run: w.run ?? w.name ?? null,
        phase: g ? g.phase ?? "agent" : "starting", model: g?.model ?? null, role: g?.role ?? null,
        elapsed: started ? Math.max(0, (nowMs - started) / 1000) : null,
        steps: num(g?.steps) ? g.steps : null, tools: num(g?.tools) ? g.tools : null,
        tokensIn: tk ? (tk.input ?? 0) + (tk.cache_read ?? 0) : null, tokensOut: tk ? tk.output ?? 0 : null,
        cacheHit: tk && (tk.input ?? 0) + (tk.cache_read ?? 0) > 0 ? (tk.cache_read ?? 0) / ((tk.input ?? 0) + (tk.cache_read ?? 0)) : null,
        last: g?.last?.tool ? { tool: g.last.tool, what: g.last.what ?? "", ago: num(g.last.ts) ? Math.max(0, (nowMs - g.last.ts) / 1000) : null } : null,
        questions: num(g?.questions_open) ? g.questions_open : 0, blocked: g?.blocked === true, autofix: num(g?.autofix) ? g.autofix : 0,
      };
    }).sort((a, b) => (b.elapsed ?? 0) - (a.elapsed ?? 0)),
  };
}

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PHASE = { setup: "accent", agent: "violet", test: "teal", autofix: "orange", done: "good", starting: "dim" };

function card(w, width, frame) {
  const style = w.blocked || w.questions > 0 ? "warn" : PHASE[w.phase] ?? "accent";
  const glyph = w.phase === "done" ? "✓" : w.phase === "starting" ? "◌" : SPIN[frame % SPIN.length];
  const inner = width - 4;
  const title = cat(S(style + "+b", glyph + " "), S("text+b", w.run ?? "?"));
  const right = cat(S(style, w.phase), w.project ? cat(S("faint", " · "), S("dim", w.project)) : []);
  const fill = Math.max(width - 6 - segw(title) - segw(right) - 2, 1);
  const lines = [];
  lines.push(w.model ? cat(S("accent", shortModel(w.model)), w.role ? cat(S("faint", " · "), S("dim", w.role)) : []) : S("dim", "model not reported yet"));
  if (w.phase === "starting") lines.push(cat(kv("elapsed", fdur(w.elapsed))), S("dim+i", "no progress.json yet: setup is running or the exec failed"), []);
  else {
    lines.push(cat(kv("elapsed", fdur(w.elapsed)), "   ", kv("steps", fnum(w.steps)), "   ", kv("tools", fnum(w.tools)),
      w.autofix ? cat("   ", kv("autofix", String(w.autofix), "orange+b")) : []));
    lines.push(cat(kv("tokens", fnum(w.tokensIn)), S("dim", " in · "), S("text+b", fnum(w.tokensOut)), S("dim", " out · cache "),
      S(w.cacheHit == null ? "dim" : w.cacheHit >= 0.7 ? "good+b" : "warn+b", fpct(w.cacheHit))));
    lines.push(w.last ? cat(S("dim", "last "), S(w.last.tool === "edit" || w.last.tool === "write" ? "warn" : w.last.tool === "bash" ? "teal" : "text", w.last.tool),
      " ", S("text", w.last.what), S("faint", "  " + fago(w.last.ago))) : S("dim", "no tool call yet"));
  }
  if (w.blocked || w.questions > 0) lines.push(S("warn+b", `⚑ ${w.questions || 1} open question${w.questions > 1 ? "s" : ""}${w.blocked ? " · blocked" : ""} · delegate.sh questions ${w.project ?? "<repo>"} ${w.run}`));
  else lines.push([]);
  return [
    cat(S(style, "╭─ "), title, " ", S("faint", rep("─", fill)), " ", right, S(style, " ─╮")),
    ...lines.map((l) => cat(S("faint", "│ "), padr(clip(l, inner), inner), S("faint", " │"))),
    cat(S("faint", "╰" + rep("─", width - 2) + "╯")),
  ];
}

export function drawLive(m, frame = 0) {
  const out = [...section("live", `${m.workers.length} running · refreshed every 2 s in the tui`)];
  if (!m.workers.length) {
    out.push([], cat("   ", S("faint", "◌  "), S("text", "No worker is running."), S("dim", "  All quiet in the box.")), [],
      cat("      ", S("dim", "start one   "), S("accent", "delegate.sh run <repo> <task.md> --role implement")),
      cat("      ", S("dim", "fan out     "), S("accent", "delegate.sh fanout <repo> <task.md> --roles implement,implement-alt")));
    if (m.error) out.push([], note("faint", "  " + m.error));
    return out;
  }
  const cols = ui.WW >= 120 ? 2 : 1;
  const width = Math.floor((ui.WW - 1 - (cols - 1)) / cols);
  const cards = m.workers.map((w) => card(w, width, frame));
  const waiting = m.workers.filter((w) => w.blocked || w.questions > 0).length;
  out.push(cat("   ", flow([kv("running", String(m.workers.length)),
    kv("waiting on you", String(waiting), waiting ? "warn+b" : "good+b"),
    kv("tokens", fnum(m.workers.reduce((n, w) => n + (w.tokensIn ?? 0) + (w.tokensOut ?? 0), 0)))], ui.WW - 4)[0]), []);
  for (let i = 0; i < cards.length; i += cols) {
    const row = cards.slice(i, i + cols);
    const h = Math.max(...row.map((c) => c.length));
    if (i) out.push([]);
    for (let y = 0; y < h; y++) out.push(cat(" ", ...row.flatMap((c, k) => [k ? " " : [], c[y] ?? T(" ".repeat(width))])));
  }
  return out;
}
