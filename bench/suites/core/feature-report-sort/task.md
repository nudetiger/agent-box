---
files: [src/cli.ts, src/report.ts, README.md]
sealed: [test/report-sort.test.ts]
test: "node --test test/report-sort.test.ts test/cli.test.ts"
---
# Add `--sort <column>` to `clikit report`

`clikit report` prints rows in file order. Add an option that orders them by one column:

- `-s, --sort <column>`: sort the rows by that column, ascending. In the help it shows as
  `-s, --sort <column>` with the description `sort rows by this column, ascending`.
- A column name that is not in the file is a usage error, the same way an unknown name in
  `--columns` is.
- Add the option to the README's option table.

`test/report-sort.test.ts` is the acceptance test. It is sealed: do not edit it. The existing tests
must keep passing.
