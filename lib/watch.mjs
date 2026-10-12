// Live feed of one agent-box run: reads `tail -F` of the container's harness.log and events.jsonl on
// stdin and prints one readable line per harness step, tool call and message. Inside a herdr pane it
// also reports the worker's state (working / blocked on a question / idle when done) to herdr.
//
//   node lib/watch.mjs <run-name> <model>     (stdin: tail -F output)
import { execFile } from "node:child_process";
import readline from "node:readline";

const [name = "run", model = ""] = process.argv.slice(2);
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

const C = process.stdout.isTTY ? { dim: "\x1b[2m", b: "\x1b[1m", y: "\x1b[33m", c: "\x1b[36m", g: "\x1b[32m", r: "\x1b[31m", m: "\x1b[35m", x: "\x1b[0m" }
  : { dim: "", b: "", y: "", c: "", g: "", r: "", m: "", x: "" };
const time = (ms) => new Date(ms || Date.now()).toTimeString().slice(0, 8);
const one = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const rel = (p) => String(p ?? "").replace(/^\/work\/repo\//, "");
const tok = { input: 0, cache: 0, output: 0 };
let calls = 0;

function tool(e) {
  const p = e.part || {}, i = p.state?.input || {}, out = String(p.state?.output ?? "");
  const t = p.tool || "?";
  calls++;
  let what;
  if (t === "read" || t === "write" || t === "edit") what = rel(i.filePath);
  else if (t === "bash") what = one(i.command, 140);
  else if (t === "grep") what = `${one(i.pattern, 60)}${i.path ? "  in " + rel(i.path) : ""}`;
  else if (t === "glob") what = one(i.pattern, 80);
  else if (t === "skill") what = i.name;
  else if (t === "task") what = `${i.subagent_type || "subagent"}: ${one(i.description || i.prompt, 100)}`;
  else if (t.endsWith("ask_orchestrator")) what = one(i.question, 200);
  else if (t.endsWith("wait_for_answer")) what = `question ${i.id}`;
  else what = one(JSON.stringify(i), 100);
  const color = t === "edit" || t === "write" ? C.y : t === "bash" ? C.c : t.includes("orchestrator") || t.includes("wait_for") ? C.m : "";
  const status = p.state?.status === "error" ? ` ${C.r}(error)${C.x}` : "";
  console.log(`${C.dim}${time(e.timestamp)}${C.x}  ${color}${t.replace(/^orchestrator_/, "").padEnd(8)}${C.x}  ${what}${status}`);
  if (t.endsWith("ask_orchestrator") || t.endsWith("wait_for_answer")) {
    if (/^Answer to question/m.test(out)) { console.log(`${C.m}          answer: ${one(out.split("\n").slice(2).join(" "), 200)}${C.x}`); report("working", ""); }
    else if (/No answer to question \d+ yet/.test(out)) report("blocked", `asks: ${one(i.question || "waiting for an answer", 180)}`);
    else if (/will come/.test(out)) report("working", "");
  } else report("working", "");
}

function event(e) {
  const p = e.part || {};
  if (e.type === "tool_use") return tool(e);
  if (e.type === "text" && p.text) {
    const blocked = p.text.match(/^\s*BLOCKED:\s*(.+)$/m);
    console.log(`${C.dim}${time(e.timestamp)}${C.x}  ${C.b}says${C.x}     ${one(p.text, 300)}`);
    if (blocked) report("blocked", `BLOCKED: ${one(blocked[1], 180)}`);
    return;
  }
  if (e.type === "step_finish" && p.tokens) {
    tok.input += p.tokens.input || 0; tok.output += (p.tokens.output || 0) + (p.tokens.reasoning || 0);
    tok.cache += p.tokens.cache?.read || 0;
    return;
  }
  if (e.type === "error") console.log(`${C.r}${time(e.timestamp)}  error    ${one(JSON.stringify(e.error || e), 200)}${C.x}`);
}

report("working", "starting");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line || line.startsWith("==> ")) return; // tail -F file headers
  if (line[0] === "{") { try { return event(JSON.parse(line)); } catch { /* fall through */ } }
  const m = line.match(/^\[run-task (\S+)\] (.*)$/);
  if (m) {
    // The container logs in UTC; show local time like the events.
    const [h, mi, s] = m[1].split(":").map(Number), d = new Date();
    d.setUTCHours(h, mi, s, 0);
    console.log(`${C.dim}${Number.isNaN(d.getTime()) ? m[1] : time(d.getTime())}${C.x}  ${C.g}harness${C.x}  ${m[2]}`);
    if (/^(setup|test):/.test(m[2])) report("working", m[2].slice(0, 60));
    return;
  }
  if (/tail: /.test(line)) return; // tail -F notices about files that appear later
  console.log(line);
});
rl.on("close", () => {
  console.log(`${C.dim}${calls} tool calls, tokens in ${tok.input} + cached ${tok.cache}, out ${tok.output}${C.x}`);
});
