#!/usr/bin/env bash
# Runs only the test files the worker added or changed since the base, with the project's single-file
# test command. Ticket mode uses it as the test writer's test command: those tests must fail (red).
#   changed-tests.sh '<test_file_command with {files}, {tests} or {dirs}>' <ERE> [<ERE>...]
# Exits 0 with a note when no test file changed (mode none). {tests} becomes Gradle --tests filters,
# {dirs} the files' directories as ./dir (go test {dirs}).
set -uo pipefail
cmd="$1"; shift
pats=(); for p in "$@"; do pats+=(-e "$p"); done
mapfile -t files < <(git diff --name-only --diff-filter=AM "${BASE_SHA:?}"..HEAD | grep -E "${pats[@]}")
if [ "${#files[@]}" -eq 0 ]; then echo "changed-tests: no test files changed since the base"; exit 0; fi
echo "changed-tests: ${files[*]}"
tests="$(printf '%s\n' "${files[@]}" | grep '^src/test/java/.*\.java$' | sed 's|^src/test/java/||; s|\.java$||; s|/|.|g; s|^|--tests |' | tr '\n' ' ')"
dirs="$(printf '%s\n' "${files[@]}" | sed -E 's|^[^/]*$|.|; s|^(.+)/[^/]*$|./\1|' | sort -u | tr '\n' ' ')"
cmd="${cmd//\{files\}/"${files[*]}"}"
cmd="${cmd//\{tests\}/"$tests"}"
cmd="${cmd//\{dirs\}/"${dirs% }"}"
echo "changed-tests: $cmd"
exec bash -lc "$cmd"
