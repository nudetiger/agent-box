// MCP server (stdio, newline-delimited JSON-RPC) that lets a worker ask the orchestrator a question
// mid-run. A question is written to /out/questions/<n>.md; the host answers with
// `delegate.sh answer`, which places /in/answers/<n>.md. No dependencies.
//
// Each call waits at most ASK_WAIT_S seconds (kept under MCP clients' usual 60 s request timeout); the
// worker calls wait_for_answer to keep waiting. After ASK_TIMEOUT_MIN minutes without an answer the
// tool tells the worker to decide itself, so a run never hangs on a question.
import fs from "node:fs";
import path from "node:path";

const QDIR = "/out/questions";
const ADIR = "/in/answers";
const WAIT_S = Number(process.env.ASK_WAIT_S || 45);
const TIMEOUT_MIN = Number(process.env.ASK_TIMEOUT_MIN || 10);
fs.mkdirSync(QDIR, { recursive: true });
fs.mkdirSync(ADIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asked = (id) => fs.statSync(path.join(QDIR, `${id}.md`)).mtimeMs;

async function waitFor(id) {
  const end = Date.now() + WAIT_S * 1000;
  const file = path.join(ADIR, `${id}.md`);
  while (Date.now() < end) {
    if (fs.existsSync(file)) {
      const answer = fs.readFileSync(file, "utf8").trim();
      fs.writeFileSync(path.join(QDIR, `${id}.answer.md`), answer + "\n");
      return `Answer to question ${id} from the orchestrator:\n\n${answer}`;
    }
    await sleep(1000);
  }
  if (Date.now() - asked(id) > TIMEOUT_MIN * 60000) {
    fs.writeFileSync(path.join(QDIR, `${id}.timeout`), "");
    return `No answer to question ${id} will come. Decide yourself, and state the decision and your reason under "unsure" in your final message.`;
  }
  return `No answer to question ${id} yet. Call wait_for_answer with id ${id} to keep waiting, or first do work that does not depend on the answer.`;
}

const tools = [
  {
    name: "ask_orchestrator",
    description:
      "Ask the orchestrator (the engineer who wrote your task) a question and wait for the answer. Use it only when the answer changes what you build: an ambiguous requirement, two designs with different trade-offs, or a conflict between the task and the code. For anything else, decide yourself and record the assumption in your final message. Ask one precise question, give the options you see and which you would pick.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "The question, with the options you see and your preferred one" } },
      required: ["question"],
    },
  },
  {
    name: "wait_for_answer",
    description: "Keep waiting for the answer to a question you asked with ask_orchestrator.",
    inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  },
];

async function call(name, args) {
  if (name === "ask_orchestrator") {
    const ids = fs.readdirSync(QDIR).map((f) => parseInt(f, 10)).filter((n) => !Number.isNaN(n));
    const id = ids.length ? Math.max(...ids) + 1 : 1;
    fs.writeFileSync(path.join(QDIR, `${id}.md`), String(args.question || "").trim() + "\n");
    return `Question ${id} sent.\n\n` + (await waitFor(id));
  }
  if (name === "wait_for_answer") {
    const id = Number(args.id);
    if (!fs.existsSync(path.join(QDIR, `${id}.md`))) return `There is no question ${id}.`;
    return waitFor(id);
  }
  throw new Error(`unknown tool ${name}`);
}

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");

async function handle(req) {
  const { id, method, params } = req;
  if (id === undefined) return; // notification
  try {
    if (method === "initialize") {
      return send({ id, result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "agent-box-orchestrator", version: "1.0.0" },
      } });
    }
    if (method === "ping") return send({ id, result: {} });
    if (method === "tools/list") return send({ id, result: { tools } });
    if (method === "tools/call") {
      const text = await call(params.name, params.arguments || {});
      return send({ id, result: { content: [{ type: "text", text }] } });
    }
    send({ id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (e) {
    send({ id, result: { content: [{ type: "text", text: String(e.message || e) }], isError: true } });
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let req; try { req = JSON.parse(line); } catch { continue; }
    handle(req);
  }
});
