// Live feed of one agent-box run: reads `tail -F` of the container's harness.log and events.jsonl on
// stdin and prints one readable line per harness step, tool call and message. Inside a herdr pane it
// also reports the worker's state (working / blocked on a question / idle when done) to herdr.
//
//   node lib/watch.mjs <run-name> <model> [role]     (stdin: tail -F output)
import { execFile } from "node:child_process";
import readline from "node:readline";

const [name = "run", model = "", role = ""] = process.argv.slice(2);
const herdr = process.env.HERDR_ENV === "1" && process.env.HERDR_PANE_ID && process.env.HERDR_BIN_PATH;
const short = model.replace(/^.*\//, "").replace(/-tiered$/, "");
const label = `${name}${short ? ` (${short})` : ""}`;

let last = "";
// herdr: fire and forget, newest wins (seq), failures ignored.
function report(state, message) {
  if (!herdr || state + message === last) return;
  last = state + message;
  const args = ["pane", "report-agent", process.env.HERDR_PANE_ID, "--source", "agent-box", "--agent", label,
    "--state", state, "--seq", String(Date.now())];
  if (message) args.push("--message", message.slice(0, 200));
  execFile(process.env.HERDR_BIN_PATH, args, { timeout: 5000, windowsHide: true }, () => {});
}

const tty = process.stdout.isTTY || process.env.FORCE_COLOR === "1" || !!herdr;
const rgb = (r, g, b) => (tty ? `\x1b[38;2;${r};${g};${b}m` : "");
const C = {
  x: tty ? "\x1b[0m" : "", b: tty ? "\x1b[1m" : "", dim: rgb(128, 136, 150), faint: rgb(76, 82, 94), text: rgb(220, 223, 228),
  accent: rgb(97, 175, 239), good: rgb(152, 195, 121), warn: rgb(229, 192, 123), bad: rgb(224, 108, 117),
  violet: rgb(198, 120, 221), teal: rgb(86, 182, 194), orange: rgb(209, 154, 102),
};
// Git Bash pipes hide the pane width from node; delegate.sh passes it as AB_COLS.
const cols = () => Math.max(40, Math.min(process.stdout.columns || Number(process.env.AB_COLS) || 100, 160));
const time = (ms) => new Date(ms || Date.now()).toTimeString().slice(0, 8);
const one = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const rel = (p) => String(p ?? "").replace(/^\/work\/repo\//, "");
const fmtK = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const tok = { input: 0, cache: 0, output: 0 };
let calls = 0, steps = 0;
const t0 = Date.now();

const ICON = { read: ["◇", C.dim], edit: ["✎", C.warn], write: ["✎", C.warn], apply_patch: ["✎", C.warn], bash: ["$", C.teal],
  grep: ["⌕", C.dim], glob: ["⌕", C.dim], list: ["⌕", C.dim], task: ["⇢", C.violet], skill: ["★", C.orange],
  todowrite: ["☐", C.dim], webfetch: ["⇣", C.orange], ask_orchestrator: ["?", C.violet], wait_for_answer: ["…", C.violet] };

const header = () => {
  const w = cols() - 2, title = ` ${name} `, sub = ` ${[short, role].filter(Boolean).join(" · ")} `;
  const fill = Math.max(1, w - title.length - sub.length - 4);
  console.log(`${C.faint}╭─${C.x}${C.accent}${C.b}${title}${C.x}${C.faint}${"─".repeat(fill)}${C.x}${C.dim}${sub}${C.x}${C.faint}─╮${C.x}`);
  console.log(`${C.faint}╰${"─".repeat(w)}╯${C.x}`);
};
const line = (ts, glyph, gcolor, what, rest = "") =>
  console.log(`${C.faint}${time(ts)}${C.x} ${gcolor}${glyph}${C.x} ${what}${rest}`);
const rule = (text, color = C.dim) => {
  const w = cols() - text.length - 4;
  console.log(`${C.faint}──${C.x} ${color}${text}${C.x} ${C.faint}${"─".repeat(Math.max(2, w))}${C.x}`);
};

function tool(e) {
  const p = e.part || {}, i = p.state?.input || {}, out = String(p.state?.output ?? "");
  const t = String(p.tool || "?").replace(/^orchestrator_/, "");
  calls++;
  let what;
  if (t === "read" || t === "write" || t === "edit") what = rel(i.filePath);
  else if (t === "bash") what = one(i.command, 140);
  else if (t === "grep") what = `${one(i.pattern, 60)}${i.path ? C.dim + "  in " + rel(i.path) + C.x : ""}`;
  else if (t === "glob") what = one(i.pattern, 80);
  else if (t === "skill") what = i.name;
  else if (t === "task") what = `${C.violet}${i.subagent_type || "subagent"}${C.x} ${one(i.description || i.prompt, 100)}`;
  else if (t === "ask_orchestrator") what = `${C.violet}${one(i.question, 200)}${C.x}`;
  else if (t === "wait_for_answer") what = `question ${i.id}`;
  else what = one(JSON.stringify(i), 100);
  const [g, gc] = ICON[t] ?? ["·", C.dim];
  const status = p.state?.status === "error" ? ` ${C.bad}✗ ${one(p.state?.error ?? "error", 80)}${C.x}` : "";
  const syntax = /\[agent-box syntax check\]/.test(out) ? ` ${C.bad}⚠ file no longer parses${C.x}` : "";
  line(e.timestamp, g, gc, `${C.dim}${t.padEnd(8)}${C.x} ${what}`, status + syntax);
  if (t === "ask_orchestrator" || t === "wait_for_answer") {
    if (/^Answer to question/m.test(out)) { console.log(`           ${C.violet}↳ ${one(out.split("\n").slice(2).join(" "), 200)}${C.x}`); report("working", ""); }
    else if (/will come/.test(out)) report("working", "");
  } else report("working", "");
}

function event(e) {
  const p = e.part || {};
  if (e.type === "step_start") { steps++; return; }
  if (e.type === "tool_use") return tool(e);
  if (e.type === "text" && p.text) {
    const blocked = p.text.match(/^\s*BLOCKED:\s*(.+)$/m);
    const body = p.text.replace(/```agent-box-(report|findings)[\s\S]*?```/g, "").trim();
    line(e.timestamp, "▍", C.accent, `${C.text}${one(body, 300)}${C.x}`);
    if (blocked) { console.log(`           ${C.warn}${C.b}BLOCKED${C.x} ${C.warn}${one(blocked[1], 200)}${C.x}`); report("blocked", `BLOCKED: ${one(blocked[1], 180)}`); }
    return;
  }
  if (e.type === "step_finish" && p.tokens) {
    tok.input += p.tokens.input || 0; tok.output += (p.tokens.output || 0) + (p.tokens.reasoning || 0);
    tok.cache += p.tokens.cache?.read || 0;
    return;
  }
  if (e.type === "error") line(e.timestamp, "✗", C.bad, `${C.bad}${one(JSON.stringify(e.error || e), 200)}${C.x}`);
}

function harness(ts, msg) {
  // Phase starts become section rules; everything else is one line.
  if (/^(setup|red check|agent|test): /.test(msg) || /^autofix \d+: resuming/.test(msg)) {
    rule(msg.replace(/^([\w ]+?\d*): /, "$1 · ").slice(0, cols() - 8), /^autofix/.test(msg) ? C.orange : /^red/.test(msg) ? C.violet : C.accent);
    report("working", msg.slice(0, 60));
    return;
  }
  let q;
  if ((q = msg.match(/^question (\d+): (.*)$/))) {
    line(ts, "?", C.violet, `${C.violet}${C.b}question ${q[1]}${C.x} ${C.violet}${one(q[2], 200)}${C.x}`);
    console.log(`           ${C.dim}answer: delegate.sh answer <repo> ${name} ${q[1]} -m "..."${C.x}`);
    report("blocked", `asks: ${one(q[2], 180)}`);
    return;
  }
  if (/^answer \d+ received/.test(msg)) { line(ts, "↳", C.violet, `${C.violet}${msg}${C.x}`); report("working", ""); return; }
  const color = /exit [1-9]|failed|FAIL|WEAK-SPEC|unreachable|reverted/.test(msg) ? C.bad : /exit 0\b/.test(msg) ? C.good : C.dim;
  line(ts, "▪", C.faint, `${color}${msg}${C.x}`);
  if (/^(setup|test|red check|autofix)/.test(msg)) report("working", msg.slice(0, 60));
}

header();
report("working", "starting");
const rl = readline.createInterface({ input: process.stdin });
// delegate.sh reattaches the feed from the top of each file (a parked container, a late start): lines
// already shown are skipped. Harness lines carry a time and events an id, so a repeat is a replay.
const seen = new Set();
rl.on("line", (l) => {
  if (!l || l.startsWith("==> ")) return; // tail -F file headers
  if (seen.has(l)) return;
  if (seen.size > 100000) seen.clear();
  seen.add(l);
  if (l[0] === "{") { try { return event(JSON.parse(l)); } catch { /* fall through */ } }
  const m = l.match(/^\[run-task (\S+)\] (.*)$/);
  if (m) {
    // The container logs in UTC; show local time like the events.
    const [h, mi, s] = m[1].split(":").map(Number), d = new Date();
    d.setUTCHours(h, mi, s, 0);
    return harness(Number.isNaN(d.getTime()) ? Date.now() : d.getTime(), m[2]);
  }
  if (/tail: /.test(l)) return; // tail -F notices about files that appear later
  console.log(l);
});
rl.on("close", () => {
  const hit = tok.input + tok.cache ? Math.round((tok.cache / (tok.input + tok.cache)) * 100) : 0;
  rule(`${steps} steps · ${calls} tool calls · in ${fmtK(tok.input)} + cached ${fmtK(tok.cache)} (${hit}%) · out ${fmtK(tok.output)} · ${Math.round((Date.now() - t0) / 1000)}s watched`);
});
