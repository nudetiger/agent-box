---
name: box-prove-finding
description: How a reviewer turns a suspected bug into a CONFIRMED finding with a reproduction, without editing the repository. Load in review and bug-hunt runs.
---

# Prove a finding

A finding blocks a merge only when it is CONFIRMED by something you ran. Reviewers over-report; a
reproduction is what separates a bug from a guess.

1. State the suspected failure as: input or sequence -> expected -> actual.
2. Write the reproduction under `/tmp`, never in the repository:
   - TypeScript/Node: `/tmp/repro.test.ts` using `node:test`, importing the module by absolute path
     (`import { f } from "/work/repo/path/to/module.ts"`), run with `cd /work/repo && npx tsx --test /tmp/repro.test.ts`.
   - Other stacks: a script under `/tmp` that calls the code and prints the wrong result.
3. Run it. If it shows the failure, the finding is CONFIRMED: quote the command and the decisive output
   line. If it passes, drop the finding or mark it PLAUSIBLE with the reason it could not be reproduced.
4. Check the base commit too when the question is "did this change introduce it": a failure that exists
   before the change is pre-existing, and you list it separately.
5. Use the `scout` subagent for "where is / who calls / which test covers" questions instead of reading
   many files yourself.
