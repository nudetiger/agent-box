---
files: [src/text.ts]
test: "node --test test/text.test.ts test/table.test.ts test/cli.test.ts"
---
# `truncate` returns text wider than it was asked for

`truncate(s, max)` in `src/text.ts` should fit `s` into `max` characters and mark a cut with an
ellipsis (`…`). When it cuts, the result is one character too wide: `truncate("abcdefgh", 5)` returns
`"abcde…"`, six characters. Tables printed with `--max-width 10` come out with columns 11 wide.

Fix it so the result is never wider than `max`. Text that already fits must come back unchanged.
