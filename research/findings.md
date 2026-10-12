# Findings: measured behaviour of agent-box and its workers

Measured facts only, each with its date and sample size. One run is an anecdote, not a rate. Nothing
here is backfilled or estimated; "unmeasured" means unmeasured. Keep it that way: this file is the
baseline Lykos (as an MCP worker) will be compared against.

## How to compare a harness against this one

Run the same task file, at the same base commit, through both. Record per run:

| metric | where agent-box keeps it |
| --- | --- |
| correct (gate passes on the host) | your own test run; `summary.json` `test_exit` is the harness's |
| wall time, agent time | `summary.json` `seconds`; first to last event in `events.jsonl` |
| model steps, tool calls | `step_start` / `tool_use` events in `events.jsonl` |
| tokens: input, cached, output+reasoning | `step_finish` `tokens` in `events.jsonl` |
| diff size and scope | `diffstat.txt`; edits outside `files:` by reading the diff |
| honesty | the final message's test claim against `test.log` |
| questions asked, BLOCKED | `summary.json` `questions`, `blocked` |

The per-run table below comes from this jq over `events.jsonl`:

```bash
jq -rs '[.[]|select(.type=="step_start" or .type=="tool_use")] as $e
 | ($e|map(select(.type=="step_start"))|length) as $steps
 | ([$e[]|select(.type=="tool_use")|((.part.state.time.end//0)-(.part.state.time.start//0))]|add//0|./1000) as $tool
 | (($e[-1].timestamp-$e[0].timestamp)/1000) as $wall
 | "steps=\($steps) agent=\($wall)s tools=\($tool)s model_per_step=\(($wall-$tool)/$steps)s"' events.jsonl
```

## 1. Where the time goes (2026-10-12, 16 Lykos runs)

The delay between tool calls is model time. Model seconds per step = (agent time minus tool time) / steps.

| run | model | steps | agent s | tool s | model s/step |
| --- | --- | --- | --- | --- | --- |
| dual-feature | gemini-3.8-flash-tiered | 32 | 563 | 223 | 10.6 |
| rv-…-review-alt | gemini-3.8-flash-tiered | 31 | 393 | 67 | 10.5 |
| rv-feature | gemini-3.8-flash-tiered | 88 | 808 | 24 | 8.9 |
| stale-implement | gemini-3.8-flash-tiered | 21 | 224 | 49 | 8.3 |
| w2-context-research | gemini-3.8-flash-tiered | 24 | 121 | 9 | 4.6 |
| rv-review | antigravity/gemini-3.1-pro-high | 84 | 997 | 163 | 9.9 |
| smoke-gemini | antigravity/gemini-3.1-pro-high | 33 | 263 | 35 | 6.9 |
| rv-…-review | deepseek/deepseek-flash | 23 | 294 | 86 | 9.0 |
| rv-implement | deepseek/deepseek-flash | 24 | 179 | 20 | 6.6 |
| dual-implement | deepseek/deepseek-flash | 14 | 211 | 134 | 5.4 |
| w1-context-map | antigravity/claude-sonnet-4-6 | 15 | 82 | 1 | 5.4 |
| stale-implement-alt | cu/composer-2.5-fast | 27 | 85 | 18 | 2.4 |
| smoke-deepseek | deepseek/deepseek-v4-pro-high | 9 | 39 | 13 | 2.8 |
| smoke-luna | cx/gpt-5.6-luna | 12 | 42 | 8 | 2.8 |
| rv-easy | cx/gpt-5.6-luna-xhigh | 4 | 15 | 1 | 3.4 |
| rv-write | cx/gpt-5.6-terra-medium | 3 | 9 | 2 | 2.4 |

Gemini 3.8 Flash 4.6–10.6 s per step, DeepSeek Flash 5.4–9.0, Composer 2.4. Every step resends the
whole context, so the number of steps drives both time and tokens.

## 2. Step count on a trivial task (2026-10-12, RakunMiniItems, one run each)

Task: add one Javadoc sentence to `CloseMatcher.of`. All diffs were one line, all tests green.

| run | harness | tool calls | total s | input tokens (uncached + cached) |
| --- | --- | --- | --- | --- |
| Gemini 3.8 Flash medium | before speed changes | 66 | 546 | 288k + 2.37M |
| Gemini 3.8 Flash medium | after (agent-box 752dd12) | 50 | 345 | 216k + 2.62M |
| Composer 2.5 fast (`quick`) | after | 19 | 77 | 590k + 0 |
| Composer 2.5 fast (`quick`) | after, herdr test | 32 | 129 | 1.31M + 0 |

- Speed changes: small named files pasted into the pack, Ponytail/box-verify rules in the preamble
  instead of skill loads, `gradlew` made executable, Gradle daemon inside the container. Tool time
  fell 79 s → 27 s.
- Gemini still read stat/config/command classes and ADRs for a one-line comment, and re-read the
  file the pack had pasted. Instructions alone did not stop it.
- Composer through Cursor showed no cached tokens in either run. Its two runs on the same task
  differed by 13 calls.

## 3. Correctness and behaviour, by model

| date | task | model | outcome |
| --- | --- | --- | --- |
| 2026-10-12 | Lykos dual-loopback fix (fan-out) | DeepSeek Flash | passed sealed test, 326 s; picked (smaller diff) |
| 2026-10-12 | same | Gemini 3.8 Flash | passed, 669 s |
| 2026-10-12 | Lykos comment fix (fan-out) | Gemini 3.8 Flash | passed, 280 s; picked (tighter diff) |
| 2026-10-12 | same | Composer 2.5 fast | passed, 134 s; reworded a line it was told to keep |
| 2026-10-12 | Lykos review of the dual-loopback branch | DeepSeek Flash | no false findings; proved the sealed test red on the base unprompted |
| 2026-10-12 | Lykos context map | Sonnet 4.6 | usable map; found real doc/code disagreements |
| 2026-10-12 | Lykos reviews | Gemini 3.1 Pro high | thorough, 15–18 min |
| 2026-10-12 | RakunMiniItems Javadoc (ask tool) | Gemini 3.8 Flash | followed an answer that contradicted its stated preference; replaced a 7-line Javadoc with 1 line (scope) |
| 2026-10-12 | RakunMiniItems Javadoc | Composer 2.5 fast | twice broke the file with a whole-file write, then repaired it with `git checkout`/`sed`; final diff correct both times |

Scope creep seen: Composer once, Gemini once. Misreported test results: none seen (not yet checked
mechanically).

## 4. Harness facts

- Session resume (`continue`) works: a resumed Gemini worker edited without re-reading the file and
  recalled its round-1 reading (155,619 cached tokens on resume). Runs before agent-box d58623f have
  no saved session.
- Mid-run questions: a Gemini worker asked once, got an empty 45 s tool reply, called
  `wait_for_answer`, received the answer 70 s after asking.
- OpenCode emits a `tool_use` event only when the call completes, so a live view sees a question only
  after the first 45 s wait returns.
- RakunMiniItems cold setup (Gradle, JDK 25 toolchain, dependencies into the cache volume): 197 s.
  Warm setup: 12–14 s.
- Engine (one Lykos suite each): Docker 504 s, Podman 653 s; Podman uses ~13 MB on the Windows side
  idle vs Docker Desktop ~770 MB.

## 5. Model availability through OmniRoute (2026-10-12)

- DeepSeek effort tiers: `none`, `low`, `high`, `max`. `deepseek-flash-xhigh` is rejected.
- `cursor/cursor-grok-4.6-*` and `gpt-5.6-sol-*`: Cursor upstream `not_found`.
- `cx/*` (Codex): "invalidated oauth token"; single-pass chat only, excluded from coding.
- OmniRoute drops `reasoning_effort` for `antigravity/claude-*`.

## Unmeasured

Token budget per 5 hours; review precision and recall beyond the cases above; misreport rate; any
rate (all figures are 1–5 runs).
