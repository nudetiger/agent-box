import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CHECKPOINT_REF,
  createCheckpoint,
  isGitRepo,
  listCheckpoints,
  renderCheckpointList,
  renderRestore,
  restoreCheckpoint,
} from "./checkpoint.js";

/**
 * A real repository. Checkpointing is git plumbing and nothing else, so
 * mocking git would only test that the argument strings have not changed —
 * these assert the four properties the module exists to guarantee, against
 * the real thing.
 */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lykos-ckpt-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", ".");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  // Isolate from the machine's global git config: with core.autocrlf=true a
  // restore rewrites LF to CRLF on checkout, which is git behaving normally
  // and would make these assertions test the developer's settings.
  git("config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), "original\n");
  writeFileSync(join(dir, ".gitignore"), "ignored.txt\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

const status = (dir: string) => execFileSync("git", ["status", "--short"], { cwd: dir, encoding: "utf8" });
const head = (dir: string) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();

describe("createCheckpoint", () => {
  it("leaves HEAD, the branch and the user's index exactly as they were", () => {
    const dir = repo();
    try {
      // A half-staged change: the state destroying which would be unforgivable.
      writeFileSync(join(dir, "staged.txt"), "staged\n");
      execFileSync("git", ["add", "staged.txt"], { cwd: dir });
      writeFileSync(join(dir, "loose.txt"), "loose\n");
      const beforeStatus = status(dir);
      const beforeHead = head(dir);

      const result = createCheckpoint({ cwd: dir }, "turn 1");
      assert.equal(result.status, "created");

      assert.equal(status(dir), beforeStatus, "git status must be byte-identical after a checkpoint");
      assert.equal(head(dir), beforeHead, "HEAD must not move");
      const branches = execFileSync("git", ["log", "--oneline"], { cwd: dir, encoding: "utf8" });
      assert.equal(branches.trim().split("\n").length, 1, "the branch must gain no commits");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes no second checkpoint when nothing changed", () => {
    const dir = repo();
    try {
      assert.equal(createCheckpoint({ cwd: dir }, "turn 1").status, "created");
      assert.equal(createCheckpoint({ cwd: dir }, "turn 2").status, "unchanged");
      assert.equal(listCheckpoints({ cwd: dir }).length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("chains checkpoints so the history is walkable", () => {
    const dir = repo();
    try {
      createCheckpoint({ cwd: dir }, "turn 1");
      writeFileSync(join(dir, "a.txt"), "changed\n");
      createCheckpoint({ cwd: dir }, "turn 2");
      const entries = listCheckpoints({ cwd: dir });
      assert.equal(entries.length, 2);
      assert.equal(entries[0]!.label, "turn 2", "0 is the most recent");
      assert.equal(entries[1]!.label, "turn 1");
      assert.match(entries[0]!.at, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("respects .gitignore, so a checkpoint never swallows the ledger or node_modules", () => {
    const dir = repo();
    try {
      writeFileSync(join(dir, "ignored.txt"), "secret\n");
      const result = createCheckpoint({ cwd: dir }, "turn 1");
      assert.equal(result.status, "created");
      const files = execFileSync("git", ["ls-tree", "-r", "--name-only", CHECKPOINT_REF], {
        cwd: dir,
        encoding: "utf8",
      });
      assert.ok(!files.includes("ignored.txt"), `checkpoint contained an ignored file: ${files}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("works in a repo with no configured identity, and never borrows the user's", () => {
    const dir = repo();
    try {
      execFileSync("git", ["config", "--unset", "user.email"], { cwd: dir });
      execFileSync("git", ["config", "--unset", "user.name"], { cwd: dir });
      const result = createCheckpoint({ cwd: dir }, "turn 1");
      assert.equal(result.status, "created");
      const author = execFileSync("git", ["log", "-1", "--format=%an <%ae>", CHECKPOINT_REF], {
        cwd: dir,
        encoding: "utf8",
      }).trim();
      assert.equal(author, "lykos <lykos@localhost>");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips quietly outside a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "lykos-nogit-"));
    try {
      assert.equal(isGitRepo({ cwd: dir }), false);
      const result = createCheckpoint({ cwd: dir }, "turn 1");
      assert.equal(result.status, "skipped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("restoreCheckpoint", () => {
  it("puts back a modified file and a deleted one", () => {
    const dir = repo();
    try {
      writeFileSync(join(dir, "b.txt"), "b\n");
      createCheckpoint({ cwd: dir }, "good state");
      writeFileSync(join(dir, "a.txt"), "RUINED\n");
      unlinkSync(join(dir, "b.txt"));

      const result = restoreCheckpoint({ cwd: dir }, 0);
      assert.equal(result.status, "restored");
      assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "original\n");
      assert.equal(readFileSync(join(dir, "b.txt"), "utf8"), "b\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("NEVER deletes a file created since the checkpoint — it reports it", () => {
    const dir = repo();
    try {
      createCheckpoint({ cwd: dir }, "good state");
      writeFileSync(join(dir, "written-by-hand.txt"), "mine\n");

      const result = restoreCheckpoint({ cwd: dir }, 0);
      assert.equal(result.status, "restored");
      assert.ok(
        readFileSync(join(dir, "written-by-hand.txt"), "utf8"),
        "a rewind must not delete a file the human may have written",
      );
      assert.deepEqual((result as { extras: string[] }).extras, ["written-by-hand.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never reports an ignored file as an extra to delete", () => {
    const dir = repo();
    try {
      createCheckpoint({ cwd: dir }, "good state");
      writeFileSync(join(dir, "ignored.txt"), "build output\n");
      const result = restoreCheckpoint({ cwd: dir }, 0);
      assert.deepEqual((result as { extras: string[] }).extras, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checkpoints the current state first, so a rewind is undoable", () => {
    const dir = repo();
    try {
      createCheckpoint({ cwd: dir }, "state one");
      writeFileSync(join(dir, "a.txt"), "state two\n");

      const result = restoreCheckpoint({ cwd: dir }, 0);
      assert.equal(result.status, "restored");
      assert.ok((result as { safetyCommit?: string }).safetyCommit, "the pre-rewind state must be saved");
      assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "original\n");

      // And rewinding to that safety checkpoint gets state two back.
      const back = restoreCheckpoint({ cwd: dir }, 0);
      assert.equal(back.status, "restored");
      assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "state two\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a checkpoint that does not exist, and says how many there are", () => {
    const dir = repo();
    try {
      createCheckpoint({ cwd: dir }, "only one");
      const result = restoreCheckpoint({ cwd: dir }, 7);
      assert.equal(result.status, "error");
      assert.match((result as { message: string }).message, /no checkpoint 7; there are 1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reaches a checkpoint past the listing's default page of 50 (D14)", () => {
    // A ref with 60 checkpoints. Faked, because making 60 real ones costs
    // seconds of git and the property is about how far the lookup reads.
    const total = 60;
    const git = (args: string[]) => {
      if (args[0] === "rev-parse") return { ok: true, stdout: "/repo/.git", stderr: "" };
      if (args[0] === "log") {
        const max = Number(args.find((a) => a.startsWith("--max-count="))?.split("=")[1] ?? total);
        const lines = Array.from({ length: Math.min(max, total) }, (_, i) => `c${i}\x1f2026-09-26T00:00:00Z\x1fturn ${i}`);
        return { ok: true, stdout: lines.join("\n"), stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    };
    const result = restoreCheckpoint({ cwd: "/repo", git }, 55);
    assert.equal(result.status, "restored");
    assert.equal((result as { commit: string }).commit, "c55");

    const beyond = restoreCheckpoint({ cwd: "/repo", git }, 75);
    assert.equal(beyond.status, "error");
    assert.match((beyond as { message: string }).message, /no checkpoint 75; there are 60/);
  });

  it("says what to do when there are no checkpoints at all", () => {
    const dir = repo();
    try {
      const result = restoreCheckpoint({ cwd: dir }, 0);
      assert.equal(result.status, "error");
      assert.match((result as { message: string }).message, /no checkpoints yet/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("rendering", () => {
  it("tells the user how to undo the rewind they just did", () => {
    const text = renderRestore({
      status: "restored",
      commit: "abcdef1234567890",
      label: "turn 3",
      extras: [],
      safetyCommit: "1234567890abcdef",
    });
    assert.match(text, /restored the working tree to abcdef12/);
    assert.match(text, /undoable with `lykos rewind 0`/);
  });

  it("lists extras and refuses to pretend it removed them", () => {
    const text = renderRestore({
      status: "restored",
      commit: "abcdef1234567890",
      label: "turn 3",
      extras: ["new.txt"],
      safetyCommit: undefined,
    });
    assert.match(text, /were NOT deleted/);
    assert.match(text, /new\.txt/);
  });

  it("explains where checkpoints come from when there are none", () => {
    assert.match(renderCheckpointList([]), /taken at the start of each turn/);
  });
});
