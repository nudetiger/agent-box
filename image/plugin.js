// agent-box OpenCode plugin: after every edit, write or patch, parse the touched files and append any
// syntax error to the tool result, so a broken file is caught on the same step instead of at test
// time (Composer twice broke a file with a whole-file write; research/findings.md §3).
// Installed as ~/.config/opencode/plugins/agent-box.js. Hook shape: research/opencode-customization.md §6.
import { execFileSync } from "node:child_process";

const CHECK = "/opt/agent-box/syntax-check.mjs";

function touched(tool, args = {}) {
  if (tool === "edit" || tool === "write") return args.filePath ? [args.filePath] : [];
  if (tool === "apply_patch") return [...String(args.patchText ?? "").matchAll(/^\*\*\* (?:Update|Add) File: (.+)$/gm)].map((m) => m[1].trim());
  return [];
}

// The Read tool's own output (path and type tags, numbered lines) pasted as file content. Composer did
// this twice in one bench run (2026-10-12, trivial-low-stock) and needed 4 more steps to recover.
const READ_DUMP = /^\s*<path>[^\n]*<\/path>\s*\n\s*<type>(?:file|directory)<\/type>/;

export const AgentBox = async ({ directory }) => ({
  "tool.execute.before": async (input, output) => {
    const text = input.tool === "write" ? output.args?.content : input.tool === "edit" ? output.args?.newString : null;
    if (typeof text === "string" && READ_DUMP.test(text))
      throw new Error("Rejected: this content is the read tool's output (<path>, <type> tags and numbered lines), not file text. "
        + "Write only the file's own lines, without the tags and without the 'N: ' line numbers. The file was not changed.");
  },
  "tool.execute.after": async (input, output) => {
    // Dependency discovery by hand (javap, unzip, jar listings under the build caches): point at `api`,
    // whose answers are short and cached. t51 (2026-10-16): 36 of 61 shell calls were this.
    const cmd = input.tool === "bash" ? String(input.args?.command ?? "") : "";
    if (/\bjavap\b|\bunzip\b[^|]*\.jar|\bjar\s+-?t|\.gradle\/caches|\.m2\/repository/.test(cmd) && !/\bapi\s/.test(cmd))
      output.output = `${output.output ?? ""}\n\n[agent-box] For dependency classes use \`api find <regex>\`, \`api show <Class>\`, \`api grep <regex> --jar <name>\`, or \`api src <Class> [method]\` for decompiled source instead of javap -c bytecode: short and cached.`;
    for (const f of touched(input.tool, input.args)) {
      const file = f.startsWith("/") ? f : `${directory}/${f}`;
      try {
        execFileSync("node", [CHECK, file], { stdio: "pipe", timeout: 65000 });
      } catch (e) {
        const msg = String(e.stdout || "").trim();
        if (msg) output.output = `${output.output ?? ""}\n\n[agent-box syntax check] ${f} no longer parses:\n${msg}\nFix this file before anything else.`;
      }
    }
  },
});
