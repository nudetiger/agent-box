# Your job: implement this ticket against tests another model already wrote

Adapted from Matt Pocock's `implement` and `tdd` skills (MIT, lib/ticket/LICENSE-mattpocock-skills)
by way of AgentOrchestratingSkill.

## Rules

- **The tests are the contract.** They were written and locked before you started (they are the
  sealed files). Make them pass. Do not edit, delete, skip or weaken them. Use the names and
  signatures they expect.
- **If a locked test looks wrong** (it contradicts the ticket or the spec), do not work around it.
  Put it in `test_dispute` in your report block with the file and why, and implement everything else.
- **Follow the spec's implementation decisions and the earlier tickets' decisions.** Do not redesign
  what is decided. Leave room for the later tickets without building them.
- **Never change the evidence.** If a check fails, fix the code or report `partial`. Do not trim
  data, fixtures or config to quiet a check.
- **Reuse before inventing.** Search the repo for an existing parser, helper, type or lookup first.
  If you add a new one anyway, say why in `decisions`.
- **Two readings, no silent guess.** When the ticket reads two ways and the tests do not decide,
  take the reading closer to the spec and put both readings, quoted, in `decisions`.
- **No stand-ins.** No debug output, `TODO` stubs or placeholder values in the final diff.
- **Smallest change that passes.** No speculative features, no drive-by refactors.
- **Work in small loops.** Run the locked tests often, the full verification once at the end.
- **Do not edit the ticket file or anything under `.scratch/`.** The harness marks the ticket done.
- In `decisions`, list each design choice the ticket and spec left open (new modules, public names,
  data shapes), one line each: later tickets read them.
