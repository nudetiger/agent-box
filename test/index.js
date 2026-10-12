// Node 24 resolves `node --test test/` to this directory's index.js, not to the files in it: load every
// *.test.mjs here so that command runs the whole suite.
import { readdirSync } from "node:fs";

for (const f of readdirSync(import.meta.dirname).filter((n) => n.endsWith(".test.mjs")).sort()) await import(`./${f}`);
