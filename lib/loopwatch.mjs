// Live view of one review and fix loop (lib/loop.mjs): reads the loop's progress.jsonl as it grows and
// prints one coloured line per step, finding and decision, with what runs now and for how long on the
// bottom line. Inside a herdr pane it also reports the loop's state to herdr. Ends when the loop stops.
// Each worker run the loop starts has its own tab (delegate.sh watch); the check has none, so this is
// the only place it shows.
//
//   node lib/loopwatch.mjs <progress.jsonl> <loop> [repo]
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

export function palette(tty) {
  const rgb = (r, g, b) => (tty ? `\x1b[38;2;${r};${g};${b}m` : "");
  return { x: tty ? "\x1b[0m" : "", b: tty ? "\x1b[1m" : "", dim: rgb(128, 136, 150), faint: rgb(76, 82, 94), text: rgb(220, 223, 228),
    accent: rgb(97, 175, 239), good: rgb(152, 195, 121), warn: rgb(229, 192, 123), bad: rgb(224, 108, 117),
    violet: rgb(198, 120, 221), teal: rgb(86, 182, 194), orange: rgb(209, 154, 102) };
}

export const dur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};
const time = (ms) => new Date(ms || Date.now()).toTimeString().slice(0, 8);
const one = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const short = (m) => String(m ?? "").replace(/^.*\//, "").replace(/-tiered$/, "");

const KIND = { first: "first review · both axes · the whole change", fix: "recheck · the same reviewers · the fix's own diff",
  final: "final review · both axes · the whole change" };
// What the orchestrator does for each way a loop stops (SKILL.md, step 4).
export function hint(next, repo, loop, last) {
  const r = `delegate.sh loop resume ${repo || "<repo>"} ${loop}`;
  return { approve: `your own final check, then merge agent/${last}`, answer_spec: `${r} --answer "..."`,
    triage: `check them; ${r} --drop ID,ID (or nothing, to keep them all)`, answer_question: `${r} -m "..."`,
    decide: `read state.json: ${r} --max-rounds N, take over, or stop` }[next] ?? `the run's own next: ${next} (agent/${last})`;
}

// One event -> the lines to print. s is the view's state: {running, k, maxRounds, step, name, repo}.
export function render(e, s, C, cols = 100) {
  const L = [];
  const line = (glyph, gc, what) => L.push(`${C.faint}${time(e.t)}${C.x} ${gc}${glyph}${C.x} ${what}`);
  const rule = (text, color) => L.push(`${C.faint}──${C.x} ${color}${C.b}${text}${C.x} ${C.faint}${"─".repeat(Math.max(2, cols - text.length - 4))}${C.x}`);
  const sevc = (v) => ({ critical: C.bad + C.b, high: C.bad, medium: C.warn }[String(v).toLowerCase()] ?? C.dim);
  const ROUTE = { proven: [C.bad + C.b, "PROVEN"], dropped: [C.dim, "dropped"], note: [C.dim, "note"], question: [C.violet + C.b, "QUESTION"],
    triage: [C.warn + C.b, "TRIAGE"], advice: [C.orange, "advice"], outside: [C.dim, "outside"] };
  switch (e.ev) {
    case "start": {
      s.running = true; s.maxRounds = e.settings?.maxRounds ?? s.maxRounds; s.k = 0;
      const w = cols - 2, title = ` ${s.name} `, sub = ` review and fix loop · max ${s.maxRounds ?? "?"} rounds `;
      L.push(`${C.faint}╭─${C.x}${C.accent}${C.b}${title}${C.x}${C.faint}${"─".repeat(Math.max(1, w - title.length - sub.length - 4))}${C.x}${C.dim}${sub}${C.x}${C.faint}─╮${C.x}`,
        `${C.faint}╰${"─".repeat(w)}╯${C.x}`);
      line("▪", C.faint, `${C.text}starts on agent/${e.run}${C.x} ${C.dim}(${[short(e.model), e.tier].filter(Boolean).join(", ")}) ${e.settings?.fresh ? `· on a stall: fresh ${e.settings.fresh.join(" + ")}` : `· ladder ${(e.settings?.ladder ?? []).join(" → ")}`}${C.x}`);
      break;
    }
    case "resume": {
      s.running = true; if (e.maxRounds) s.maxRounds = Number(e.maxRounds);
      rule("resumed by the orchestrator", C.violet);
      const what = [e.answer && "a ruling", e.drop?.length && `dropped ${e.drop.join(", ")}`, e.add && "its own findings",
        e.message && "a message", e.maxRounds && `max ${e.maxRounds} rounds`].filter(Boolean);
      line("↳", C.violet, `${C.violet}${what.join(" · ") || "no changes: go on"}${C.x}`);
      break;
    }
    case "round":
      s.k = e.k;
      rule(`round ${e.k}/${s.maxRounds ?? "?"} · ${KIND[e.kind] ?? e.kind}`, C.accent);
      line("▪", C.faint, `${C.dim}reviewing agent/${e.run} (${[short(e.model), e.tier].filter(Boolean).join(", ")})${C.x}`);
      break;
    case "step": {
      // The base suite runs beside the review: a note, not the current step.
      if (e.what === "basesuite") { line("▶", C.faint, `${C.dim}base suite ${e.run}, beside the review: \`${one(e.cmd ?? "", cols - 40)}\`${C.x}`); break; }
      s.step = { what: e.what, run: e.run, t: e.t };
      if (e.what === "review") line("▶", C.teal, `${C.teal}${C.b}${e.resumed ? "recheck " : "review  "}${C.x} ${C.text}${(e.runs ?? []).join(", ")}${C.x}${e.against ? ` ${C.dim}${e.resumed ? "same session, the fix since" : "against"} agent/${e.against}${C.x}` : ""}`);
      else if (e.what === "fresh") {
        line("⇧", C.violet + C.b, `${C.violet}${C.b}fresh   ${C.x} ${C.violet}${(e.runs ?? []).length} attempts from the base, in parallel${C.x} ${C.text}${(e.runs ?? []).join(", ")}${C.x}`);
        L.push(`           ${C.dim}why: ${one(e.reason ?? "", cols - 16)}${C.x}`);
      } else if (e.what === "select") line("▶", C.violet, `${C.violet}${C.b}select  ${C.x} ${C.text}${(e.runs ?? []).join(" vs ")}${C.x} ${C.dim}the selector picks between equals${C.x}`);
      else if (e.what === "check") line("▶", C.teal, `${C.teal}${C.b}check   ${C.x} ${C.text}${e.repros} reproduction${e.repros === 1 ? "" : "s"} · ${e.neighbours} test file${e.neighbours === 1 ? "" : "s"} next to the change${C.x} ${C.dim}(${e.run})${C.x}`);
      else if (e.what === "fix") line("▶", C.orange, `${C.orange}${C.b}fix     ${C.x} ${C.text}${e.run}${C.x} ${C.dim}same worker (${short(e.model) || "?"}) · ${e.proven} to fix${e.advice ? ` + ${e.advice} advice` : ""}${C.x}`);
      else if (e.what === "escalate") {
        line("⇧", C.violet + C.b, `${C.violet}${C.b}escalate${C.x} ${C.violet}${e.from} → ${e.to}${C.x} ${C.text}${e.run}${C.x}`);
        L.push(`           ${C.dim}why: ${one(e.reason, cols - 16)}${C.x}`);
      } else if (e.what === "answer") line("▶", C.violet, `${C.violet}${C.b}answer  ${C.x} ${C.text}${e.run}${C.x} ${C.dim}the blocked worker gets the orchestrator's answer${C.x}`);
      break;
    }
    case "done": {
      if (e.what === "basesuite") {
        line(e.exit === null ? "✗" : "✓", e.exit === null ? C.warn : C.good, e.exit === null
          ? `${C.warn}base suite: no usable result; each check runs the base itself${C.x}`
          : `${C.good}base suite${C.x} ${C.dim}exit ${e.exit} · ${e.fails} already failing${e.seconds != null ? ` · ${e.seconds}s` : ""}${C.x}`);
        break;
      }
      const took = s.step?.t ? ` ${C.dim}· ${dur(e.t - s.step.t)}${C.x}` : "";
      s.step = null;
      if (e.what === "review") line("✓", C.good, `${C.good}review  ${C.x} ${C.text}${e.findings} finding${e.findings === 1 ? "" : "s"}${C.x}${took}`);
      else if (e.what === "check") {
        const ex = Object.values(e.repro ?? {}), fail = ex.filter((x) => x !== 0).length, pass = ex.length - fail;
        const n = e.neighbours, nb = !n ? `${C.dim}no tests next to the change${C.x}` : n.exit === 0 ? `${C.good}tests next to the change pass${C.x}`
          : n.regression ? `${C.bad}${C.b}tests next to the change: REGRESSION${C.x}` : `${C.warn}tests next to the change fail on the base too${C.x}`;
        line(fail || n?.regression ? "✗" : "✓", fail || n?.regression ? C.bad : C.good,
          `${C.good}check   ${C.x} ${fail ? C.bad : C.dim}${fail} reproduction${fail === 1 ? "" : "s"} fail${fail === 1 ? "s" : ""}${C.x} ${C.dim}· ${pass} pass${C.x} · ${nb}${took}`);
        if (n?.new_fails?.length) L.push(`           ${C.bad}newly failing: ${one(n.new_fails.join(", "), cols - 26)}${C.x}`);
        const secs = Object.entries(e.seconds ?? {});
        if (secs.length) L.push(`           ${C.dim}${one(secs.map(([k, v]) => `${k} ${v}s`).join(" · "), cols - 12)}${C.x}`);
      } else if (e.what === "fresh") {
        line("▪", C.violet, `${C.violet}fresh   ${C.x} ${(e.runs ?? []).map((r, i) => `${e.verdicts?.[i] === "pass" ? C.good : C.bad}${r}: ${e.verdicts?.[i] ?? "no summary"}${C.x}`).join(" · ")}${took}`);
      } else if (e.what === "select") {
        line("✓", C.good, `${C.good}picked  ${C.x} ${C.text}${e.run}${C.x} ${C.dim}${e.failing?.length ? `${e.failing.length} proofs still failing` : "every proof passes"}${e.regression ? ", a regression" : ""}${C.x}`);
      } else {
        const ok = e.verdict === "pass";
        line(ok ? "✓" : "✗", ok ? C.good : C.bad, `${ok ? C.good : C.bad}${e.what.padEnd(8)}${C.x} ${ok ? C.text : C.bad + C.b}${e.verdict ?? "no summary"}${C.x} ${C.dim}${e.run}${e.model ? ` (${short(e.model)})` : ""}${C.x}${took}`);
      }
      break;
    }
    case "findings": {
      for (const f of e.items ?? []) {
        const [rc, rl] = ROUTE[f.route] ?? [C.dim, f.route];
        L.push(`           ${rc}${rl.padEnd(9)}${C.x}${sevc(f.severity)}${String(f.severity ?? "?").padEnd(9)}${C.x}${C.dim}${f.id.padEnd(10)}${C.x}${f.route === "dropped" || f.route === "note" ? C.dim : C.text}${one(f.issue, Math.max(30, cols - 60))}${C.x}${f.file ? ` ${C.faint}${f.file}${f.line ? `:${f.line}` : ""}${C.x}` : ""}`);
      }
      if (e.fixed?.length) L.push(`           ${C.good}✓ fixed   ${e.fixed.join(", ")}${C.x}`);
      if (e.broke?.length) L.push(`           ${C.bad}${C.b}✗ BROKEN AGAIN${C.x} ${C.bad}${e.broke.join(", ")}: fixed earlier, failing now${C.x}`);
      if (e.regression) L.push(`           ${C.bad}${C.b}✗ REGRESSION${C.x} ${C.bad}tests next to the change fail on the branch and pass on the base${C.x}`);
      L.push(e.open?.length
        ? `           ${C.warn}● open ${e.open.length}: ${e.open.map((o) => `${o.id}${o.survived ? ` (survived ${o.survived})` : ""}`).join(", ")}${C.x}`
        : `           ${C.good}● nothing open${C.x}`);
      break;
    }
    case "decide": {
      const c = { approve: C.good, escalate: C.violet, stop: C.warn, final: C.accent, fix: C.orange }[e.action] ?? C.accent;
      line("→", c + C.b, `${c}${C.b}${e.action === "stop" ? `stop: ${e.next}` : e.action}${C.x} ${C.dim}${one(e.reason, cols - 30)}${C.x}`);
      break;
    }
    case "end": {
      s.running = false; s.step = null;
      const ok = e.next === "approve", c = ok ? C.good : C.warn;
      const head = ok ? `APPROVED · agent/${e.last}` : `NEEDS YOU · ${e.next}`;
      L.push("", `${c}${C.b}━━ ${head} ${"━".repeat(Math.max(2, cols - head.length - 4))}${C.x}`,
        `   ${C.text}${one(e.reason, cols - 4)}${C.x}`, `   ${C.dim}next: ${hint(e.next, s.repo, s.name, e.last)}${C.x}`, "");
      break;
    }
    default:
  }
  return L;
}

// The herdr state for an event: [state, message] or null.
export function herdrState(e, s) {
  if (e.ev === "end") return e.next === "approve" ? ["idle", `approved: agent/${e.last}`] : ["blocked", `needs you: ${e.next}: ${one(e.reason, 150)}`];
  if (e.ev === "step") return ["working", `round ${s.k}: ${e.what} ${e.run ?? ""}`.trim()];
  if (e.ev === "start" || e.ev === "resume") return ["working", e.ev === "start" ? "starting" : "resumed"];
  return null;
}

const main = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main) {
  const [file, name = path.basename(path.dirname(file ?? "")), repo = ""] = process.argv.slice(2);
  if (!file) { console.error("usage: loopwatch.mjs <progress.jsonl> <loop> [repo]"); process.exit(2); }
  const herdr = process.env.HERDR_ENV === "1" && process.env.HERDR_PANE_ID && process.env.HERDR_BIN_PATH;
  const tty = process.stdout.isTTY || process.env.FORCE_COLOR === "1" || !!herdr;
  const C = palette(tty);
  const cols = () => Math.max(40, Math.min(process.stdout.columns || Number(process.env.AB_COLS) || 100, 160));
  const s = { running: false, started: false, k: 0, maxRounds: null, step: null, name, repo };
  let lastReport = "";
  const report = (r) => {
    if (!herdr || !r || r.join("") === lastReport) return;
    lastReport = r.join("");
    execFile(process.env.HERDR_BIN_PATH, ["pane", "report-agent", process.env.HERDR_PANE_ID, "--source", "agent-box", "--agent", name,
      "--state", r[0], "--message", r[1].slice(0, 200), "--seq", String(Date.now())], { timeout: 5000, windowsHide: true }, () => {});
  };
  // The bottom line: what runs now and for how long. Redrawn in place; cleared before every printed line.
  const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  let spin = 0, status = false;
  const clear = () => { if (status) { process.stdout.write("\r\x1b[2K"); status = false; } };
  const draw = () => {
    if (!tty || !s.running) return;
    clear();
    const now = s.step ? `${s.step.what} ${s.step.run ?? ""} · ${dur(Date.now() - s.step.t)}` : s.started ? "deciding" : "waiting for the loop to start";
    process.stdout.write(`${C.teal}${SPIN[spin++ % SPIN.length]}${C.x} ${C.dim}round ${s.k || "-"}/${s.maxRounds ?? "?"} ·${C.x} ${C.text}${now}${C.x}`);
    status = true;
  };
  const dec = new StringDecoder("utf8");
  let pos = 0, buf = "";
  const poll = () => {
    let fd;
    try {
      const size = fs.statSync(file).size;
      if (size < pos) pos = 0;
      if (size === pos) return;
      fd = fs.openSync(file, "r");
      const b = Buffer.alloc(size - pos);
      fs.readSync(fd, b, 0, b.length, pos);
      pos = size; buf += dec.write(b);
    } catch { return; } finally { if (fd !== undefined) fs.closeSync(fd); }
    const lines = buf.split("\n"); buf = lines.pop();
    for (const l of lines) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e.ev === "start" || e.ev === "resume") s.started = true;
      clear();
      for (const out of render(e, s, C, cols())) console.log(out);
      report(herdrState(e, s));
    }
  };
  poll();
  // A loop that already stopped: its history, then done.
  if (!(s.started && !s.running)) {
    draw();
    const tick = setInterval(() => {
      poll();
      if (s.started && !s.running) { clear(); clearInterval(tick); return; }
      draw();
    }, 1000);
  }
}
