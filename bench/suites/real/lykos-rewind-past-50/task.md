---
files: [lykos/loop/checkpoint.ts]
test: "npx tsx --test lykos/loop/checkpoint.test.ts"
---
# Rewind cannot reach a checkpoint older than the 50th

`restoreCheckpoint(deps, index)` fails for any index of 50 or more, even when the checkpoint ref holds
that many commits, and its error then reports 50 as the number of checkpoints.

- Every index the ref actually has must be restorable.
- When the index is past the end, the error states the ref's true number of checkpoints.
- Do not read more of the ref's history than the requested index needs.
