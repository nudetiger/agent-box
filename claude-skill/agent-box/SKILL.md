---
name: agent-box
description: Delegate coding, writing, review, research or bug-hunt work to sandboxed OpenCode workers (Gemini, DeepSeek, Claude Opus, Kimi K3 via OmniRoute), run to-tickets features in ticket mode, benchmark models, read the run ledger, consult a one-pass advisor (Kimi K3), and run the gate yourself. Use when the user asks to delegate, offload, fan out, run tickets, benchmark, get a second review or opinion, debate a design, or hand work to Gemini, DeepSeek, Opus, Kimi, OpenCode, OmniRoute, "the box" or "agent-box".
---

# agent-box

Tool: `<agent-box>/delegate.sh` (Bash). Evidence behind this procedure:
`research/workflow.md`; model and config facts: `research/opencode-customization.md`; roles: `agent-box.conf`,
overridden per project by `ROLE_*` lines in `projects/<repo>.env` (`delegate.sh roles <repo>` shows what is in effect).

**You are the orchestrator.** You plan, write the acceptance test, run the gate and merge. Workers
implement and review. A worker's report is a claim; `summary.json`, the diff and your own test run are
the evidence.

## Preconditions

1. `projects/<repo>.env` holds `OMNIROUTE_API_KEY` (the user fills it; never print it).
2. OmniRoute is running; the engine in `agent-box.conf` is up (`podman machine start`).
3. A recent `delegate.sh baseline <repo>` exists, so pre-existing failures are known.
4. `projects/<repo>.context.yaml` exists for context packs. Without one, workers get no area docs.

## Write the task file (the harness builds the rest)

Frontmatter drives the deterministic context pack (`lib/pack.mjs`): governing docs, traps, glossary
terms, recent history, related tests and the verification command are added automatically. Never paste
them into the task yourself.

```markdown
---
files: [path/the/change/is/about.ts]       # areas, docs, tests and history derive from these
sealed: [path/to/acceptance.test.ts]       # worker cannot edit; harness reverts and flags any change
test: "npx tsx --test path/to/x.test.ts"   # optional; default is the sibling tests of `files`
---
Objective. Required behaviour as a list. What is out of scope. Pattern file to imitate, if any.
```

A type check as `test:` is incremental: `npx --no-install tsc --noEmit --incremental --tsBuildInfoFile
/tmp/tsbuildinfo` (Lykos: 16.3 s plain; incremental 15.4 s first, 5.3-6.8 s after).

Optional frontmatter: `scope: [globs]` (more files the worker may change; the rest is flagged
OUT-OF-SCOPE), `red: false` (skip the check that sealed tests fail on the base; for refactors),
`steps: N` (step budget; use ~25 for trivial work), `issue: N` (the harness fetches the GitHub issue,
its `Spec: #N` issue in full and the issues it cites, on the host, into the task every worker and
reviewer gets; never paste an issue yourself).

Workers can end with `BLOCKED: <reason>`; treat that as information, not failure. Usually it is a
question: answer it with `continue` (below), never by rerunning from scratch.

## Read the verdict, not the report

Every run ends with one line, `verdict <v>  flags <F,...>  next <token>`, and the same in
`summary.json` (`verdict`, `flags`, `next`). Act on `next`:

| next | do |
| --- | --- |
| `review_or_accept` | read the diff; `review` it if non-trivial; then `accept` (or `reject`) |
| `inspect_flags` | read each flag's detail (OUT-OF-SCOPE files, STAND-IN lines, SENSITIVE files, MISREPORT) before anything else |
| `continue_with_failure` | the auto-fix round already ran; `continue` with your own diagnosis, or escalate |
| `answer_question` | `continue -m "<answer and reason>"` |
| `fix_sealed_test` | WEAK-SPEC: your sealed test passes on the base; fix the test, rerun |
| `resolve_test_dispute` | the worker says a sealed test is wrong; read it; fix the test or tell the worker why it stands |
| `triage_findings` | (review runs) check each finding; `continue <impl-run> --findings <rv-run>[:n,m] --drop <rv-run>:k` |
| `read_final_message` | no net change (also when commits cancel out): read `final.md`; often an unflagged contradiction |
| `fix_environment`, `split_or_continue` | setup/quota/network, or a timeout |

After deciding, record it: `delegate.sh accept|reject|merged|discard <repo> <run> --why "..."` (add
`--cause` on a reject). `delegate.sh refs <repo> <run>` lists flags and findings that still need a
reason; label them with `note` (causes: `delegate.sh note` prints them). Obvious causes are labelled
automatically. Never read `ledger/events.jsonl` yourself: `delegate.sh stats json <view>` gives exact
numbers; `stats`/`dash` are the user's dashboard.

## Watching

With herdr running, every run opens a tab in the `agent-box` workspace: the real OpenCode TUI on the
left, the agent-box feed and state (working / blocked / done) on the right. A `loop` also opens its
own tab: rounds, the running step and its time, each finding and where it went, decisions, and what
to do when it stops. Never set `AGENT_BOX_HERDR=0` on a run the user may want to watch. Without herdr:
`delegate.sh loop-watch <repo> <loop>`,
`delegate.sh watch <repo> <run-name>`, `delegate.sh tui <repo> <run-name>`, `delegate.sh stats live`. Record new
measurements (time, steps, tokens, scope, honesty) in `research/findings.md`; never estimate.

## Answering a running worker

Workers have an `ask_orchestrator` tool. For any run longer than a few minutes, start it in the
background, then also start this in the background so you are woken when a question arrives:

```bash
delegate.sh questions <repo> <run-name> --wait   # exit 0: prints the question; exit 1: the run ended
delegate.sh answer <repo> <run-name> <id> -m "<answer, with the reason>"
```

After answering, start `questions --wait` again. Answer within about 10 minutes, or the worker is
told to decide alone. Ask the user when the answer is theirs to give, not yours.

## Talking to a worker again

`delegate.sh continue <repo> <run-name> -m "<answer or next request>"` (or `-f msg.md`) resumes that
worker's own OpenCode session in a fresh container, on its branch, with the same model, sealed files
and test. It keeps everything it read and tried. Result: `agent/<run>-r2`, then `-r3`.

- **BLOCKED question**: answer it in one or two sentences, with the reason.
- **Fix round**: `continue <run> --findings <review-run>[:n,m] --drop <review-run>:k [-m "your own gate failures"]`: the findings go in verbatim and the ledger records forwarded and dropped ones. Prefer this over a cold
  rerun; it reuses what the worker learned.
- **Fork**: continuing an earlier round again gives `-r2b`, so you can try two different answers.
- Select and merge the last round's branch; delete the earlier rounds' branches.

## Workflows

**Research** (instead of reading many files yourself): `explore <repo> "<question>"` returns a digest
with `path:line` evidence; follow up with `continue`.

**Ticket mode** (a `to-tickets` feature dir with `spec.md` and `issues/NN-*.md`):
`feature <repo> <dir> status`, then `feature <repo> <dir> run [--parallel 2]`, or one `ticket` at a
time. Each prints JSON with `next`: `approve` → `land <repo> <last_run>`; `verify_findings` → check
the findings, `continue <last_run> --findings ...`, then `ticket-review <repo> <new-run>`;
`tests_failed` → clarify the ticket/spec and rerun with `--force`; `resolve_test_dispute`,
`gate_failed`, `answer_question` as above. `--auto-land` lands clean tickets by itself. When nothing
is ready: `feature <repo> <dir> report` and hand the manual-test checklist to the user; each bug they
report becomes `defect <repo> <dir> "<title>" "<report>"`.

**Different tasks at once**: `batch <repo> a.md b.md ...` (capped by `AGENT_BOX_SLOTS`, default 4).

**Every coding task: one path.** One worker at a time; no fan-out.
1. Write the task with its spec (a feature also gets a failing acceptance test, sealed and confirmed
   red; commit it on a side branch with `git hash-object`/`commit-tree`).
2. `run --role implement` (Gemini 3.8 Flash high). Trivial edits whose place is known: `--role quick`
   (DeepSeek, 6-8 steps).
3. Act on `next`. A gate failure: `continue` with the failure once; still failing, rerun with
   `--role implement-hard` (DeepSeek, a different family); after two failed rounds `--role escalate`
   (Opus) with the failure history. `no_change`: go straight to `--role implement-hard`; the harness
   has already resumed a turn cut off at the output cap twice (`cut_resumes` in the summary), which is
   how Gemini's "no change" happened on T174b.
4. Non-trivial change, or anything touching the gate, ledger, containment or credentials:
   `loop <repo> <run> [--spec FILE]` (in the background). It refuses a run with no sealed acceptance
   test: write one in step 1 (`--no-spec` only for a pure refactor or docs). Before implementing a
   non-trivial task, ask for spec questions once and rule on all of them up front:
   `explore <repo> "<task text> -- list only what this task leaves undecided" --role review-spec`.
   Round 1, the only full review: review-spec (DeepSeek) and review-std (Opus), both given the spec.
   Each finding carries a reproduction and a `basis`; the harness reruns them on the branch, with the
   existing tests next to the change (failing test names compared with the base). Proven ones join a
   proof suite rerun every round; the fixer gets everything open at once and must run the proofs and
   neighbours green before it ends. After a fix the same reviewer sessions recheck the fix's diff
   (`continue --at`); no final full review. A stall (stuck 2 fixes, a regression or re-broken proof
   after 1, serious after 2 fix rounds, 3 fix rounds, a fix failing its tests) starts fresh attempts
   once, implement and implement-hard in parallel from the base with the proof suite; Opus picks
   between equals. Target 1-3 rounds; 4 reviews at most. Its `next`:
   - `approve` → do your own final check as you see fit, then merge `last`; `notes` are for the
     merge message.
   - `answer_spec` (a reviewer's `spec_question`) → decide it: `loop resume <repo> <loop> --answer
     "..."`. The ruling goes to the worker and to every later reviewer.
   - `triage` (a serious finding with no reproduction, or a finding the worker disputes) → check it
     yourself; `--drop ID` what is wrong, resume with nothing to keep the rest.
   - `answer_question` (the worker is BLOCKED) → `loop resume ... -m "answer"`.
   - `decide` (4 rounds, or a second stall) → read `state.json` and choose: merge with notes, make
     the last small fix yourself, `resume --max-rounds N`, or stop.
   - `fix_environment` / `read_final_message` mid-round (a provider error, an unreadable review) →
     fix the cause, then plain `resume`: the round's review and check run again.
   `resume` also takes `--add FILE` (your own findings) and `-m` (anything else for the worker).
   One review only: `review <repo> agent/<run>`, then `continue <run> --findings <rv-run>`.

**Your own room.** The harness is deterministic so you are not the bottleneck, not so you stay out.
Use your judgement wherever it pays: read any diff, probe the code, run tests, start your own Claude
Code subagents (Opus 5.5 for a hard hunt or a second review), add findings with `resume --add`,
overrule a loop decision, stop a loop and take the work over. Record why with `note`/`accept`/
`reject` so the ledger keeps your decisions.

**Bug**: the same path, with a reproduction test as the sealed acceptance test. When you know where it
lives, write that test yourself. When you do not, you decide how to find it: an Opus 5.5 subagent
(Claude Code Agent tool, model opus) to reproduce, locate and write the failing test, or your own
search for a small one. `hunt` (Gemini Flash) is out of the workflow: on T194 and T174b it added 23-30
minutes and changed neither outcome. Never for tickets.

**Prose**: `--role draft` (Gemini) for drafts, `--role write` (Opus) for docs that ship. Review the
wording against the repo's style rules yourself.

**Second opinion** (design, plan, a contested call): `ask <repo> --prompt q.md [--file ctx ...]`
runs a one-pass advisor with no tools. `advise` is Kimi K3: its $20 ends 2026-10-24, so until then ask
it on every plan and contested call. `advise-alt` is Opus 4.6, the advisor after that date.

**Budget and pools**: Opus+Sonnet share a pool, all Gemini models share one, DeepSeek and Kimi have
their own. Gemini does the bulk; DeepSeek retries, quick edits and spec reviews; Opus standards
reviews, escalation and prose; Opus is never the first coder. Unused: Sonnet (spends Opus's pool),
Composer (misreported tool results, research/findings.md §6). Every worker has a `scout` subagent
(Gemini 3.8 Flash) for searching. Ponytail is loaded by every worker before it writes code.

## Accepting a result

1. Read `git diff <base>..agent/<name>` in full: deleted or weakened tests,
   out-of-scope edits, invented APIs.
2. Rerun the verification on the host.
3. Cherry-pick or merge under the repo's own commit rules (author, message, trailers). Delete rejected
   branches (`git branch -D agent/<name>`) and say why.
4. `delegate.sh clean` after an interrupted run. Never edit `delegate.sh` while a run is executing it.
