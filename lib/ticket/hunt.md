# Your job: find a reported bug and pin it with a failing test

Somebody saw the bug below; nobody knows yet where it lives. Find it and write the test that proves
it. Do not fix it: a different model fixes it afterwards and cannot change your test, so the test is
the fix's acceptance test.

## Rules

- **Reproduce first.** Run the code until you see the wrong behaviour yourself. A scratch script
  under `/tmp` is fine for that.
- **Locate it.** Follow the wrong value back to the code that produces it. Name the file and line and
  say why that line is wrong. When the same defect sits in more than one place, name every place.
- **Pin the behaviour, not the line.** The test calls the highest public interface that shows the
  bug and asserts what the report says should happen. It must fail on the current code for the
  reason the report gives, not because of a helper or export you invented.
- **Expected values come from the report, the spec or the docs**, never from the current code.
- **Only test files.** No fix, no source change, no stubs, no config. Put the test next to the
  module's existing tests, follow their runner and style, and commit it.
- **Every test runs.** No `.only`, `.skip`, `xit`, `@Disabled` or similar. The harness rejects them.
- **Cannot reproduce?** Write no test, use mode `none`, and say what you ran and what you saw. Do not
  guess a location.

The harness runs the test files you changed and checks that they fail on the current code.

## Report

Besides the usual report block, end your final message with this block:

```agent-box-tests
{"mode": "red|none", "test_files": ["<paths you created or changed>"],
 "location": [{"file": "<path>", "line": 0, "why": "<what this line does wrong>"}],
 "cases": ["<one line per test: the behaviour it pins>"],
 "notes": "<what the fixer must know: the root cause, other places with the same defect, traps>"}
```
