---
sealed: [lykos/cli/scripted-compaction-chain.test.ts, lykos/extensions/defaults/lykos-self-compact.test.ts, lykos/extensions/defaults/self-compact-handoff.test.ts, lykos/ledger/compactions-chain.test.ts, lykos/loop/compaction-chain.test.ts, lykos/loop/self-compact.test.ts, lykos/loop/shake.test.ts]
test: "npx tsx --test lykos/cli/scripted-compaction-chain.test.ts lykos/extensions/defaults/lykos-self-compact.test.ts lykos/extensions/defaults/self-compact-handoff.test.ts lykos/ledger/compactions-chain.test.ts lykos/loop/compaction-chain.test.ts lykos/loop/self-compact.test.ts lykos/loop/shake.test.ts"
---
# T190: a chain of compaction methods, with the handoff side call and shake

Implement issue #45 of this repository (quoted below with its parent spec #15, P17 compaction parity; see the P17 section of docs/plan/phases.md). Read oh-my-pi first in `reference/oh-my-pi` (pinned 2e6b5b7; only its compaction and session sources are present): compaction methodOrder, session-handoff.ts (side call with no tools reusing the live turn's cache key), shake, compact-modes.ts. Read the installed Pi package node_modules/@earendil-works/pi-coding-agent (compaction, the extension API) before building; never patch Pi (CLAUDE.md rule 7).

Merged work to build on: #44 put the handoff prompt in lykos/loop/self-compact-template.ts (`SELF_COMPACT_HANDOFF_PROMPT`, `SELF_COMPACT_SECTIONS`, `missingNoteSections`) for this ticket to load as is; #43 added the default extension lykos-prune and the `prunes` ledger table (ADR-0039); self-compact lives in lykos/loop/self-compact.ts and lykos/extensions/defaults/lykos-self-compact.ts; the `compactions` ledger table records tokens before/after with cache read and cache write kept separate (docs/findings.md §1.3). New policy ships as a default extension whose list entry is its switch (ADR-0035/0028). Any verbatim text copied from oh-my-pi gets a THIRD-PARTY.md row (ADR-0013). Never fabricate a number.

The acceptance tests above (`sealed`) are fixed: make them pass without editing them, and keep `npx tsc --noEmit` clean. Follow your tdd workflow for anything they do not cover. Run only the test files you add or change, plus the typecheck; do not run the full `npm test`.

## Issue #45

> Spec: #15
>
> **Task:** T190. **Difficulty:** high. **Risk:** medium (context handling in every session). **Impact:** agent-strength, cost.
>
> ## Parent
>
> #15
>
> ## What to build
>
> A configurable, ordered chain of compaction methods. When one fails or yields an empty handoff, the next runs. Default order: agent note (`self_compact`, today's path) → handoff side call → shake → Pi's summary. The handoff side call writes a note from T189's template in a separate request with no tools that reuses the live turn's prompt-cache key, as oh-my-pi's `packages/coding-agent/src/session/session-handoff.ts` does at `2e6b5b7`; it runs when Pi compacts with no agent note. Shake drops content the agent can re-read (tool results, file bodies) in place with no model call (`packages/agent/src/compaction/shake.ts`). The `compactions` row records which method ran, each method tried before it and why it fell through, tokens before and after, and cache read and cache write separately.
>
> ## Acceptance criteria
>
> - [ ] The order is a config key with the default above; unknown names are ignored
> - [ ] A compaction with no agent note runs the handoff side call, whose request carries no tools and the live turn's cache key
> - [ ] A side call that fails or returns an empty note falls through to shake, then Pi's summary
> - [ ] Shake makes no model call
> - [ ] The `compactions` row names the method that ran and the ones that fell through
> - [ ] The full test suite passes
>
> ## Blocked by
>
> - #44

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
