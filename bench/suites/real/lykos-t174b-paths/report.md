In a contained session on Windows, commands the model writes get Windows paths translated to
container paths (`C:\Users\dev\proj\...` to `/work/...`). For a quoted string that contains a space,
the translation guesses from the string's letters whether it is a host path, and it guesses wrong.

Workspace `C:\Users\dev\proj`, and none of the folders below exists yet on the host:

- **A real path is missed.** `mkdir -p "C:\Users\dev\proj\new dir\a"` becomes
  `mkdir -p "/work/new dir\a"`. The same happens for any new one-letter folder named a, b, f, n, r,
  t, v or 0. In bash double quotes `\a` and `\n` are not escapes.
- **Text that is not a path is changed.** `printf "C:\Users\dev\proj\out.txt done\nnext"` becomes
  `printf "/work/out.txt done/nnext"`, and `printf "C:\Users\dev\proj\a b\tc"` becomes
  `printf "/work/a b/tc"`: the newline and the tab are lost.
- **Free text is translated.** `git commit -m "C:\Users\dev\proj\k is broken"` stores
  `/work/k is broken` in the repository.

## Expected

The command around a quoted string decides what it is, not its letters. Through the translator's
public `toContainer`:

- **Path rule.** A quoted argument of a file command (`mkdir`, `cd`, `cat`, `cp`, `mv`, `rm`,
  `touch`, `ls`, `tee`, and the like) is a path, one-letter folders included:
  `mkdir -p "C:\Users\dev\proj\new dir\n"` becomes `mkdir -p "/work/new dir/n"`. The command that
  owns an argument is the same behind an assignment, `sudo` or a pipe (`X=1 sudo rm "..."`,
  `echo hi | tee "..."`). The target of a redirection (`>`, `>>`, `2>>`, `<`) is a path whatever the
  command.
- **Text rule.** A quoted argument of `printf` or `echo -e` is text and is kept exactly as written,
  with or without a space in it, and wherever a path sits inside it.
- **Message rule.** The message of `-m`, `-am`, `--message` or `--message=` is text, kept exactly,
  but only for `git commit`, `git tag`, `git merge` and `git stash` (for example `git stash push`).
  The subcommand is the first word after git's own options, so `git -C . commit -m "..."` and
  `git -c user.name=x commit -m "..."` are messages, while `git log --grep commit -m "..."` is not.
  `-m` of other tools (`git log -m`, `git grep -m`, `python -m`) is not a message.
- Anything else keeps today's behaviour. A plain `echo` is neither a file nor a text command.
  Unquoted paths, and paths outside a text string in the same command line, are still translated:
  `printf "x" C:\Users\dev\proj\src` becomes `printf "x" /work/src`.
- Text set aside while translating is put back exactly, whatever the input holds.

Write the rule, and the cases it still gets wrong, in `docs/reference/cli-and-config.md` next to the
T174 paragraph. Keep `npm run typecheck` clean. Do not run the full `npm test`; run the test files
you touch.
