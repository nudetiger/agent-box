// Why the worker's last model step ended: OpenCode's step_finish reason ("stop", "tool-calls",
// "length", ...), or "" when there is none. "length" means the step hit the output cap, usually by
// thinking: Gemini at high effort spent ~30,700 reasoning tokens of a ~32k cap and the turn ended
// before any edit (Lykos T174b, 3 runs, 2026-10-13). run-task.sh resumes such a session.
//   node last-stop.mjs <events.jsonl>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function lastStop(text) {
  let reason = "";
  for (const l of text.split("\n")) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (e?.type === "step_finish") reason = e.part?.reason ?? "";
  }
  return reason;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let text = ""; try { text = fs.readFileSync(process.argv[2], "utf8"); } catch { /* no events */ }
  console.log(lastStop(text));
}
