An untrusted project can still run its own commands on my host.

Lykos already refuses an untrusted project's extensions, its Pi packages and its `!command`
credentials. But a workspace that ships its own Lykos config (`.lykos/config.yaml`) still gets
commands run on the host, without anybody trusting the project. Seen in a delegated session with
`containment.level: off`, in a project that is not trusted in the user-level trust store:

- a `hooks:` entry with a `command:` runs after the matching tool call;
- `feedback.command` runs after an edit, and so does the check Lykos discovers by itself from the
  project's `package.json` scripts (for example `npm run typecheck --silent`);
- `gate.command` and `gate.rerun_command` run when the gate verifies;
- an `lsp.servers.<name>.command` is started;
- `eval.python` picks the project's interpreter.

Also, the project's config can set `containment.level` lower than what my own config gives, for
example `off`, and the session uses it.

A workspace handed to Lykos must not be able to run its own code on my host.

## Expected

"Trusted" means trusted in the user-level trust store. The one-run trust flag (trust source `flag`)
passes the trust gate but trusts nothing, so for it the commands stay withheld too.

For a project that is not trusted, every command field the **project layer** set is dropped (the
user's and the global layer's value for that field, if any, is used instead), and each one dropped
is listed in the result's `skippedExtensions`, in this form:

- `project hooks[0] (post_tool): command withheld` (index and event of the hook)
- `project feedback.command withheld`
- `project gate.command withheld`
- `project gate.rerun_command withheld`
- `project lsp.servers.<name>: command withheld`
- `project eval.python withheld`
- a check discovered from the project's own files: `project post-edit check "<the command>" (discovered from the project) withheld`

Containment: the project layer may raise `containment.level`, never lower it. A lower project level
is ignored and recorded as `project containment.level: <its level> withheld (kept <the level used>)`.
Only the user's own config or the caller may choose `off`.

User-layer and global-layer commands run as today, trusted or not. A project trusted in the store
behaves exactly as today, with nothing skipped.

Fix it everywhere a project's own command can reach the host, not only in the cases listed above.
Keep `npm run typecheck` clean. Do not run the full `npm test`; run the test files you touch.
