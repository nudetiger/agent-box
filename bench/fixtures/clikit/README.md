# clikit

Prints CSV files as aligned plain-text tables. No dependencies; Node 24 runs the TypeScript sources
directly.

```bash
node src/main.ts report stock.csv --columns name,qty --limit 10
npm test
```

## `clikit report <file>`

| option | meaning |
| --- | --- |
| `-c, --columns <list>` | comma-separated columns to show, in order |
| `-n, --limit <n>` | show at most this many rows |
| `--max-width <n>` | cut cells wider than this (default 24) |
| `-h, --help` | show the command's help |

Numeric columns (every non-empty cell is a number) are right-aligned. Usage errors print one line to
stderr and exit with code 2.

## Layout

| file | what |
| --- | --- |
| `src/args.ts` | argument parser shared by every command |
| `src/csv.ts` | RFC 4180 CSV reader |
| `src/text.ts` | width, padding and truncation of plain text |
| `src/table.ts` | aligned table output |
| `src/report.ts` | the `report` command's logic |
| `src/help.ts` | help text generated from a command's spec |
| `src/cli.ts` | command table and `run(argv, io)`; no direct process or file access |
| `src/main.ts` | process entry point |
