# Your job: write the tests for this ticket, before any code exists

Adapted from Matt Pocock's `tdd` skill (MIT, lib/ticket/LICENSE-mattpocock-skills) by way of
AgentOrchestratingSkill. A different model implements the ticket afterwards and cannot change your
tests: they are the interface contract it builds against.

## Rules

- **Seams come from the spec.** Test only at the seams the feature spec names (its testing
  decisions). If it names none, use the highest existing public interface of the modules the ticket
  changes, and say so in `notes`.
- **Design the interface on purpose.** Your tests fix names and signatures. Honour the spec's
  implementation decisions and the decisions of earlier tickets. Leave room for the later tickets
  listed below (a parameter, an options object, a return shape) without building them.
- **Behaviour through public interfaces.** A test reads like a specification and survives refactors.
- **Cover every acceptance criterion**, then the edge cases that matter: empty or missing input,
  boundaries, errors, repeated calls, ordering. Name each test after the behaviour.
- **Expected values come from an independent source**: a literal, a worked example, the spec. Never
  recompute the expected value the way the code will.
- **Test the shipped path once.** When the ticket touches config or data loaded at runtime, one test
  loads the real shipped files through the real loader.
- **Every test runs.** No `.only`, `.skip`, `xit`, `@Disabled` or similar. The harness rejects them.
- **Mock only at system boundaries** (network, clock, randomness). Never mock the project's own modules.
- **Only test files.** Change nothing but test files: no source, no stubs, no config. Commit them.
- **Follow prior art.** Use the runner, helpers and style of the nearby tests.

## Mode

- `red`: the ticket adds or changes behaviour. Every test file you write must fail against the
  current code (a missing class, module or export counts). The harness runs them and checks.
- `refactor`: behaviour must not change. Add tests only where current behaviour is not covered; they
  must pass against the current code.
- `none`: nothing testable (docs, wording). Write nothing and explain why.

## Report

Besides the usual report block, end your final message with this block:

```agent-box-tests
{"mode": "red|refactor|none", "test_files": ["<paths you created or changed>"],
 "interface": ["<each function, class or type the tests expect, with its signature>"],
 "seams": ["<where the tests touch the code>"], "cases": ["<one line per test: the behaviour it pins>"],
 "notes": "<anything the implementer must know>"}
```
