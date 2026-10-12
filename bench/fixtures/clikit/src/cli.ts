import { parseArgs, splitList, UsageError, type CommandSpec } from "./args.ts";
import { formatHelp } from "./help.ts";
import { report } from "./report.ts";

/** Everything a command touches outside itself, so tests can run it without a disk or a process. */
export interface Io {
  readFile(path: string): string;
  stdout(text: string): void;
  stderr(text: string): void;
}

export const REPORT: CommandSpec = {
  name: "report",
  summary: "Print a CSV file as an aligned table.",
  positionals: [{ name: "file", description: "CSV file with a header row", required: true }],
  flags: {
    help: { short: "h", description: "show this help" },
  },
  options: {
    columns: { short: "c", description: "comma-separated columns to show, in order", placeholder: "list" },
    limit: { short: "n", type: "number", description: "show at most this many rows", placeholder: "n" },
    "max-width": { type: "number", default: 24, description: "cut cells wider than this", placeholder: "n" },
  },
};

export const COMMANDS: Record<string, CommandSpec> = { report: REPORT };

function commandList(): string {
  return "Commands:\n" + Object.values(COMMANDS).map((c) => `  ${c.name}  ${c.summary}`).join("\n") + "\n";
}

/** Runs one command line and returns the exit code: 0 ok, 2 usage error. */
export function run(argv: string[], io: Io): number {
  const [name, ...rest] = argv;
  if (name === undefined || name === "help") {
    io.stdout(commandList());
    return 0;
  }
  if (!Object.hasOwn(COMMANDS, name)) {
    io.stderr(`clikit: unknown command "${name}"\n${commandList()}`);
    return 2;
  }
  const spec = COMMANDS[name];
  if (rest.includes("-h") || rest.includes("--help")) {
    io.stdout(formatHelp(spec));
    return 0;
  }
  try {
    const args = parseArgs(rest, spec);
    const columns = args.options.columns === undefined ? undefined : splitList(String(args.options.columns));
    const text = report(io.readFile(args.positionals[0]), {
      columns,
      limit: args.options.limit as number | undefined,
      maxWidth: args.options["max-width"] as number,
    });
    io.stdout(text);
    return 0;
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.stderr(`clikit ${name}: ${err.message}\n`);
    return 2;
  }
}
