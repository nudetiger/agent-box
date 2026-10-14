// A context map's test_file_command for some test files. Placeholders:
//   {files}  the files, space separated            node --test {files}
//   {tests}  Gradle filters for the Java ones       bash ./gradlew test {tests}
//   {dirs}   their directories as ./dir, deduped   go test {dirs}
export function fillTestCmd(cmd, files) {
  const tests = files.filter((f) => /^src\/test\/java\/.*\.java$/.test(f))
    .map((t) => `--tests ${t.replace(/^src\/test\/java\//, "").replace(/\.java$/, "").replace(/\//g, ".")}`).join(" ");
  const dirs = [...new Set(files.map((f) => (f.includes("/") ? `./${f.slice(0, f.lastIndexOf("/"))}` : ".")))].join(" ");
  return cmd.replaceAll("{files}", files.join(" ")).replaceAll("{tests}", tests).replaceAll("{dirs}", dirs);
}
