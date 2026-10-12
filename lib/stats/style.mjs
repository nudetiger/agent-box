// Terminal styling for the stats views. A line is a list of segments, [style, text] pairs, so its
// width is known before color is applied; color is added only when a line is printed.

export const ui = { color: "none", W: 100, WW: 100 };
export function setUi({ color, width }) {
  ui.color = color;
  ui.W = Math.max(width, 40);
  ui.WW = Math.min(ui.W, 140);
}
export const wide = () => ui.WW >= 100;

// one-dark, with xterm-256 fallbacks
const PAL = {
  accent: [97, 175, 239, 75], text: [220, 223, 228, 253], dim: [128, 136, 150, 245],
  faint: [75, 82, 99, 239], good: [152, 195, 121, 114], warn: [229, 192, 123, 179],
  bad: [224, 108, 117, 168], violet: [198, 120, 221, 176], teal: [86, 182, 194, 73],
  orange: [209, 154, 102, 173], hl: [44, 50, 62, 236], tab: [56, 63, 77, 237],
};

const sgrCache = new Map();
function sgr(spec) {
  const key = ui.color + spec;
  if (sgrCache.has(key)) return sgrCache.get(key);
  const codes = [];
  for (const p of spec.split("+")) {
    if (p === "b") codes.push("1");
    else if (p === "i") codes.push("3");
    else if (p === "u") codes.push("4");
    else {
      const bg = p.startsWith("bg:");
      const c = PAL[bg ? p.slice(3) : p];
      if (!c) continue;
      codes.push(ui.color === "true" ? `${bg ? 48 : 38};2;${c[0]};${c[1]};${c[2]}` : `${bg ? 48 : 38};5;${c[3]}`);
    }
  }
  const s = codes.length ? `\x1b[${codes.join(";")}m` : "";
  sgrCache.set(key, s);
  return s;
}
export const paint = (style, s) => {
  if (ui.color === "none" || !style || !s) return s;
  const c = sgr(style);
  return c ? c + s + "\x1b[0m" : s;
};

// ─── width ───────────────────────────────────────────────────────────────────────────
function cw(cp) {
  if (cp < 0x300) return 1;
  if ((cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0f || (cp >= 0x1ab0 && cp <= 0x1aff)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || cp >= 0x20000) return 2;
  return 1;
}
export function strw(s) {
  let n = 0;
  for (const ch of s) n += cw(ch.codePointAt(0));
  return n;
}
// Ledger text is untrusted: no control bytes reach the terminal.
const clean = (t) => String(t ?? "").replace(/[\r\n\t]+/g, " ").replace(/[\x00-\x1f\x7f-\x9f]/g, "");

// ─── segments ────────────────────────────────────────────────────────────────────────
export const S = (style, t) => [[style, clean(t)]];
export const T = (t) => [["", clean(t)]];
export const segw = (segs) => segs.reduce((n, s) => n + strw(s[1]), 0);
export const cat = (...parts) => parts.flatMap((p) => (p == null ? [] : typeof p === "string" ? T(p) : p));
export const rep = (s, n) => (n > 0 ? s.repeat(Math.floor(n)) : "");
export const restyle = (segs, f) => segs.map(([st, t]) => [f(st), t]);

export function clip(segs, w) {
  if (w <= 0) return [];
  if (segw(segs) <= w) return segs;
  const out = [];
  let n = 0;
  for (const [st, t] of segs) {
    let s = "";
    for (const ch of t) {
      const c = cw(ch.codePointAt(0));
      if (n + c > w - 1) { out.push([st, s + "…"]); return out; }
      s += ch;
      n += c;
    }
    out.push([st, s]);
  }
  return out;
}
export const padr = (segs, w) => { const x = segw(segs); return x >= w ? segs : [...segs, ["", " ".repeat(w - x)]]; };
export const padl = (segs, w) => { const x = segw(segs); return x >= w ? segs : [["", " ".repeat(w - x)], ...segs]; };
export const center = (segs, w) => padr(padl(segs, segw(segs) + Math.floor((w - segw(segs)) / 2)), w);
export const render = (segs) => segs.map(([st, t]) => paint(st, t)).join("");

// ─── format ──────────────────────────────────────────────────────────────────────────
export const DASH = "–";
const two = (n) => String(n).padStart(2, "0");
export function fdur(s) {
  if (s == null || !Number.isFinite(s)) return DASH;
  s = Math.floor(s);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${two(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${two(Math.floor((s % 3600) / 60))}m`;
  return `${Math.floor(s / 86400)}d${two(Math.floor((s % 86400) / 3600))}h`;
}
export function fnum(n) {
  if (n == null || !Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  if (a >= 1e9) return `${Math.round(n / 1e8) / 10}G`;
  if (a >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
  if (a >= 1e5) return `${Math.round(n / 1e3)}k`;
  if (a >= 1e3) return `${Math.round(n / 100) / 10}k`;
  return String(a >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
}
export const fpct = (r) => (r == null || !Number.isFinite(r) ? DASH : `${Math.round(r * 100)}%`);
export const fdec = (n, d = 1) => (n == null || !Number.isFinite(n) ? DASH : String(Math.round(n * 10 ** d) / 10 ** d));
export const fcost = (c) => (c == null ? DASH : c >= 100 ? `$${Math.round(c)}` : `$${c.toFixed(2)}`);
export function ftime(t) {
  if (!t) return DASH;
  const d = new Date(t * 1000);
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
export function fago(s) {
  if (s == null || !Number.isFinite(s)) return DASH;
  return s < 1 ? "now" : `${fdur(s)} ago`;
}
// "antigravity/claude-sonnet-4-6" → "claude-sonnet-4-6"; "gemini-3.8-flash-tiered" → "gemini-3.8-flash"
export const shortModel = (m) => (m == null ? DASH : String(m).replace(/^.*\//, "").replace(/-tiered$/, ""));

// ─── widgets ─────────────────────────────────────────────────────────────────────────
export const grade = (r, good, ok) => (r == null ? "dim" : r >= good ? "good" : r >= ok ? "warn" : "bad");
export const gradeLow = (r, good, ok) => (r == null ? "dim" : r <= good ? "good" : r <= ok ? "warn" : "bad");

const PARTIAL = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
export function bar(v, max, w, style) {
  const x = max > 0 && v > 0 ? Math.min(v / max, 1) * w : 0;
  const f = Math.floor(x);
  let p = Math.floor((x - f) * 8);
  if (v > 0 && f === 0 && p === 0) p = 1;
  if (f >= w) p = 0;
  return [[style, rep("█", f) + PARTIAL[p]], ["faint", rep("─", w - f - (p > 0 ? 1 : 0))]];
}

const TICKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
export function spark(vals, style) {
  const m = Math.max(0, ...vals);
  return vals.map((v) => (v <= 0 || m === 0 ? ["faint", "▁"] : [style, TICKS[Math.min(Math.ceil((v / m) * 7), 7)]]));
}

// Change vs the previous window: points for rates, percent for amounts. Green when it is good.
export function delta(cur, prev, upIsGood, kind) {
  if (cur == null || prev == null) return [];
  const d = kind === "pt" ? (cur - prev) * 100 : prev === 0 ? null : ((cur - prev) / prev) * 100;
  if (d == null) return [];
  if (Math.abs(d) < 1) return S("dim", " ±0");
  return S((d > 0) === upIsGood ? "good" : "bad", ` ${d > 0 ? "▲" : "▼"}${Math.round(Math.abs(d))}${kind === "pt" ? "pt" : "%"}`);
}

// cols: {h, w | flex, max, a: l|r|c, drop, min + shrink}. Until the table fits, the highest of
// `drop` (remove the column) and `shrink` (narrow it to `min`) goes first.
// A cell is segments, a string/number, null (–), or {bar, max, style, suffix}.
export function table(cols0, rows0, sel = -1, empty = "nothing recorded in this window") {
  const need = (c) => c.reduce((n, x) => n + (x.w ?? x.flex), 0) + 3 * c.length + 2;
  let keep = cols0.map((c, i) => ({ ...c, i }));
  while (need(keep) > ui.WW) {
    const opts = [...keep.filter((c) => c.drop != null).map((c) => ({ c, p: c.drop, cut: true })),
      ...keep.filter((c) => c.shrink != null && c.w > c.min).map((c) => ({ c, p: c.shrink, cut: false }))];
    const d = opts.sort((a, b) => b.p - a.p)[0];
    if (!d) break;
    if (d.cut) keep = keep.filter((c) => c !== d.c);
    else d.c.w = Math.max(d.c.min, d.c.w - (need(keep) - ui.WW));
  }
  const fixed = keep.reduce((n, c) => n + (c.w ?? 0), 0);
  const flexes = keep.filter((c) => c.w == null);
  const flexMin = flexes.reduce((n, c) => n + c.flex, 0);
  let rest = Math.max(ui.WW - 2 - 3 * keep.length - fixed, flexMin);
  const cols = keep.map((c) => {
    if (c.w != null) return c;
    const w = Math.min(Math.floor((rest * c.flex) / flexMin), c.max ?? Infinity);
    return { ...c, w };
  });
  // hand rounding leftovers to the first flex column
  const used = cols.reduce((n, c) => n + c.w, 0) - fixed;
  const ff = cols.find((c) => c.flex != null && cols0[c.i].w == null && c.max == null);
  if (ff) ff.w += Math.max(rest - used, 0);
  const ws = cols.map((c) => c.w);
  const hline = (l, m, r) => [["", " "], ["faint", l + ws.map((w) => rep("─", w + 2)).join(m) + r]];
  const cell = (v, c) => {
    let segs;
    if (v && typeof v === "object" && !Array.isArray(v) && "bar" in v) {
      const sx = v.suffix ?? [];
      segs = [...bar(v.bar, v.max, c.w - segw(sx), v.style), ...sx];
    } else if (Array.isArray(v)) segs = v;
    else segs = v == null ? S("faint", DASH) : T(v);
    segs = clip(segs, c.w);
    return c.a === "r" ? padl(segs, c.w) : c.a === "c" ? center(segs, c.w) : padr(segs, c.w);
  };
  const out = [hline("┌", "┬", "┐")];
  out.push(cat(" ", S("faint", "│"), ...cols.flatMap((c, i) => [i ? S("faint", "│") : [], " ", cell(S("dim+b", c.h), c), " "]), S("faint", "│")));
  out.push(hline("├", "┼", "┤"));
  rows0.forEach((r, k) => {
    const on = k === sel;
    const parts = cols.map((c) => {
      let segs = cat(" ", cell(r[c.i], c), " ");
      if (on) segs = restyle(segs, (st) => (st ? st + "+b" : "text+b") + "+bg:hl");
      return segs;
    });
    const line = cat(" ", on ? S("accent", "▌") : S("faint", "│"), ...parts.flatMap((p, i) => [i ? S(on ? "faint+bg:hl" : "faint", "│") : [], p]), S("faint", "│"));
    if (on) line.sel = true;
    out.push(line);
  });
  if (!rows0.length) out.push(cat(" ", S("faint", "│"), padr(S("dim+i", `  ${empty}`), ws.reduce((a, b) => a + b, 0) + 3 * ws.length - 1), S("faint", "│")));
  out.push(hline("└", "┴", "┘"));
  return out;
}

// Pack items into lines no wider than w, 4 spaces apart.
export function flow(items, w) {
  const lines = [[]];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (!last.length) lines[lines.length - 1] = it;
    else if (segw(last) + 4 + segw(it) <= w) lines[lines.length - 1] = cat(last, "    ", it);
    else lines.push(it);
  }
  return lines;
}

export function box(title, right, lines, titleStyle = "accent+b") {
  const inner = ui.WW - 3;
  const tw = segw(title);
  const room = Math.max(inner - tw - 8, 0);
  const r = clip(right, room);
  const top = cat(" ", S("faint", "╭─ "), restyle(title, (st) => st || titleStyle), " ",
    S("faint", rep("─", inner - tw - segw(r) - 6)), " ", r, S("faint", " ─╮"));
  return [top, ...lines.map((l) => cat(" ", S("faint", "│"), " ", padr(clip(l, inner - 2), inner - 2), " ", S("faint", "│"))),
    cat(" ", S("faint", "╰" + rep("─", inner) + "╯"))];
}

export const section = (title, hint = "") =>
  [[], cat(" ", S("accent", "▍"), S("text+b", title.toUpperCase()), hint ? cat("   ", S("dim", hint)) : [])];
export const kv = (k, v, style = "text+b") => cat(S("dim", k + " "), S(style, v));
export const note = (style, text) => cat("   ", S(style, text));

// ─── markdown: headings, **bold**, *italic*, `code`, bullets, fences; wrapped ────────────
function inline(text) {
  const out = [];
  for (const m of text.matchAll(/\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|[^*`]+|[*`]/g)) {
    const t = m[0];
    if (t.length > 4 && t.startsWith("**") && t.endsWith("**")) out.push(["text+b", t.slice(2, -2)]);
    else if (t.length > 2 && t[0] === "*" && t.endsWith("*")) out.push(["text+i", t.slice(1, -1)]);
    else if (t.length > 2 && t[0] === "`" && t.endsWith("`")) out.push(["teal", t.slice(1, -1)]);
    else out.push(["text", t]);
  }
  return out;
}
export function wrap(segs, w) {
  const words = [];
  let cur = null;
  for (const [st, t] of segs) {
    for (const p of t.split(/( +)/)) {
      if (!p) continue;
      if (/^ +$/.test(p)) { cur = null; continue; }
      if (!cur) { cur = { parts: [], w: 0 }; words.push(cur); }
      cur.parts.push([st, p]);
      cur.w += strw(p);
    }
  }
  const lines = [];
  let line = [], lw = 0;
  for (const wd of words) {
    if (lw && lw + 1 + wd.w > w) { lines.push(line); line = []; lw = 0; }
    if (lw) { line.push(["", " "]); lw++; }
    line.push(...wd.parts);
    lw += wd.w;
  }
  if (line.length) lines.push(line);
  return lines;
}
export function markdown(text, indent) {
  const w = ui.WW - indent - 2;
  const pad = " ".repeat(indent);
  const out = [];
  let fence = false;
  for (const raw of String(text ?? "").replace(/\r/g, "").split("\n").map((l) => clean(l))) {
    if (/^\s*```/.test(raw)) { fence = !fence; continue; }
    if (fence) { out.push(cat(pad, "  ", S("teal", raw))); continue; }
    const l = raw.trimEnd();
    let m;
    if (!l.trim()) out.push([]);
    else if ((m = l.match(/^#+\s+(.*)$/))) out.push(cat(pad, S("accent+b", m[1])));
    else if ((m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
      const lead = m[1].length >= 2 ? "  " : "";
      const mark = /\d/.test(m[2]) ? m[2] + " " : "• ";
      wrap(inline(m[3]), w - lead.length - strw(mark)).forEach((seg, i) =>
        out.push(cat(pad, lead, i ? " ".repeat(strw(mark)) : S("accent", mark), seg)));
    } else if ((m = l.match(/^>\s?(.*)$/))) wrap(inline(m[1]), w - 2).forEach((seg) => out.push(cat(pad, S("faint", "│ "), restyle(seg, () => "dim+i"))));
    else wrap(inline(l.trim()), w).forEach((seg) => out.push(cat(pad, seg)));
  }
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}
