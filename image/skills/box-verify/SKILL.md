---
name: box-verify
description: How to verify a change before reporting it done in an agent-box run. Load before your final message whenever you changed code.
---

# Verify before you report

The harness reruns the tests itself and a reviewer reads your diff. Your report is compared with both.

1. Run the narrowest command that exercises your change first (the context pack names it under "Verify with").
   Then run the test command from the operating conditions.
2. If the project has a type checker (`npx tsc --noEmit` for TypeScript), run it. A green test run with
   type errors is not done.
3. Read your own diff: `git diff <base>..HEAD` and `git status`. Remove debug output, stray files and
   edits outside the task's scope.
4. A failing test that also fails on the base commit is pre-existing. Prove it with
   `git stash; <command>; git stash pop` (or a checkout of the base into /tmp), and say so in the report. Do not fix
   it unless the task asks.
5. Report the test summary lines exactly as printed (counts of tests, pass, fail). Never paraphrase a
   result you did not see.
6. If you could not make it pass without editing a sealed file or weakening a test, stop and end with
   `BLOCKED: <reason>`.
