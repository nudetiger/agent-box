#!/usr/bin/env node
// `api`: the public API of the project's JVM dependency jars, for workers and reviewers. Installed as
// /usr/local/bin/api. Without it, workers found signatures by hand: on RakunMiniItems t51 (2026-10-16)
// 36 of 61 shell calls were unzip/javap/find under ~/.gradle, and the raw output stayed in context for
// the rest of the run. Indexes are cached next to the jars (the Gradle/Maven cache volume), so they are
// built once per jar, not once per run.
//
//   api find <regex>                 classes whose name matches, with the jar each is in
//   api show <Class|pkg.Class>...    signatures (javap -protected) of these classes
//   api grep <regex> [--jar <text>]  members whose signature matches, across the jars (or those whose
//                                    path contains <text>); the first grep of a jar indexes it
//   api src <Class> [member regex]   decompiled source (Vineflower), or only the matching members:
//                                    what javap -c was used for, as Java instead of bytecode
//   api jars [regex]                 the jars that are indexed
//
// Jars: ~/.gradle/caches/modules-2/files-2.1 and ~/.m2/repository, without -sources and -javadoc jars,
// and API_JARS (colon-separated extra jar paths or directories). javap: the newest JDK found.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const HOME = os.homedir();
const ROOTS = [path.join(HOME, ".gradle/caches/modules-2/files-2.1"), path.join(HOME, ".m2/repository"),
  ...(process.env.API_JARS || "").split(":").filter(Boolean)];
const MAX_LINES = Number(process.env.API_MAX_LINES || 200);

// ~/.cache/agent-box-api is a volume every slot shares (delegate.sh); files are written atomically.
function cacheDir() {
  for (const d of [process.env.API_CACHE, path.join(HOME, ".cache/agent-box-api"), path.join(os.tmpdir(), "agent-box-api")].filter(Boolean)) {
    try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return d; } catch {}
  }
  return os.tmpdir();
}
const CACHE = cacheDir();

function walk(dir, out) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".jar") && !/-(sources|javadoc)\.jar$/.test(e.name)) out.push(p);
  }
}
// One jar per group:artifact:version: a SNAPSHOT re-download leaves older copies under other hashes.
function jars() {
  const out = [];
  for (const r of ROOTS) { try { fs.statSync(r).isDirectory() ? walk(r, out) : r.endsWith(".jar") && out.push(r); } catch {} }
  const newest = new Map();
  for (const j of new Set(out)) {
    const k = label(j) + "|" + path.basename(j), t = fs.statSync(j).mtimeMs;
    if (!newest.has(k) || newest.get(k).t < t) newest.set(k, { j, t });
  }
  return [...newest.values()].map((x) => x.j).sort();
}
const writeAtomic = (f, text) => { const t = `${f}.${process.pid}.tmp`; fs.writeFileSync(t, text); fs.renameSync(t, f); };
// group:artifact:version from a Gradle or Maven cache path, else the file name.
function label(jar) {
  const g = jar.match(/files-2\.1[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]/);
  if (g) return `${g[1]}:${g[2]}:${g[3]}`;
  const m = jar.match(/repository[\\/](.+)[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/][^\\/]+\.jar$/);
  if (m) return `${m[1].replace(/[\\/]/g, ".")}:${m[2]}:${m[3]}`;
  return path.basename(jar);
}
const key = (jar) => crypto.createHash("sha1").update(jar + ":" + fs.statSync(jar).size).digest("hex").slice(0, 16);

// Class names from the zip central directory (no unzip or jar tool needed).
function classesOf(jar) {
  const f = path.join(CACHE, key(jar) + ".classes");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
  const buf = fs.readFileSync(jar);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  const names = [];
  if (eocd >= 0) {
    let off = buf.readUInt32LE(eocd + 16);
    const n = buf.readUInt16LE(eocd + 10);
    for (let k = 0; k < n && off + 46 <= buf.length && buf.readUInt32LE(off) === 0x02014b50; k++) {
      const nl = buf.readUInt16LE(off + 28), xl = buf.readUInt16LE(off + 30), cl = buf.readUInt16LE(off + 32);
      const name = buf.toString("utf8", off + 46, off + 46 + nl);
      off += 46 + nl + xl + cl;
      if (!name.endsWith(".class") || name.startsWith("META-INF/") || /(^|\/)(module|package)-info\.class$/.test(name)) continue;
      if (/\$\d/.test(name)) continue; // anonymous classes
      names.push(name.slice(0, -6).replace(/\//g, "."));
    }
  }
  writeAtomic(f, names.join("\n") + "\n");
  return names;
}

// The bytes of some entries of a jar (stored or deflated), by name.
function extract(jar, want) {
  const buf = fs.readFileSync(jar), out = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return out;
  let off = buf.readUInt32LE(eocd + 16);
  const n = buf.readUInt16LE(eocd + 10);
  for (let k = 0; k < n && off + 46 <= buf.length && buf.readUInt32LE(off) === 0x02014b50; k++) {
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20);
    const nl = buf.readUInt16LE(off + 28), xl = buf.readUInt16LE(off + 30), cl = buf.readUInt16LE(off + 32), lho = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nl);
    off += 46 + nl + xl + cl;
    if (!want(name) || buf.readUInt32LE(lho) !== 0x04034b50) continue;
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.subarray(start, start + csize);
    out.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
  }
  return out;
}

// Decompiled source of one class (with its inner classes), cached. Vineflower ships in the image.
const VINEFLOWER = process.env.API_DECOMPILER || "/opt/agent-box/vineflower.jar";
function sourceOf(jar, cls) {
  const f = path.join(CACHE, `${key(jar)}.${cls}.java`);
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  const jp = javap();
  const java = jp && path.join(path.dirname(jp), "java");
  if (!java || !fs.existsSync(java)) { console.error("api: no java found (no JDK in this container)"); process.exit(2); }
  if (!fs.existsSync(VINEFLOWER)) { console.error(`api: no decompiler at ${VINEFLOWER}`); process.exit(2); }
  const base = cls.replace(/\./g, "/");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "api-src-")), inDir = path.join(tmp, "in"), outDir = path.join(tmp, "out");
  for (const [name, bytes] of extract(jar, (n) => n === `${base}.class` || n.startsWith(`${base}$`))) {
    const p = path.join(inDir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes);
  }
  fs.mkdirSync(outDir, { recursive: true });
  try { execFileSync(java, ["-jar", VINEFLOWER, "-log=ERROR", inDir, outDir], { stdio: "ignore", timeout: 120000 }); } catch {}
  let text = "";
  try { text = fs.readFileSync(path.join(outDir, `${base}.java`), "utf8"); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
  if (text) writeAtomic(f, text);
  return text;
}
// The members whose declaration line matches: from that line to its closing brace.
function members(text, re) {
  const lines = text.split("\n"), out = [];
  for (let i = 0; i < lines.length; i++) {
    // A declaration: matches, opens a parameter list or body, and is not a statement (calls end in ;).
    if (!re.test(lines[i]) || !/[({]/.test(lines[i]) || /;\s*$/.test(lines[i]) || /^\s*(\/\/|\*|return\b|this\.|[\w.]+\()/.test(lines[i])) continue;
    let depth = 0, opened = false, j = i;
    for (; j < lines.length; j++) {
      for (const ch of lines[j]) { if (ch === "{") { depth++; opened = true; } else if (ch === "}") depth--; }
      if (opened && depth <= 0) break;
      if (!opened && /;\s*$/.test(lines[j])) break;
    }
    out.push(...lines.slice(i, j + 1), "");
    i = j;
  }
  return out;
}

let javapPath;
function javap() {
  if (javapPath !== undefined) return javapPath;
  const found = [];
  for (const d of [path.join(HOME, ".gradle/jdks"), "/usr/lib/jvm", "/opt/java", "/usr/local/sdkman/candidates/java"]) {
    let ents = []; try { ents = fs.readdirSync(d); } catch {}
    for (const e of ents) { const p = path.join(d, e, "bin/javap"); if (fs.existsSync(p)) found.push(p); }
  }
  try { found.push(execFileSync("sh", ["-c", "command -v javap"], { encoding: "utf8" }).trim()); } catch {}
  const ver = (p) => Number((p.match(/(?:jdk-?|openjdk-|adoptium-|temurin-)(\d+)/) || [])[1] || 0);
  javapPath = found.filter(Boolean).sort((a, b) => ver(b) - ver(a))[0] || null;
  return javapPath;
}
function runJavap(jar, classes) {
  const jp = javap();
  if (!jp) { console.error("api: no javap found (no JDK in this container)"); process.exit(2); }
  try {
    return execFileSync(jp, ["-protected", "-cp", jar, ...classes], { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) { return String(e.stdout || ""); }
}
// One line per member: "pkg.Class: <signature>", plus the class's own declaration line.
function signaturesOf(jar) {
  const f = path.join(CACHE, key(jar) + ".sigs");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  const cls = classesOf(jar), out = [];
  for (let i = 0; i < cls.length; i += 300) {
    let cur = "";
    for (const line of runJavap(jar, cls.slice(i, i + 300)).split("\n")) {
      if (!line.trim() || line.startsWith("Compiled from") || line.trim() === "}") continue;
      const decl = line.match(/^(?:public |protected |abstract |final |static |sealed |non-sealed |strictfp )*(?:class|interface|enum|record|@interface) ([\w.$]+)/);
      if (decl) { cur = decl[1]; out.push(`${cur}: ${line.replace(/\s*\{$/, "").trim()}`); continue; }
      if (cur) out.push(`${cur}: ${line.trim()}`);
    }
  }
  const text = out.join("\n") + "\n";
  writeAtomic(f, text);
  return text;
}

function print(lines, what) {
  if (!lines.length) { console.log(`api: no ${what}`); return; }
  for (const l of lines.slice(0, MAX_LINES)) console.log(l);
  if (lines.length > MAX_LINES) console.log(`... ${lines.length - MAX_LINES} more; narrow the pattern (or --jar)`);
}
function regex(s) { try { return new RegExp(s, "i"); } catch { return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); } }

const [cmd, ...args] = process.argv.slice(2);
const all = jars();
if (cmd === "jars") {
  const re = args[0] ? regex(args[0]) : null;
  print(all.map((j) => `${label(j)}  ${j}`).filter((l) => !re || re.test(l)), "jars");
} else if (cmd === "find") {
  if (!args[0]) { console.error("usage: api find <regex>"); process.exit(1); }
  const re = regex(args[0]), out = [];
  for (const j of all) for (const c of classesOf(j)) if (re.test(c)) out.push(`${c}  (${label(j)})`);
  print(out, `class matches /${args[0]}/`);
} else if (cmd === "show") {
  if (!args.length) { console.error("usage: api show <Class|pkg.Class> ..."); process.exit(1); }
  for (const want of args) {
    const fq = want.includes(".") && !/^[A-Z]/.test(want);
    const hits = [];
    for (const j of all) for (const c of classesOf(j)) if (fq ? c === want : c.split(".").pop() === want || c.endsWith("." + want)) hits.push([j, c]);
    if (!hits.length) { console.log(`api: no class ${want} (try: api find ${want})`); continue; }
    for (const [j, c] of hits.slice(0, 3)) {
      console.log(`== ${c}  (${label(j)})`);
      print(runJavap(j, [c]).split("\n").filter((l) => l.trim() && !l.startsWith("Compiled from")), "members");
    }
    if (hits.length > 3) console.log(`... ${hits.length - 3} more classes named ${want}; use the full name`);
  }
} else if (cmd === "src") {
  // api src <Class> [member-regex]: decompiled source, or only the members whose declaration matches.
  const [want, member] = args;
  if (!want) { console.error("usage: api src <Class|pkg.Class> [member regex]"); process.exit(1); }
  const fq = want.includes(".") && !/^[A-Z]/.test(want);
  let hit = null;
  for (const j of all) { for (const c of classesOf(j)) if (fq ? c === want : c.split(".").pop() === want || c.endsWith("." + want)) { hit = [j, c]; break; } if (hit) break; }
  if (!hit) { console.log(`api: no class ${want} (try: api find ${want})`); process.exit(0); }
  const text = sourceOf(hit[0], hit[1]);
  if (!text) { console.log(`api: could not decompile ${hit[1]}; use api show ${hit[1]}`); process.exit(0); }
  console.log(`== ${hit[1]}  (${label(hit[0])}, decompiled)`);
  print(member ? members(text, regex(member)) : text.split("\n"), member ? `member matching /${member}/` : "source");
} else if (cmd === "grep") {
  const ji = args.indexOf("--jar");
  const filter = ji >= 0 ? args.splice(ji, 2)[1] : null;
  if (!args[0]) { console.error("usage: api grep <regex> [--jar <text>]"); process.exit(1); }
  const re = regex(args[0]), out = [];
  const pick = all.filter((j) => !filter || j.toLowerCase().includes(filter.toLowerCase()) || label(j).toLowerCase().includes(filter.toLowerCase()));
  if (!pick.length) { console.log(`api: no jar matches ${filter}; see api jars`); process.exit(0); }
  for (const j of pick) for (const l of signaturesOf(j).split("\n")) if (l && re.test(l)) out.push(l);
  print(out, `member matches /${args[0]}/${filter ? ` in jars matching ${filter}` : ""}`);
} else {
  console.log(`usage:
  api find <regex>                 classes whose name matches, with their jar
  api show <Class|pkg.Class>...    signatures of these classes (javap -protected)
  api grep <regex> [--jar <text>]  members whose signature matches (first use of a jar indexes it)
  api src <Class> [member regex]   decompiled source of a class, or only its matching members
  api jars [regex]                 the dependency jars it knows (${all.length} now)`);
  process.exit(cmd ? 1 : 0);
}
