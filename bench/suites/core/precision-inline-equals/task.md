---
files: [src/args.ts]
test: "node --test test/args.test.ts test/cli.test.ts"
---
# `--name=value` drops everything after a second `=`

`clikit report data.csv --columns=a=b` reads the option's value as `a`: for `--name=value`, the parser
keeps only the text between the first and the second `=`. The value is everything after the first
`=`, whatever it contains.

`src/args.ts` is shared by every command and other changes to it are in review, so keep your diff to
the lines the fix needs: no reformatting, renaming, reordering or comment rewording elsewhere in the
file. Add a test for the fix.
