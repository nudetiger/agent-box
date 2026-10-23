// One-pass advisor call: no container, no tools. For debating a plan or design with a second model.
//
//   node lib/ask.mjs <model> <prompt-file|-> <out-file> [context-file ...]
//
// Env: OMNIROUTE_API_KEY, OMNIROUTE_HOST_URL (default http://localhost:20128/v1), EFFORT (optional).
// Context files are appended verbatim under their paths, capped at 60k characters in total.
import fs from "node:fs";

const [model, promptPath, outPath, ...contextFiles] = process.argv.slice(2);
if (!model || !promptPath || !outPath) {
  console.error("usage: ask.mjs <model> <prompt-file|-> <out-file> [context-file ...]");
  process.exit(2);
}
const key = process.env.OMNIROUTE_API_KEY;
if (!key) { console.error("OMNIROUTE_API_KEY is not set"); process.exit(2); }
const base = process.env.OMNIROUTE_HOST_URL || "http://localhost:20128/v1";

const prompt = fs.readFileSync(promptPath === "-" ? 0 : promptPath, "utf8");
let budget = 60000;
const context = [];
for (const f of contextFiles) {
  const text = fs.readFileSync(f, "utf8");
  const take = text.slice(0, Math.max(0, budget));
  budget -= take.length;
  context.push(`<file path="${f}">\n${take}${take.length < text.length ? "\n[truncated]" : ""}\n</file>`);
  if (budget <= 0) break;
}

const system = [
  "You are a senior engineer advising Claude Opus, the orchestrating agent on a software project.",
  "It asks you to debate, critique or brainstorm, not to write the code.",
  "Be direct. Disagree when the reasoning is weak and say why. Give one recommendation, the strongest",
  "argument against it, and what evidence would change your mind. Say plainly what you do not know.",
  "No filler, no restating the question.",
].join(" ");

const body = {
  model,
  messages: [
    { role: "system", content: system },
    { role: "user", content: context.length ? `${prompt}\n\n${context.join("\n\n")}` : prompt },
  ],
};
if (process.env.EFFORT) body.reasoning_effort = process.env.EFFORT;

const started = Date.now();
const res = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(15 * 60 * 1000),
});
const json = await res.json().catch(() => ({}));
const answer = json.choices?.[0]?.message?.content;
if (!res.ok || !answer) {
  console.error(`ask failed (${res.status}): ${json.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
  // exitCode, not exit(): exiting while fetch's socket closes aborts node on Windows
  // (UV_HANDLE_CLOSING assertion, RakunLoots P9 2026-10-22), hiding the message above.
  process.exitCode = 1;
} else {
  const seconds = Math.round((Date.now() - started) / 1000);
  const record = `# ask ${model}\n\n${seconds}s, usage ${JSON.stringify(json.usage ?? {})}\n\n## Prompt\n\n${prompt.trim()}\n\n## Answer\n\n${answer.trim()}\n`;
  fs.writeFileSync(outPath, record);
  console.log(answer.trim());
  console.error(`\n(${model}, ${seconds}s, usage ${JSON.stringify(json.usage ?? {})}; saved ${outPath})`);
}
