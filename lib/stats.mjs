// Dashboard over the agent-box ledger (docs/ledger.md): static views, `json <view>` for agents, and an
// interactive TUI. Reads only; lib/ledger.mjs writes.
//
//   node lib/stats.mjs [view] [args] [--since 24h|7d|30d|4w|all] [--project P] [--model M] [--role R]
//                      [--harness H] [--color auto|always|never|256|true] [--width N] [--ledger PATH]
//   views: overview models runs run <name|id> flags [FLAG] causes [cause] notes [cause] reviews bench
//          compare [a] [b] unlabeled live    ·    tui    ·    json <view> [args]
// STATS_NOW (epoch s) fixes the clock; STATS_LIVE_FIXTURE replaces the engine probe;
// STATS_TUI_HEADLESS=1 runs the TUI on piped stdin/stdout.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLedger, ledgerStamp, scope } from "./stats/data.mjs";
import { setUi, ui, S, cat, render, clip, segw, rep, shortModel } from "./stats/style.mjs";
import { VIEWS, build, draw, scopeModel, scopeText } from "./stats/views.mjs";
import { probe } from "./stats/live.mjs";

const BOX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const die = (m) => { process.stderr.write(`stats: ${m}\n`); process.exit(2); };

function parseArgs(argv) {
  const o = { since: "30d", project: "", model: "", role: "", harness: "", color: "auto", width: null, ledger: null, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = a.match(/^--(since|project|model|role|harness|color|width|ledger)(?:=(.*))?$/);
    if (m) {
      const v = m[2] ?? argv[++i];
      if (v == null) die(`${a} needs a value`);
      o[m[1]] = v;
    } else if (a === "-h" || a === "--help") o.help = true;
    else o._.push(a);
  }
  return o;
}
function sinceSecs(s) {
  const m = String(s).match(/^(\d+)([hdw])$/);
  if (s === "all" || s === "0") return 0;
  if (!m) die("--since takes 24h, 7d, 30d, 4w or all");
  return Number(m[1]) * { h: 3600, d: 86400, w: 604800 }[m[2]];
}
function colorDepth(mode, tty) {
  if (mode === "never") return "none";
  if (mode === "256" || mode === "true") return mode;
  if (mode === "auto" && (process.env.NO_COLOR || !tty)) return "none";
  if (mode !== "auto" && mode !== "always") die("--color takes auto, always, never, 256 or true");
  const e = process.env;
  return /truecolor|24bit/i.test(e.COLORTERM ?? "") || e.WT_SESSION || /mintty|vscode|herdr/i.test(e.TERM_PROGRAM ?? "") ? "true" : "256";
}
const now = () => (process.env.STATS_NOW ? Number(process.env.STATS_NOW) : Date.now() / 1000);

const o = parseArgs(process.argv.slice(2));
if (o.help) {
  const src = (await import("node:fs")).readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  process.stdout.write(src.slice(0, src.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n");
  process.exit(0);
}
const LEDGER = o.ledger || process.env.AGENT_BOX_LEDGER || path.join(BOX, "ledger", "events.jsonl");
const filters = { project: o.project, model: o.model, role: o.role, harness: o.harness };

// view name + args from the command line → {view, arg}
function route(args) {
  const [v = "overview", ...rest] = args;
  switch (v) {
    case "overview": case "models": case "reviews": case "bench": case "unlabeled": case "live": return { view: v };
    case "runs": return { view: "runs", arg: rest[0] ? { flag: rest[0] } : {} };
    case "run": if (!rest[0]) die("usage: run <run name | project/run | event id>"); return { view: "run", arg: rest[0] };
    case "flags": return rest[0] ? { view: "runs", arg: { flag: rest[0] } } : { view: "flags" };
    case "causes": return rest[0] ? { view: "notes", arg: rest[0] } : { view: "causes" };
    case "notes": return { view: "notes", arg: rest[0] ?? "" };
    case "compare": return { view: "compare", arg: [rest[0] ?? "", rest[1] ?? ""] };
    default: return die(`unknown view '${v}' (node lib/stats.mjs --help)`);
  }
}

let cache = { stamp: null, events: [] };
function events() {
  const st = ledgerStamp(LEDGER);
  if (st !== cache.stamp) cache = { stamp: st, events: readLedger(LEDGER) };
  return cache.events;
}
const dataFor = (since) => scope(events(), { ...filters, since }, now());

// ─── static ──────────────────────────────────────────────────────────────────────────
async function staticView(args, json) {
  const tty = process.stdout.isTTY;
  const width = Number(o.width) || (tty ? process.stdout.columns : 0) || Number(process.env.COLUMNS) || 100;
  setUi({ color: json ? "none" : colorDepth(o.color, tty), width });
  const { view, arg } = route(args);
  const D = dataFor(sinceSecs(o.since));
  const live = view === "live" ? await probe() : null;
  const model = build(view, D, arg, live);
  if (json) { process.stdout.write(JSON.stringify(model, null, 2) + "\n"); return; }
  const { lines } = draw(view, model, -1, Math.floor(now() * 4));
  process.stdout.write(lines.map(render).join("\n") + "\n\n");
}

// ─── interactive ─────────────────────────────────────────────────────────────────────
const TABS = ["overview", "models", "runs", "flags", "causes", "reviews", "bench", "compare", "live"];
const WINDOWS = ["24h", "7d", "30d", "all"];
const parent = (v) => ({ run: "runs", notes: "causes", unlabeled: "overview" })[v] ?? v;

async function tui() {
  const headless = process.env.STATS_TUI_HEADLESS === "1";
  const { stdin, stdout } = process;
  if (!headless && !(stdin.isTTY && stdout.isTTY)) die("tui needs an interactive terminal");
  const color = o.color === "auto" ? (process.env.NO_COLOR ? "none" : colorDepth("always", true)) : colorDepth(o.color, true);
  const st = { tab: 0, view: "overview", arg: undefined, sel: 0, off: 0, wi: Math.max(WINDOWS.indexOf(o.since), 0), stack: [] };
  if (!WINDOWS.includes(o.since)) { WINDOWS.push(o.since); st.wi = WINDOWS.length - 1; }
  let live = { workers: [], error: null }, probing = false, lastKeys = [], lastH = 20, frame = 0, done = false;

  const size = () => headless
    ? { rows: Number(process.env.LINES) || 40, cols: Number(o.width) || Number(process.env.COLUMNS) || 110 }
    : { rows: stdout.rows || 40, cols: Number(o.width) || stdout.columns || 120 };

  // Widest form that fits: brand + named tabs, then a short brand, then numbers with the current name.
  function tabBar(cols) {
    const cur = TABS.indexOf(parent(st.view));
    const on = (i, t) => (ui.color === "none" ? S("", `[${i + 1} ${t}]`) : S("bg:tab+accent+b", ` ${i + 1} ${t} `));
    const named = cat(...TABS.map((t, i) => (i === cur ? on(i, t) : cat(S("dim", ` ${i + 1} `), S("text", t), " "))));
    const numbers = cat(...TABS.map((t, i) => (i === cur ? on(i, t) : S("dim", ` ${i + 1} `))));
    for (const top of [cat(S("accent+b", " ◢◤ agent-box "), named), cat(S("accent+b", " ◢◤ "), named), cat(S("accent+b", " ◢◤ agent-box "), numbers)])
      if (segw(top) <= cols) return top;
    return clip(cat(S("accent+b", " ◢◤ "), numbers), cols);
  }
  const label = (v, a) => (v === "runs" && a && typeof a === "object"
    ? ["runs", a.flag, "role" in a && (a.role ?? "--model"), "model" in a && shortModel(a.model)].filter(Boolean).join(" ")
    : typeof a === "string" && a ? `${v} ${a.length > 20 ? a.slice(0, 19) + "…" : a}` : v);
  // Key hints fill what the right side (scroll position, breadcrumb) leaves.
  const hintSegs = (hs) => cat(" ", ...hs.flatMap(([k, v], n) => [n ? S("faint", " · ") : [], S("accent+b", k), " ", S("dim", v)]));
  function statusBar(cols, right) {
    const hints = [["q", "quit"], ["1-9", "tab"], ["↑↓", "select"], ["⏎", "open"], ["esc", "back"], ["f", "window"], ["←→", "switch"], ["u", "unlabeled"], ["r", "refresh"]];
    const room = cols - segw(right) - 2;
    const keep = [];
    for (const h of hints) {
      const next = [...keep, h];
      if (segw(hintSegs(next)) > room) break;
      keep.push(h);
    }
    const order = hints.filter((h) => keep.includes(h));
    const left = hintSegs(order.slice(1).concat(order.slice(0, 1)));
    const gap = cols - segw(left) - segw(right);
    return gap >= 1 ? cat(left, rep(" ", gap), right) : clip(cat(left, " ", right), cols);
  }

  function paint() {
    const { rows, cols } = size();
    setUi({ color, width: cols });
    const D = dataFor(sinceSecs(WINDOWS[st.wi]));
    const model = build(st.view, D, st.arg, live);
    const { keys, lines } = draw(st.view, model, st.sel, frame);
    lastKeys = keys;
    if (keys.length && st.sel >= keys.length) { st.sel = keys.length - 1; return paint(); }
    const H = Math.max(rows - 3, 3);
    lastH = H;
    const selLine = lines.findIndex((l) => l.sel);
    if (selLine >= 0 && selLine < st.off + 2) st.off = selLine - 2;
    if (selLine >= 0 && selLine >= st.off + H - 1) st.off = selLine - H + 2;
    st.off = Math.max(Math.min(st.off, lines.length - H), 0);

    const top = tabBar(cols);
    const scopeR = S("dim", scopeText(scopeModel(D)) + " ");
    const gap = cols - segw(top) - segw(scopeR);
    const head = gap >= 2 ? cat(top, rep(" ", gap), scopeR) : top;
    const pos = lines.length > H ? S("dim", `${st.off + 1}-${Math.min(st.off + H, lines.length)}/${lines.length}  `) : [];
    const trail = [...st.stack.map((x) => x.label ?? label(x.view, x.arg)), st.label ?? label(st.view, st.arg)];
    const crumb = st.stack.length ? cat(S("faint", trail.slice(0, -1).join(" › ") + " › "), S("text", trail.at(-1)), " ") : [];
    let f = "\x1b[H" + render(clip(head, cols)) + "\x1b[K\n\x1b[K\n";
    for (let i = st.off; i < st.off + H; i++) f += (lines[i] ? render(lines[i]) : "") + "\x1b[K\n";
    f += render(statusBar(cols, cat(pos, crumb))) + "\x1b[K\x1b[J";
    stdout.write(f);
  }

  function go(view, arg, push = true, name = undefined) {
    if (push) st.stack.push({ view: st.view, arg: st.arg, label: st.label, sel: st.sel, off: st.off });
    Object.assign(st, { view, arg, label: name, sel: 0, off: 0 });
  }
  function tab(i) {
    st.tab = (i + TABS.length) % TABS.length;
    st.stack = [];
    go(TABS[st.tab], undefined, false);
    if (TABS[st.tab] === "live") refreshLive();
  }
  function key(k) {
    const n = lastKeys.length, page = Math.max(lastH - 2, 1);
    if (k === "q" || k === "Q" || k === "\x03") return quit();
    if (/^[1-9]$/.test(k)) tab(Number(k) - 1);
    else if (k === "\x1b[C" || k === "\x1bOC" || k === "l" || k === "\t") tab(TABS.indexOf(parent(st.view)) + 1);
    else if (k === "\x1b[D" || k === "\x1bOD" || k === "h" || k === "\x1b[Z") tab(TABS.indexOf(parent(st.view)) - 1);
    else if (k === "\x1b[A" || k === "\x1bOA" || k === "k") { if (n) st.sel = Math.max(st.sel - 1, 0); else st.off--; }
    else if (k === "\x1b[B" || k === "\x1bOB" || k === "j") { if (n) st.sel = Math.min(st.sel + 1, n - 1); else st.off++; }
    else if (k === "\x1b[5~") { if (n) st.sel = Math.max(st.sel - page, 0); else st.off -= page; }
    else if (k === "\x1b[6~" || k === " ") { if (n) st.sel = Math.min(st.sel + page, n - 1); else st.off += page; }
    else if (k === "g" || k === "\x1b[H" || k === "\x1b[1~") { st.sel = 0; st.off = 0; }
    else if (k === "G" || k === "\x1b[F" || k === "\x1b[4~") { if (n) st.sel = n - 1; else st.off = 1e9; }
    else if (k === "f") { st.wi = (st.wi + 1) % WINDOWS.length; st.sel = 0; st.off = 0; }
    else if (k === "u") go("unlabeled");
    else if (k === "r") cache.stamp = null;
    else if (k === "\r" || k === "\n") { const t = lastKeys[st.sel]; if (t) go(t.view, t.arg, true, t.view === "run" ? `run ${t.label}` : undefined); }
    else if (k === "\x1b" || k === "\x7f" || k === "\b") { const p = st.stack.pop(); if (p) Object.assign(st, p); }
    else return;
    paint();
  }
  // One chunk can hold several keys (pastes, headless input): split into escape sequences and chars.
  function onData(buf) {
    const s = buf.toString("utf8");
    const re = /\x1b\[[0-9;]*[~A-Za-z]|\x1bO[A-Za-z]|\r\n|[\s\S]/gu;
    for (const m of s.matchAll(re)) { if (done) return; key(m[0] === "\r\n" ? "\r" : m[0]); }
  }

  async function refreshLive() {
    if (probing) return;
    probing = true;
    try { live = await probe(); } finally { probing = false; }
    if (!done && st.view === "live") paint();
  }
  const timers = [
    setInterval(() => { if (st.view !== "live" && ledgerStamp(LEDGER) !== cache.stamp) paint(); }, 5000),
    setInterval(() => { if (st.view === "live") refreshLive(); }, 2000),
    setInterval(() => { if (st.view === "live" && live.workers.length) { frame++; paint(); } }, 250),
  ];
  if (headless) for (const t of timers) t.unref();

  function restore(cb) { if (!headless && stdin.isTTY) stdin.setRawMode(false); stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l", cb); }
  function quit() {
    if (done) return;
    done = true;
    for (const t of timers) clearInterval(t);
    stdin.pause();
    restore(() => process.exit(0));
  }
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  process.on("uncaughtException", (e) => { restore(); process.stderr.write(String(e?.stack ?? e) + "\n"); process.exit(1); });

  stdout.write("\x1b[?1049h\x1b[?25l");
  if (!headless) { stdin.setRawMode(true); stdout.on("resize", paint); }
  stdin.on("data", onData);
  stdin.on("end", quit);
  stdin.resume();
  paint();
}

const [cmd] = o._;
if (cmd === "tui") await tui();
else if (cmd === "json") { if (!o._[1]) die("usage: json <view> [args]"); await staticView(o._.slice(1), true); }
else await staticView(o._, false);
