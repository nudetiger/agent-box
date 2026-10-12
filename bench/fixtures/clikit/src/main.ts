#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { run } from "./cli.ts";

process.exitCode = run(process.argv.slice(2), {
  readFile: (path) => readFileSync(path === "-" ? 0 : path, "utf8"),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
