---
sealed: [lykos/cli/doctor.test.ts, lykos/cli/scripted-prune-session.test.ts, lykos/cli/scripted-prune.test.ts, lykos/config/extensions.test.ts, lykos/extensions/defaults/lykos-prune.test.ts, lykos/ledger/ledger.test.ts, lykos/loop/tool-result-prune.test.ts, lykos/session/boot.test.ts, lykos/session/live-capture.test.ts, lykos/tools/lsp.test.ts]
test: "npx tsx --test lykos/cli/doctor.test.ts lykos/cli/scripted-prune-session.test.ts lykos/cli/scripted-prune.test.ts lykos/config/extensions.test.ts lykos/extensions/defaults/lykos-prune.test.ts lykos/ledger/ledger.test.ts lykos/loop/tool-result-prune.test.ts lykos/session/boot.test.ts lykos/session/live-capture.test.ts lykos/tools/lsp.test.ts"
---
# T188: prune superseded reads and useless results every turn, without breaking the prompt cache

Implement issue #43 of this repository (quoted below with its parent spec #15, P17 compaction parity). The oh-my-pi reference clone is at `reference/oh-my-pi` (pinned 2e6b5b7; only its compaction and session sources are present): read its pruning source before building.

The acceptance tests above (`sealed`) are fixed: make them pass without editing them, and keep `npx tsc --noEmit` clean. Follow your tdd workflow for anything they do not cover. Run only the test files you add or change, plus the typecheck; do not run the full `npm test`.

## Issue #43

> Spec: #15
>
> **Task:** T188. **Difficulty:** high. **Risk:** medium (a prune inside the warm prefix turns cache reads into cache writes). **Impact:** agent-strength, cost.
>
> ## Parent
>
> #15
>
> ## What to build
>
> Every turn, overwrite an earlier `read` result that a newer read of the same file has superseded with `[Superseded by a newer read of this file]`, and a result whose tool flagged it useless with `[Uneventful result elided]`. Port oh-my-pi's cache guard (`packages/agent/src/compaction/pruning.ts`, `session-maintenance.ts` `#pruneStaleToolResults`, at `2e6b5b7`): never touch entries before the latest compaction's kept boundary; leave a result alone once more than 8,000 tokens follow it, and always for prefix-bound thinking; rewrite the whole sent region only once idle longer than Lykos's configured cache retention. The pruned context is what is persisted, so resume and fork rebuild the same prefix. Two knobs, both default on: supersede reads, drop useless. Useless-result pruning applies only to results whose tool sets the flag explicitly; this ticket adds the flag and sets it on no tool unless one is obvious. Record each prune's count and tokens saved in the ledger.
>
> Read Pi's installed package first (rule 2): it has no supersession today, but check its message-replacement and persistence hooks before building one.
>
> ## Acceptance criteria
>
> - [ ] Two reads of the same file: the earlier result is replaced by the superseded notice on the next turn
> - [ ] A read with a selector is superseded by a later selector-free read of the same path, never the reverse
> - [ ] A superseded result followed by more than 8,000 tokens is left untouched until idle exceeds the cache retention
> - [ ] Entries before the latest compaction boundary are never rewritten
> - [ ] A resumed session's context matches the live, pruned context
> - [ ] Each knob off disables its prune; both default on
> - [ ] Prunes are recorded with count and tokens saved
> - [ ] The full test suite passes
>
> ## Blocked by
>
> None.

## Spec #15

> **Phase:** P17, compaction parity ([phases.md](https://github.com/nudetiger/Lykos/blob/master/docs/plan/phases.md)).
> **Decisions:** [ADR-0013](https://github.com/nudetiger/Lykos/blob/master/docs/adr/0013-parity-with-oh-my-pi-is-the-strength-target.md) (oh-my-pi is the strength target). Triage grill 2026-10-10, Q1–Q11.
> **Source read:** oh-my-pi at `2e6b5b79a0c5b190797aace99f41fab6ae42e6c5` (`reference/oh-my-pi`, gitignored; clone command below).
>
> ## Problem Statement
>
> P4's self-compact and continuation were built from `research/oh-my-pi.md`, a summary, not oh-my-pi's source. Read at source, oh-my-pi's compaction does things Lykos does not. Lykos in turn has tiered notices, `context_usage`, a cutoff that refuses every other tool, the note carried across a resume, and the successor-from-disk path, none of which oh-my-pi has.
>
> ## What oh-my-pi does, at source
>
> 1. **Read supersession and useless-result pruning, every turn.** `packages/agent/src/compaction/pruning.ts`, called from `session-maintenance.ts` `#pruneStaleToolResults`. Overwrites a superseded read with `[Superseded by a newer read of this file]` and a flagged result with `[Uneventful result elided]`. Cache guard: never touches entries before the last compaction's `firstKeptEntryId`; leaves a result alone once more than 8,000 tokens follow it (`PRUNE_CACHE_WARM_SUFFIX_TOKENS`, 0 for prefix-bound thinking); rewrites the whole sent region only after 90 min idle (`PRUNE_IDLE_FLUSH_MS`). `compaction.supersedeReads` and `compaction.dropUseless` default true. Neither Lykos nor Pi has this.
> 2. **A method chain.** `compaction.methodOrder`, default `remote → snapcompact → handoff → shake → soft` (`compaction-methods.ts`). Lykos retries its own handoff but has one method.
> 3. **Idle and mid-turn compaction.** `compaction.idleEnabled` defaults **false** (200,000 tokens, 300 s). Lykos's cutoff covers the mid-turn case.
> 4. **A templated handoff side call.** `session-handoff.ts`: a one-shot request with no tools that reuses the live turn's prompt-cache key, from `prompts/handoff-document.md`. In Lykos the agent writes its note in the live turn through `self_compact`, so the cache is already reused; what is missing is the template and a note when Pi compacts with no agent note.
> 5. **Per-run override.** `/compact soft|remote|snapcompact` (`compact-modes.ts`).
>
> ## Decisions
>
> - **In:** 1, 2 (Lykos chain), 4 (as a template plus a chain method), 5.
> - **Out:** 3. Idle compaction → WISHLIST W22; mid-turn is covered by the cutoff. `remote` → W23, `snapcompact` → W24.
> - **Gap 1:** both prunes on by default. Port the three cache rules. The idle flush cutoff comes from Lykos's configured cache retention, not oh-my-pi's 90 min. Useless-result pruning applies only to results whose tool sets the flag explicitly.
> - **Gap 2 chain:** agent note (`self_compact`) → handoff side call → shake → Pi's summary.
> - **Every mechanism** is a config knob with a Lykos default, records tokens before and after and cache read and cache write separately (findings §1.3) in the `compactions` table. Numbers never gate the phase (rule 6). One that measurably fails is deleted, not left behind a flag set to off.
>
> ## Tickets
>
> - #43 T188 — read supersession and useless-result pruning, with the cache guard
> - #44 T189 — a fixed template for the `self_compact` note
> - #45 T190 — the method chain, with the handoff side call and shake (blocked by T189)
> - #46 T191 — `/compact <method>` (blocked by T190)
>
> P15 is a soft dependency: T188 and T189 may run alongside it.
>
> ## Demonstration
>
> In one standalone session, `lykos show` shows: an earlier read of a file replaced by the superseded notice after a later read of it; a `self_compact` note in the template's sections; a compaction where no agent note exists falling through to the handoff side call; and `/compact shake` running shake alone. Each compaction's `compactions` row has tokens before and after, with cache read and cache write separate.
>
> ## Reading the source
>
> ```bash
> git clone https://github.com/can1357/oh-my-pi reference/oh-my-pi && git -C reference/oh-my-pi checkout 2e6b5b79a0c5b190797aace99f41fab6ae42e6c5
> ```
