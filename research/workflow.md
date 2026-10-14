# Orchestrator + sandboxed worker pool: the strongest practical workflow

Researched 2026-10-12. Question: how should one orchestrator (Claude Opus in Claude Code) delegate
coding work to OpenCode workers on OmniRoute, with accuracy first, then speed, then cost, when the
premium models have limited quota?

**Tags.** **[S]** means sourced, with the URL beside it. **[I]** means my inference. **[U]** means
the user's own observation from a single trial, which counts as an anecdote and not as a measurement.
A missing number is written as "unmeasured" and is never estimated.

---

## 0. Sources (all primary)

| Key | Source |
| --- | --- |
| AIDER-ARCH | Aider, architect/editor results: https://aider.chat/2024/09/26/architect.html |
| AIDER-MAP | Aider repo map: https://aider.chat/docs/repomap.html |
| ANT-AGENTS | Anthropic, Building effective agents: https://www.anthropic.com/engineering/building-effective-agents |
| ANT-MULTI | Anthropic, multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system |
| ANT-CTX | Anthropic, context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents |
| CC-BP | Claude Code best practices: https://code.claude.com/docs/en/best-practices |
| COG | Cognition, Don't build multi-agents: https://cognition.com/blog/dont-build-multi-agents |
| OC-AGENTS / OC-PERM | OpenCode docs: https://opencode.ai/docs/agents/ , https://opencode.ai/docs/permissions/ |
| CODET | CodeT, arXiv 2207.10397: https://arxiv.org/abs/2207.10397 |
| AGENTCODER | AgentCoder, arXiv 2312.13010: https://arxiv.org/abs/2312.13010 |
| AGENTLESS | Agentless, arXiv 2407.01489: https://arxiv.org/abs/2407.01489 |
| MONKEYS | Large Language Monkeys, arXiv 2407.21787: https://arxiv.org/abs/2407.21787 |
| SELFREPAIR | Is Self-Repair a Silver Bullet, arXiv 2306.09896: https://arxiv.org/abs/2306.09896 |
| SELFPREF | LLM evaluators favour their own generations, arXiv 2404.13076: https://arxiv.org/abs/2404.13076 |
| XMR | When does a second model help?, arXiv 2610.01471: https://arxiv.org/abs/2610.01471 |
| RCAP | Reviewer capability governs rejection targeting, arXiv 2609.04270: https://arxiv.org/abs/2609.04270 |
| OVERCORR | LLM reviewers overcorrect, arXiv 2603.00539: https://arxiv.org/abs/2603.00539 |
| IMPOSSIBLE | ImpossibleBench, arXiv 2510.20270: https://arxiv.org/html/2510.20270v1 |
| SWEV | OpenAI, SWE-bench Verified: https://openai.com/index/introducing-swe-bench-verified/ |

Caveat: XMR, RCAP and OVERCORR are 2026 preprints with small samples (RCAP calls itself "a
controlled pilot"). They are the best direct evidence I could find, and they are still provisional.

---

## 1. Pipeline shapes that measurably improve correctness

### 1.1 Planner/architect + editor split
- **[S] AIDER-ARCH.** o1-preview as architect with o1-mini or DeepSeek as editor scored **85.0%**
  on Aider's editing benchmark, against **79.7%** for o1-preview alone. Sonnet 3.5 paired with itself
  scored **80.5%**; the same page gives **77.4%** for Sonnet alone.
- **[S] AIDER-ARCH.** The page calls DeepSeek "surprisingly effective as an Editor model". The
  cheapest model tested, GPT-4o-mini, scored lowest: 60.2% self-paired and 55.6% alone.
- **Cost [S]:** two model calls per edit. Aider gives no prices, so the saving is **unmeasured**.
- **[I]** The split helps most when the architect is clearly stronger than the editor. A cheap editor
  loses little *if* the plan is concrete enough.

### 1.2 Best-of-N with test-based selection
- **[S] MONKEYS.** On SWE-bench Lite, DeepSeek-Coder-V2 solved **15.9%** with 1 sample and **56%**
  with 250. Where answers can be checked, extra samples pay off. Where they cannot, majority voting
  and reward models plateau after several hundred samples.
- **[S] AGENTLESS ablation (Table 4, SWE-bench Lite).** Choosing among 40 patches by majority vote
  alone resolved **25.67%**. Adding regression tests raised it to **27.00%**, and adding a generated
  reproduction test raised it to **32.00%**. Selection cost per issue was $0.00, $0.01 and $0.25.
  The reproduction test was the largest single gain. Agentless ran end to end for **$0.70** per issue.
- **[S] CODET.** Selecting samples with model-generated tests lifted code-davinci-002 HumanEval
  pass@1 to **65.8%**, which the paper reports as an **18.8-point** absolute gain.
- **[I]** The lesson is that *selection* is the bottleneck, and an executable check is the selector
  that works. Without a reproduction or acceptance test, N > 1 mostly wastes tokens.

### 1.3 Independent cross-model review
Evidence in §3. In short, a second reviewer from a *different* model at a *sufficient* capability
level adds recall, and an LLM reviewer's raw findings carry real false-positive risk.

### 1.4 Adversarial "bug hunt" / refutation pass
- **[S] CC-BP** recommends that "a fresh model try to refute the result", because a fresh-context
  reviewer sees only the diff and the criteria. It also warns that a reviewer asked for gaps "will
  usually report some" even when the work is sound, and says to restrict findings to correctness
  and the stated requirements.
- **[S] ANT-AGENTS** describes *voting* (several prompts review the same code for vulnerabilities)
  and *evaluator-optimizer* loops, which fit when evaluation criteria are clear.
- Measured gain for an adversarial pass on real repos: **unmeasured** in the sources I read.

### 1.5 Test-first with sealed tests
- **[S] AGENTCODER.** Splitting work into separate programmer, test-designer and executor agents
  reached **96.3%** on HumanEval (prior SOTA 90.2%) and **91.8%** on MBPP (78.9%), using fewer
  tokens than the prior SOTA: 56.9K vs 138.2K, and 66.3K vs 206.5K.
- **[S] CC-BP** suggests having "one Claude write tests, then another write code to pass them", and
  for bugs: "write a failing test that reproduces the issue, then fix it."
- **[S] IMPOSSIBLE.** Read-only tests block test modification and keep legitimate performance, but
  they do not stop the other cheating methods. Hiding the tests drives cheating success to near
  zero, at the price of lower legitimate performance. Exact figures were not given.
- **[I]** "Sealed" should mean that the implementer cannot edit the tests (OpenCode `edit` deny on
  test paths), *and* that the orchestrator re-runs the tests from a clean checkout itself.

---

## 2. Where a strong model pays off, and where a cheap one is enough

- **Planning/architecture pays off [S].** In AIDER-ARCH the best scores came from the strongest
  *architect*, and a cheap editor (DeepSeek) matched the best editor at 85.0%.
- **Critique pays off [S].** SELFREPAIR finds self-repair gains "often modest", while feedback from a
  *stronger* model gave substantially larger gains. The quality of the critic is the binding
  constraint.
- **A reviewer needs a capability floor [S].** In RCAP the weakest reviewer changed none of 100
  answers and doubled token cost. A cross-family mid-tier reviewer raised accuracy from 52% to 64%.
  In XMR a "lightweight" cross-model reviewer scored no higher than same-model review.
- **Lead strong, workers cheaper [S].** ANT-MULTI's Opus 4 lead with Sonnet 4 subagents beat a
  single Opus 4 by **90.2%** on Anthropic's research eval, at roughly **15x** chat-level tokens. Token
  usage alone explained **80%** of variance on BrowseComp. ANT-MULTI also says coding has
  "fewer truly parallelizable tasks than research".
- **Implementation can be cheap when the plan and the check are strong [S/I].** The AIDER-ARCH editor
  result is [S]. Generalising it to agentic multi-file work is [I].
- **Conclusion [I].** Spend premium quota on (a) the plan and acceptance criteria, (b) adjudicating
  disputed findings, and (c) hard bugs after cheap attempts fail. Do not spend it on typing code.

---

## 3. Review: cross-model vs self-review, and false positives

- **Self-preference bias exists [S].** SELFPREF: LLM evaluators rate their own outputs above others'
  that humans judge equal, and the bias tracks self-recognition ability.
- **A fresh session already helps [S].** CC-BP says fresh context improves review "since Claude won't
  be biased toward code it just wrote".
- **Cross-model is not automatically better per call [S].** XMR (30 artifacts, 150 planted errors,
  900 sessions): a top-tier cross-model reviewer was *not* significantly different in F1 from a
  fresh same-model review. The two found partly different errors (Jaccard **41.2%**).
- **Mixing models wins with two calls [S].** XMR: one same-model plus one cross-model review found
  **56.7%** of planted errors, against **42.7%** for two same-model reviews (p=.006). That was not
  significantly better than two reviews by the top-tier cross-model reviewer, so capability and
  diversity are confounded.
- **Self-review over-rejects [S].** RCAP (100 math problems, not code): self-review had the highest
  recall (0.85) but falsely rejected **35%** of its own correct answers, against **2%** for a
  cross-family reviewer. Of the 3 false rejections the executor complied with, all 3 became wrong.
- **Reviewers overcorrect, and detailed prompts make it worse [S].** OVERCORR: LLMs misclassify
  correct code as defective, and prompts that demand explanations and fixes *increase* misjudgment.
  Its mitigation is a *fix-guided verification filter*: run the original and the proposed fix
  against tests, and keep the finding only if execution confirms it.
- **The filter rule [S+I].** Accept a review finding as blocking only if it comes with an executable
  witness, meaning a test or input that fails on the branch. Everything else is advisory. The basis
  is OVERCORR, CC-BP's "flag only gaps that affect correctness", and the AGENTLESS evidence that
  execution beats voting. The exact rule is [I].
- **Disagreement [I].** When two reviewers from different families both flag the same line, raise
  its priority. A finding from one reviewer alone needs a witness.

---

## 4. Context handed to workers

- **A brief needs four parts [S].** ANT-MULTI: give each subagent an objective, an output format,
  guidance on tools and sources, and clear task boundaries. Vague briefs led to misread tasks and
  duplicated work.
- **A spec should be self-contained [S].** CC-BP: name the files and interfaces involved, state what
  is out of scope, and end with an end-to-end verification step. Prefer concrete test cases to
  adjectives, and point at an existing pattern file to imitate.
- **Hidden decisions are a failure source [S].** COG: "Actions carry implicit decisions", and parallel
  subagents produced inconsistent work when they could not see each other's choices. Do not
  parallelise pieces that share undecided design.
- **Pre-retrieval vs exploration [S].** ANT-CTX: Claude Code loads CLAUDE.md up front and fetches
  everything else just-in-time with glob/grep ("do the simplest thing that works"). Accuracy falls
  as context grows (context rot). Subagents return 1,000 to 2,000-token summaries. AIDER-MAP sends
  a ranked symbol map of about 1k tokens by default so the model can see structure and ask for
  files. AGENTLESS localizes first (files, then functions, then lines), then repairs.
- **Head-to-head on repo map vs free exploration [S].** I found **no** controlled comparison for
  agentic coding. **Unmeasured.**
- **[I] Recommended brief:** goal (one sentence), acceptance tests (paths, and the exact command to
  run them), files likely to change and files that must not change, one pattern file to imitate,
  constraints (no new dependencies, keep the public API), out of scope, required report format
  (diff summary, the command output proving the tests pass, open questions). Name the exact file
  paths; do not paste whole files. Let the worker explore the rest.

---

## 5. Failure modes of delegated agents, and mitigations

| Failure | Evidence | Mitigation |
| --- | --- | --- |
| Editing or deleting tests to pass | **[S] IMPOSSIBLE:** Claude models used test modification for >79% of their cheating on Conflicting-SWEbench. Opus 4.1 cheated on 50% of those impossible tasks (strict prompt) and GPT-5 on 54% | OpenCode `permission.edit: {"*":"allow","tests/**":"deny"}` [S] OC-PERM. The orchestrator diffs test paths and rejects any change to them [I] |
| Special-casing / operator overloading / stateful hacks | **[S] IMPOSSIBLE** lists these alongside test modification. Read-only tests do not stop them | Held-out acceptance tests the worker never sees, run by the orchestrator. A reviewer prompt that names special-casing as a target [I] |
| More retries, more cheating | **[S] IMPOSSIBLE:** multiple submissions raised open-test pass rate 80% to 83%, and the cheating rate 33% to 38% | Cap the worker's iterations, and treat a pass after many retries with suspicion [I] |
| No exit when the task is impossible | **[S] IMPOSSIBLE:** an "abort / flag for human" option cut GPT-5 cheating from 54% to 9% and o3's from 49% to 12%, with a much smaller effect on Opus 4.1 | Every brief says: "If the spec and the tests conflict, stop and report BLOCKED with the reason." [I] |
| Monitors miss hacks | **[S] IMPOSSIBLE:** LLM monitors caught 86 to 89% of cheating on LiveCodeBench but only 42 to 65% on SWE-bench | Do not rely on an LLM monitor alone. Execution plus a test-path diff is the primary gate [I] |
| Fake success claims | **[S] CC-BP:** have the agent "show evidence rather than asserting success" | Ignore the worker's claim. The orchestrator re-runs the gate in the box [I] |
| Underspecified task / tests too narrow | **[S] SWEV:** annotators screened 1,699 SWE-bench samples for vague issues and for tests that reject valid solutions, and kept 500 | Acceptance tests check behaviour, not one implementation. The brief resolves ambiguity first [I] |
| Scope creep / over-engineering from review | **[S] CC-BP:** chasing every finding leads to "extra abstraction layers, defensive code" | Out-of-scope list in the brief. A diff-path allowlist check. Only witnessed findings block [I] |
| Inconsistent parallel work | **[S] COG** | Parallelise only independent units, or best-of-N on the *same* unit [I] |
| Relative-path / tool errors | **[S] ANT-AGENTS:** requiring absolute paths fixed SWE-bench agent errors | Give absolute paths in briefs [I] |

---

## 6. Proposed role assignment

| Role | Model | Why |
| --- | --- | --- |
| Orchestrator: plan, brief, acceptance tests, gate, merge | **Opus in Claude Code** (outside the Antigravity quota) | §2: the strong model pays off in planning, criteria and adjudication [S]. The quota boundary is [I] |
| Default implementer | `deepseek/deepseek-flash` (`-high` for multi-file work) | Cheap, fast. DeepSeek was an effective *editor* [S] AIDER-ARCH, and the fastest, most precise reviewer here [U] |
| Second-family implementer / best-of-N partner | `gemini-3.8-flash-tiered` | A different family gives diversity (XMR Jaccard 41.2%) [S] |
| Default reviewer | The family that did **not** implement (DeepSeek ↔ Gemini Flash) | Cross-family, above the capability floor [S] RCAP / XMR |
| Deep reviewer, run in background | `antigravity/gemini-3.1-pro-high` | Thorough but 15-18 min [U]. Only for large, security-sensitive or pre-release diffs [I] |
| Escalation implementer | `antigravity/claude-sonnet-4-6` | Quota-limited. For hard pieces after cheap attempts fail [I] |
| Last-resort solver / tie-breaker | `antigravity/claude-opus-4-6-thinking` | Scarcest quota. For a stuck hard bug or a disputed high-severity finding [I] |
| Selector | **Tests, not a model** | AGENTLESS / MONKEYS / CODET [S] |

**Standing rules [I, grounded in §5 S]:** OpenCode workers run with `tests/**` (and any acceptance
path) set to `deny` for `edit`. Every brief contains the BLOCKED exit. The orchestrator re-runs the
gate itself, and the worker's word is never the verdict.

---

## 7. Workflows

### W1. Small fix (one-sentence diff, clear check)
1. Opus writes the brief and names the exact test command. No plan step, per CC-BP's "skip the
   plan" if you can describe the diff in one sentence [S].
2. `deepseek-flash` implements and adds a test.
3. Opus runs the gate: the tests, plus a check that existing test files are untouched.
4. No reviewer unless the change touches auth, data loss, concurrency or a public API. In that case
   `gemini-3.8-flash` reviews.
- **Escalate:** after 2 failed worker rounds, re-brief once with what was learned (CC-BP: after two
  failed corrections, restart with a better prompt [S]), then hand off to W3.

### W2. Feature (multi-file, needs design)
1. **Plan (Opus, orchestrator).** Explore, then write the spec: files, interfaces, out of scope, and
   acceptance tests. Opus or `deepseek-high` writes the tests. Opus confirms they **fail** on base.
   Tests are sealed.
2. **Implement.** `deepseek-high` by default, or `gemini-3.8-flash` for front-end or long-context
   work [I]. Split into parallel units only where the units share no undecided design [S] COG.
3. **Gate.** Opus runs the acceptance and regression tests from a clean checkout and diffs the test
   paths.
4. **Review.** Cross-family flash reviewer, with the prompt limited to correctness and spec gaps
   (§3). Findings need a witness to block.
5. **Fix loop.** The same implementer fixes the witnessed findings. Cap at 2 rounds.
- **Escalate:** if the gate still fails after 2 rounds, `claude-sonnet-4-6` takes over that unit
  with the full failure log.

### W3. Hard bug (unknown cause, flaky, or cross-cutting)
1. **Reproduce first.** `deepseek-high` writes a failing reproduction test. Opus verifies it fails
   for the stated reason. This is the highest-value step in AGENTLESS [S]. Without a reproduction,
   stop and investigate before anything else.
2. **Best-of-N.** 2 to 3 parallel implementers in separate worktrees, from different families:
   `deepseek-max`, `gemini-3.8-flash`, plus `claude-sonnet-4-6` only if one cheap round already
   failed.
3. **Select by execution.** Order: the reproduction test passes, then the fewest regression
   failures, then the smallest diff (AGENTLESS ordering [S], the diff-size tiebreak is [I]). Opus
   reads only the survivors.
4. **Escalate to `claude-opus-4-6-thinking`** only if all N fail twice. Give it the reproduction
   test, the failed diffs and their logs. One attempt.

### W4. Review gate (pre-merge, or reviewing someone else's branch)
1. Run `deepseek-flash` and `gemini-3.8-flash` reviewers in parallel. Both see the diff, the spec
   and the "correctness only" instruction. Combine their findings (XMR mixed-pair result [S]).
2. Add `gemini-3.1-pro-high` in the background only for large, security-relevant or release diffs [I].
3. **Filter.** A finding blocks only with a witness: a test or input that fails on the branch.
   Unwitnessed findings flagged by both families are sent back for a witness. Single-family,
   unwitnessed findings are advisory [I, basis OVERCORR / RCAP].
4. **Adjudicate.** Opus decides disputed findings. `claude-opus-4-6-thinking` is called only for a
   disputed **high-severity** finding that Opus cannot settle by running code.

---

## 8. Quota-saving rule for Antigravity Opus / Sonnet [I]

> **Premium workers are never the first attempt and never write throwaway code.** Sonnet-4-6 is
> used only after a cheap worker has failed the gate twice on the same unit, or for a unit Opus
> rates as hard before starting (concurrency, security, cross-module invariants). Opus-4-6-thinking
> is used only (a) after Sonnet or best-of-N has failed, or (b) to settle a disputed high-severity
> finding. It gets one attempt with a complete failure dossier, and is never used in best-of-N fan-out.
> Planning, acceptance criteria and adjudication stay with the orchestrator, whose quota is
> separate. When Antigravity quota is low, W3 drops Sonnet from the fan-out and widens the cheap
> fan-out (more samples help when a test selects them: MONKEYS [S]).

---

## 8b. Keeping the review and fix loop short (2026-10-14)

Why: Lykos T194 (the v2 e2e, no acceptance test, gate = typecheck) took 9 review rounds and about
4 hours of worker time. Findings per round: 7, 5, 4, 2, 1, 0, then 11 in the final full review and 6
in the next. Two regressions slipped through (hidden tests 95/7 to 98/7). The loop's shape since then
(lib/loop.mjs) follows these sources; M = measured, V = vendor's own report, U = unmeasured.

- **Spec first.** Tests in the prompt: GPT-4 Turbo 69.7 to 82.5% (MBPP) [M] (arXiv 2402.13521).
  Sealed tests with a dispute option: test cheating 54 to 9% (GPT-5) [M] (ImpossibleBench, Lykos
  `research/factories-and-sandboxes-2026.md:383`). The loop refuses a run with no sealed test.
- **One full review, then only the fix.** One pass F1 0.376 against at most 0.303 for any multi-round
  variant; later rounds added 62% more false positives [M] (arXiv 2603.16244). Reflexion-style review
  iteration: recall 27 to 33%, signal-to-noise 5.11 to 1.95 [M] (CR-Bench, arXiv 2603.11078).
  Anthropic's Code Review guidance: after the first review, important findings only [U].
- **A failing test is not proof.** Diff-targeted generated tests: 8 of 41 reported catches were real
  bugs [M] (Meta, arXiv 2601.22832). Hence `basis` and the base check for `regression` findings.
- **Few repair rounds, then start fresh.** No problem fixed on a 5th attempt [M] (Mathews and
  Nagappan); debugging effectiveness falls 60-80% within 2-3 attempts, restarting helps [M, preprint]
  (arXiv 2506.18403); critical vulnerabilities +37.6% after 5 "improvement" rounds [M] (arXiv
  2506.11022).
- **Parallel attempts with test-based selection.** Trae Agent N=3: 61.3 to 66.4 [M]; OpenHands critic
  with early stopping: +17.7 over random at 1.35 attempts on average [M]; CodeMonkeys: selection
  closes about half the gap to the oracle [M]. A mixed-strength pool raised the oracle but not the
  selected score (Trae) [M]: the fresh attempts use the two implementer roles, Opus only selects.
- **Effort: high, not max.** Every timeout and empty patch came at high or xhigh, and xhigh cost about
  2x high per solve on a hard 25-task slice [M, small n] (arXiv 2608.01347).
- **Calibration.** Conclusion before reasoning: verifier precision 63.27 to 77.09% [M] (BitsAI-CR,
  arXiv 2501.15134). Hence the accepted and rejected examples in every review prompt.
- Whether this gets T194-sized changes to 1-3 rounds: **unmeasured** until T194 runs again.

---

## 9. Open questions / unmeasured

- Per-model accuracy of *this* pool on *your* tasks is **unmeasured**. One trial is not a ranking.
  Log every gate result per model and task class, and revisit the assignments.
- Repo map vs free exploration for agentic workers: no primary head-to-head found.
- Gain of an adversarial "bug hunt" pass over a plain review on real repos: **unmeasured**.
- Most of the cross-model review evidence (XMR, RCAP) comes from small 2026 preprints, and RCAP
  uses math rather than code.
