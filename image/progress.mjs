// Keeps /out/progress.json current while a run executes, for `delegate.sh stats live` and the TUI.
// Reads /out/phase (written by run-task.sh) and the new lines of /out/events.jsonl once a second.
// One small process for the whole run; it exits when /out/phase says "done".
import fs from "node:fs";

const OUT = "/out";
const started = Date.now();
const p = {
  phase: "setup", started, model: process.env.MODEL || "", role: process.env.ROLE || "",
  steps: 0, tools: 0, last: null, tokens: { input: 0, output: 0, cache_read: 0 },
  questions_open: 0, blocked: false, autofix: 0,
};
let offset = 0, rest = "";

const rel = (s) => String(s ?? "").replace(/^\/work\/repo\//, "");
function what(tool, i = {}) {
  if (i.filePath) return rel(i.filePath);
  if (tool === "bash") return String(i.command ?? "").replace(/\s+/g, " ").slice(0, 120);
  if (i.pattern) return String(i.pattern).slice(0, 80);
  if (tool === "task") return `${i.subagent_type || "subagent"}: ${String(i.description ?? "").slice(0, 80)}`;
  if (i.question) return String(i.question).slice(0, 120);
  return "";
}

function read() {
  let fd;
  try { fd = fs.openSync(`${OUT}/events.jsonl`, "r"); } catch { return; }
  try {
    const size = fs.fstatSync(fd).size;
    if (size < offset) { offset = 0; rest = ""; }   // a new agent round rewrote the file
    if (size === offset) return;
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    offset = size;
    const lines = (rest + buf.toString("utf8")).split("\n");
    rest = lines.pop();
    for (const l of lines) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      const part = e.part || {};
      if (e.type === "step_start") p.steps++;
      else if (e.type === "tool_use") {
        p.tools++;
        p.last = { tool: String(part.tool || "?").replace(/^orchestrator_/, ""), what: what(part.tool, part.state?.input), ts: e.timestamp || Date.now() };
      } else if (e.type === "step_finish" && part.tokens) {
        p.tokens.input += part.tokens.input || 0;
        p.tokens.output += (part.tokens.output || 0) + (part.tokens.reasoning || 0);
        p.tokens.cache_read += part.tokens.cache?.read || 0;
      } else if (e.type === "text" && part.text) p.blocked = /^\s*BLOCKED:/m.test(part.text);
    }
  } finally { fs.closeSync(fd); }
}

function questionsOpen() {
  let n = 0;
  try {
    for (const f of fs.readdirSync(`${OUT}/questions`)) {
      const m = f.match(/^(\d+)\.md$/);
      if (m && !fs.existsSync(`/in/answers/${m[1]}.md`) && !fs.existsSync(`${OUT}/questions/${m[1]}.timeout`)) n++;
    }
  } catch { /* no questions yet */ }
  return n;
}

function tick() {
  try {
    const [phase, autofix] = fs.readFileSync(`${OUT}/phase`, "utf8").trim().split(/\s+/);
    if (phase) p.phase = phase;
    p.autofix = Number(autofix) || 0;
  } catch { /* setup has not written it yet */ }
  read();
  p.questions_open = questionsOpen();
  try {
    fs.writeFileSync(`${OUT}/.progress.tmp`, JSON.stringify(p));
    fs.renameSync(`${OUT}/.progress.tmp`, `${OUT}/progress.json`);
  } catch { /* /out is gone: the run is over */ }
  if (p.phase === "done") process.exit(0);
}

tick();
setInterval(tick, 1000);
