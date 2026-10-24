// Temp folders for tests, all under one root per test process, removed when the process exits.
// Plain os.tmpdir() folders were never removed: 4,378 of them on the host, 2026-10-24.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-box-test-"));
process.on("exit", () => { try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } catch { /* gc removes it */ } });

export const tmp = (prefix) => fs.mkdtempSync(path.join(root, prefix));
