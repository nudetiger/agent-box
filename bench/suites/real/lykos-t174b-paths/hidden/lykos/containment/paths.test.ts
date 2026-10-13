// T174 (spec #22): the path translation a contained session's commands go through.
// Pure: a workspace string in, text out, so every drive-letter form is covered on any host.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathTranslator } from "./paths.js";

describe("pathTranslator on a Windows workspace", () => {
  // What exists on the "host": the files a quoted path with a space may name.
  const onHost = new Set(["C:\\Users\\dev\\proj", "C:\\Users\\dev\\proj\\my dir", "C:\\Users\\dev\\proj\\my dir\\f.txt"]);
  const t = pathTranslator("C:\\Users\\dev\\proj", (p) => onHost.has(p));

  it("maps every drive-letter form of a workspace path in a command to /work", () => {
    for (const form of [
      "C:\\Users\\dev\\proj\\src\\a.ts",
      "C:/Users/dev/proj/src/a.ts",
      "/c/Users/dev/proj/src/a.ts",
      "c:\\users\\DEV\\proj\\src\\a.ts",
    ]) {
      assert.equal(t.toContainer(`cat ${form}`), "cat /work/src/a.ts", form);
    }
    assert.equal(t.toContainer('cat "C:\\\\Users\\\\dev\\\\proj\\\\src\\\\a.ts"'), 'cat "/work/src/a.ts"', "doubled backslashes inside a string");
  });

  it("maps the workspace root itself, wherever it appears in the line", () => {
    assert.equal(
      t.toContainer("cd C:\\Users\\dev\\proj && ls C:/Users/dev/proj; echo '/c/Users/dev/proj'"),
      "cd /work && ls /work; echo '/work'",
    );
  });

  it("leaves other paths alone, including look-alike siblings and paths merely containing the workspace", () => {
    for (const same of [
      "cat C:\\Users\\dev\\proj2\\a.ts",
      "cat C:\\Users\\dev\\proj-old\\a.ts",
      "cat C:\\Users\\dev\\other\\a.ts",
      "cat D:\\Users\\dev\\proj\\a.ts",
      "cat /c/Users/dev/projects/a.ts",
      "cat /mnt/c/Users/dev/proj/a.ts",
      "cat src/a.ts",
    ]) {
      assert.equal(t.toContainer(same), same);
    }
  });

  it("maps /work paths in output to the host path, and leaves look-alikes alone", () => {
    assert.equal(
      t.toHost("error in /work/src/a.ts:3:5\nat (/work/lib/b.js)\ncwd=/work\n"),
      "error in C:\\Users\\dev\\proj\\src\\a.ts:3:5\nat (C:\\Users\\dev\\proj\\lib\\b.js)\ncwd=C:\\Users\\dev\\proj\n",
    );
    for (const same of ["/workspace/x", "/network/work/x", "/work2/x", "/usr/work", "a/work/b", "https://x.test/work/a"]) {
      assert.equal(t.toHost(same), same);
    }
  });

  it("a path split across chunks of output is translated whole", () => {
    const stream = t.hostStream();
    const out = [stream.write("saw /wo"), stream.write("rk/src/a.ts and /wor"), stream.write("k"), stream.end()].join("");
    assert.equal(out, "saw C:\\Users\\dev\\proj\\src\\a.ts and C:\\Users\\dev\\proj");
  });

  it("translates every path in a colon- or comma-joined list, both ways", () => {
    assert.equal(
      t.toHost("PATH=/work/bin:/work/node_modules/.bin:/usr/bin"),
      "PATH=C:\\Users\\dev\\proj\\bin:C:\\Users\\dev\\proj\\node_modules\\.bin:/usr/bin",
    );
    assert.equal(t.toHost("/work/a,/work/b"), "C:\\Users\\dev\\proj\\a,C:\\Users\\dev\\proj\\b");
    assert.equal(t.toContainer("cat C:\\Users\\dev\\proj\\a,C:\\Users\\dev\\proj\\b"), "cat /work/a,/work/b");
    assert.equal(t.toContainer("NODE_PATH=C:/Users/dev/proj/lib:C:/Users/dev/proj/vendor:/opt"), "NODE_PATH=/work/lib:/work/vendor:/opt");
  });

  it("where the command does not say, a quoted string with an escape is a path only if the host says so", () => {
    // A plain `echo` is neither a file command nor a text command. `\n` reads as a separator in text; neither path nor
    // its directory exists, so the string is not read as one path: only the path at its start is translated.
    assert.equal(t.toContainer('echo "C:\\Users\\dev\\proj\\out.txt done\\n"'), 'echo "/work/out.txt done\\n"');
    assert.equal(t.toContainer('echo "C:\\Users\\dev\\proj\\a b\\$HOME"'), 'echo "/work/a b\\$HOME"');
    // Even where every probe says yes, a segment with `$` or a backtick is not part of a path.
    const yes = pathTranslator("C:\\Users\\dev\\proj", () => true);
    assert.equal(yes.toContainer('cat "C:\\Users\\dev\\proj\\a b\\$HOME"'), 'cat "/work/a b\\$HOME"');
    assert.equal(yes.toContainer('cat "C:\\Users\\dev\\proj\\a b\\`x`"'), 'cat "/work/a b\\`x`"');
    // A file that does not exist yet in a directory that does is still a path.
    assert.equal(t.toContainer('cat "C:\\Users\\dev\\proj\\my dir\\new file.txt"'), 'cat "/work/my dir/new file.txt"');
  });

  it("a quoted path whose nearest existing ancestor is inside the workspace is a path, however much of it is new", () => {
    onHost.add("C:\\Users\\dev\\proj\\docs");
    assert.equal(
      t.toContainer('mkdir -p "C:\\Users\\dev\\proj\\docs\\new folder\\img"'),
      'mkdir -p "/work/docs/new folder/img"',
    );
    // With only the workspace root to go on, an unknown command's escape is not a folder.
    assert.equal(t.toContainer('echo "C:\\Users\\dev\\proj\\new dir\\n"'), 'echo "/work/new dir\\n"');
  });

  it("every separator in a path under the workspace becomes /, whether or not its folders exist yet", () => {
    // Nothing below the workspace root exists: only the shape of the string says this is a path.
    assert.equal(t.toContainer('mkdir -p "C:\\Users\\dev\\proj\\new dir\\sub"'), 'mkdir -p "/work/new dir/sub"');
    assert.equal(t.toContainer("mkdir -p 'C:/Users/dev/proj/new dir/sub/deeper'"), "mkdir -p '/work/new dir/sub/deeper'");
    assert.equal(t.toContainer("mkdir -p C:\\Users\\dev\\proj\\new\\sub"), "mkdir -p /work/new/sub");
  });

  // T174b. The command around a quoted string says what it is; its letters do not.
  describe("a quoted string's command says whether it is a path (T174b)", () => {
    it("path rule: an argument of a file command is a path, even through a one-letter folder", () => {
      for (const letter of ["a", "b", "f", "n", "r", "t", "v", "0"]) {
        assert.equal(
          t.toContainer(`mkdir -p "C:\\Users\\dev\\proj\\new dir\\${letter}"`),
          `mkdir -p "/work/new dir/${letter}"`,
          letter,
        );
      }
      assert.equal(t.toContainer('cp "C:\\Users\\dev\\proj\\x y\\n" "C:\\Users\\dev\\proj\\z w\\t"'), 'cp "/work/x y/n" "/work/z w/t"');
      assert.equal(
        t.toContainer('cd "C:\\Users\\dev\\proj\\q r" && touch "C:\\Users\\dev\\proj\\q r\\b"'),
        'cd "/work/q r" && touch "/work/q r/b"',
      );
      // Behind an assignment, a sudo or a pipe, the command that owns the argument is the same one.
      assert.equal(t.toContainer('X=1 sudo rm "C:\\Users\\dev\\proj\\q r\\f"'), 'X=1 sudo rm "/work/q r/f"');
      assert.equal(t.toContainer('echo hi | tee "C:\\Users\\dev\\proj\\q r\\a"'), 'echo hi | tee "/work/q r/a"');
    });

    it("path rule: the target of a redirection is a path whatever the command", () => {
      assert.equal(t.toContainer('echo hi > "C:\\Users\\dev\\proj\\q r\\a"'), 'echo hi > "/work/q r/a"');
      assert.equal(t.toContainer('printf x 2>>"C:\\Users\\dev\\proj\\q r\\n"'), 'printf x 2>>"/work/q r/n"');
      assert.equal(t.toContainer('sort < "C:\\Users\\dev\\proj\\q r\\t"'), 'sort < "/work/q r/t"');
    });

    it("text rule: a quoted argument of printf or echo is text, kept whole", () => {
      for (const text of [
        'printf "C:\\Users\\dev\\proj\\out.txt done\\nnext"',
        'printf "C:\\Users\\dev\\proj\\a b\\tc"',
        'echo -e "C:\\Users\\dev\\proj\\a b\\$HOME"',
        'printf "C:\\Users\\dev\\proj\\new dir\\t|"',
        // No space in it makes it no less text.
        'printf "C:\\Users\\dev\\proj\\out.txt\\n"',
        'echo -e "C:\\Users\\dev\\proj\\src\\n"',
        // Nor does a path that sits in the middle of it.
        'printf "saved C:\\Users\\dev\\proj\\out.txt\\n"',
      ]) {
        assert.equal(t.toContainer(text), text);
      }
    });

    it("message rule: the message of -m or --message is text", () => {
      for (const flag of ["-m", "-am", "--message", "--message="]) {
        const space = flag.endsWith("=") ? "" : " ";
        const text = `git commit ${flag}${space}"C:\\Users\\dev\\proj\\k is broken"`;
        assert.equal(t.toContainer(text), text, flag);
      }
      // Whatever the message holds, and wherever the path sits in it.
      for (const message of ["C:\\Users\\dev\\proj\\src\\n", "fix C:\\Users\\dev\\proj\\k is broken", "fix C:\\Users\\dev\\proj\\src"]) {
        const text = `git commit -m "${message}"`;
        assert.equal(t.toContainer(text), text, message);
      }
      assert.equal(t.toContainer("git -C C:\\Users\\dev\\proj commit -m 'at C:\\Users\\dev\\proj\\a b'"), "git -C /work commit -m 'at C:\\Users\\dev\\proj\\a b'");
    });

    it("text set aside is put back exactly, whatever the input holds", () => {
      for (const mark of ["\u0000", "\ue000"]) {
        const text = `printf "a" ${mark}0${mark} C:\\Users\\dev\\proj\\src`;
        assert.equal(t.toContainer(text), `printf "a" ${mark}0${mark} /work/src`);
      }
    });

    it("-m is a message only for git commit, tag, merge and stash", () => {
      for (const sub of ["commit", "tag", "merge", "stash push"]) {
        const text = `git ${sub} -m "C:\\Users\\dev\\proj\\a b"`;
        assert.equal(t.toContainer(text), text, sub);
      }
      assert.equal(t.toContainer('git log -m "C:\\Users\\dev\\proj\\a b"'), 'git log -m "/work/a b"');
      assert.equal(t.toContainer('git grep -m "C:\\Users\\dev\\proj\\a b"'), 'git grep -m "/work/a b"');
    });

    it("the subcommand is the first word after git's own options, not any word", () => {
      assert.equal(t.toContainer('git log --grep commit -m "C:\\Users\\dev\\proj\\a b"'), 'git log --grep commit -m "/work/a b"');
      for (const head of ["git -C . commit", "git -c user.name=x commit", "git --git-dir=.git --work-tree=. commit", "git --no-pager -C src tag", "git --git-dir /r commit", "git --work-tree w commit", "git --namespace n stash", "git --config-env a=B commit", "git --attr-source HEAD commit", "git --exec-path commit", "git --exec-path=/x commit"]) {
        const text = `${head} -m "C:\\Users\\dev\\proj\\a b"`;
        assert.equal(t.toContainer(text), text, head);
      }
    });

    it("plain echo and other tools' -m are not text", () => {
      assert.equal(t.toContainer('echo "C:\\Users\\dev\\proj\\a b\\c"'), 'echo "/work/a b/c"');
      assert.equal(t.toContainer('python -m "C:\\Users\\dev\\proj\\k is broken"'), 'python -m "/work/k is broken"');
    });

    it("a separator inside an earlier quoted argument does not hide the command", () => {
      assert.equal(t.toContainer('cat "a;b" "C:\\Users\\dev\\proj\\q r\\n"'), 'cat "a;b" "/work/q r/n"');
      assert.equal(t.toContainer("printf 'a && b' \"C:\\Users\\dev\\proj\\q r\\n\""), "printf 'a && b' \"C:\\Users\\dev\\proj\\q r\\n\"");
    });

    it("a path around or outside a text string is still translated", () => {
      assert.equal(t.toContainer("echo C:\\Users\\dev\\proj\\src"), "echo /work/src");
      assert.equal(t.toContainer('printf "x" C:\\Users\\dev\\proj\\src'), 'printf "x" /work/src');
      assert.equal(
        t.toContainer('printf "C:\\Users\\dev\\proj\\a b\\tc" > "C:\\Users\\dev\\proj\\q r\\n"'),
        'printf "C:\\Users\\dev\\proj\\a b\\tc" > "/work/q r/n"',
      );
    });
  });

  it("a path that climbs out of the workspace with .. is left untouched; one that stays inside is resolved", () => {
    assert.equal(t.toContainer("cat C:\\Users\\dev\\proj\\..\\secret"), "cat C:\\Users\\dev\\proj\\..\\secret");
    assert.equal(t.toContainer("cat C:/Users/dev/proj/a/../../../secret"), "cat C:/Users/dev/proj/a/../../../secret");
    onHost.add("C:\\Users\\dev\\other dir");
    assert.equal(t.toContainer('cat "C:\\Users\\dev\\proj\\..\\other dir\\y"'), 'cat "C:\\Users\\dev\\proj\\..\\other dir\\y"');
    assert.equal(t.toContainer("cat C:\\Users\\dev\\proj\\a\\..\\b\\.\\c"), "cat /work/b/c");
    assert.equal(t.toContainer("cat C:\\Users\\dev\\proj\\.."), "cat C:\\Users\\dev\\proj\\..");
    assert.equal(pathTranslator("/home/dev/proj").toContainer("cat /home/dev/proj/../secret"), "cat /home/dev/proj/../secret");
    assert.equal(t.toHost("cat /work/../secret /work/a/../b"), "cat /work/../secret C:\\Users\\dev\\proj\\a\\..\\b");
  });

  it("output split into chunks of any size is translated as the whole would be", () => {
    const text = "error in /work/src/workflows/run.ts line 3\n/work\n";
    const whole = t.toHost(text);
    for (let size = 1; size <= 10; size++) {
      const stream = t.hostStream();
      let out = "";
      for (let at = 0; at < text.length; at += size) out += stream.write(text.slice(at, at + size));
      assert.equal(out + stream.end(), whole, `chunks of ${size}`);
    }
  });

  it("a quoted path with a space runs to the closing quote", () => {
    assert.equal(t.toContainer('cat "C:\\Users\\dev\\proj\\my dir\\f.txt" x'), 'cat "/work/my dir/f.txt" x');
    assert.equal(t.toContainer("cat 'C:/Users/dev/proj/my dir/f.txt'"), "cat '/work/my dir/f.txt'");
    assert.equal(t.toContainer('cat "C:\\Users\\dev\\proj\\a" "C:\\Users\\dev\\proj\\b c"'), 'cat "/work/a" "/work/b c"');
  });

  it("a quoted string that is more than one path is not rewritten past the first", () => {
    // Another path in the string, outside the workspace, is left exactly as it was.
    assert.equal(
      t.toContainer('echo "C:\\Users\\dev\\proj\\a.ts and C:\\Users\\dev\\other\\b"'),
      'echo "/work/a.ts and C:\\Users\\dev\\other\\b"',
    );
    // A backslash before the closing quote is an escaped quote, not a separator.
    assert.equal(t.toContainer('echo "C:\\Users\\dev\\proj\\a b\\" x"'), 'echo "/work/a b\\" x"');
    // A shell command inside the quotes keeps its own escapes.
    assert.equal(
      t.toContainer("echo \"C:\\Users\\dev\\proj\\a.ts | grep 'x\\.y'\""),
      "echo \"/work/a.ts | grep 'x\\.y'\"",
    );
    assert.equal(
      t.toContainer("bash -c \"cat C:\\Users\\dev\\proj\\a.ts | grep 'x\\.y'\""),
      "bash -c \"cat /work/a.ts | grep 'x\\.y'\"",
    );
  });

  it("a path open at the end of a chunk is held whole, and a look-alike is not made into a path", () => {
    const stream = t.hostStream();
    const out = [stream.write(`${"x".repeat(2000)}=/work/sr`), stream.write("c/a.ts"), stream.end()].join("");
    assert.equal(out, `${"x".repeat(2000)}=C:\\Users\\dev\\proj\\src\\a.ts`);
    const alike = t.hostStream();
    assert.equal([alike.write("see /work"), alike.write("2/x"), alike.end()].join(""), "see /work2/x");
  });

  it("holds from the start of the /work path, not from a later segment that begins with work", () => {
    const text = "error in /work/src/workflows/run.ts line 3";
    for (let cut = 0; cut <= text.length; cut++) {
      const stream = t.hostStream();
      const out = stream.write(text.slice(0, cut)) + stream.write(text.slice(cut)) + stream.end();
      assert.equal(out, "error in C:\\Users\\dev\\proj\\src\\workflows\\run.ts line 3", `cut at ${cut}`);
    }
  });

  it("a long word with no whitespace is not held back for the whole run", () => {
    const stream = t.hostStream();
    const first = stream.write(`/work/src/a.ts${"y".repeat(5000)}`);
    assert.ok(first.length >= 4000, `only ${first.length} characters came out`);
    assert.equal(first + stream.end(), `C:\\Users\\dev\\proj\\src\\a.ts${"y".repeat(5000)}`);
    // A path that began long ago is not what holds the run back.
    const later = t.hostStream();
    const out = later.write(`/work/a${"y".repeat(5000)}`);
    assert.ok(out.length >= 4000, `only ${out.length} characters came out`);
  });

  it("a stream does not read a /work after a name character as a path, even across a chunk boundary", () => {
    const stream = t.hostStream();
    const out = [stream.write("a"), stream.write("/work/x"), stream.end()].join("");
    assert.equal(out, "a/work/x");
  });
});

describe("pathTranslator on a POSIX workspace", () => {
  const t = pathTranslator("/home/dev/proj");

  it("maps the workspace both ways and leaves everything else", () => {
    assert.equal(
      t.toContainer("cat /home/dev/proj/src/a.ts /home/dev/proj2/x /home/dev/proj"),
      "cat /work/src/a.ts /home/dev/proj2/x /work",
    );
    assert.equal(t.toHost("at /work/src/a.ts:3 in /work\n"), "at /home/dev/proj/src/a.ts:3 in /home/dev/proj\n");
  });

  it("does not touch backslashes in a POSIX workspace's commands", () => {
    assert.equal(t.toContainer("echo /home/dev/proj/a\\ b"), "echo /work/a\\ b");
  });
});
