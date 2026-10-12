// Command-line parsing shared by every clikit command. Grammar:
//   --name value, --name=value    option
//   --flag, --no-flag             flag
//   -f, -fv (bundled), -o value, -ovalue
//   --                            everything after it is positional
//   -                             a positional (conventionally stdin)

export interface FlagSpec {
  short?: string;
  description: string;
}

export interface OptionSpec {
  short?: string;
  description: string;
  type?: "string" | "number";
  default?: string | number;
  placeholder?: string;
}

export interface PositionalSpec {
  name: string;
  description: string;
  required?: boolean;
}

export interface CommandSpec {
  name: string;
  summary: string;
  positionals: PositionalSpec[];
  flags: Record<string, FlagSpec>;
  options: Record<string, OptionSpec>;
}

export type OptionValue = string | number | undefined;

export interface Parsed {
  positionals: string[];
  flags: Record<string, boolean>;
  options: Record<string, OptionValue>;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** Levenshtein distance, for "did you mean" hints. */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function suggestion(name: string, candidates: string[]): string {
  // Two edits catch most typos without suggesting unrelated names.
  const best = candidates
    .map((c) => ({ c, d: editDistance(name, c) }))
    .filter((x) => x.d <= 2)
    .sort((x, y) => x.d - y.d || (x.c < y.c ? -1 : 1))[0];
  return best ? ` (did you mean --${best.c}?)` : "";
}

/** Splits a comma-separated option value, dropping empty items: "a,,b," -> ["a", "b"]. */
export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Splits the text after `--` into the option name and its inline value, if any. */
function splitInline(body: string): [string, string | undefined] {
  const [name, value] = body.split("=");
  return [name, value];
}

function coerce(name: string, raw: string, spec: OptionSpec): string | number {
  if (spec.type !== "number") return raw;
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) throw new UsageError(`--${name} expects a number, got "${raw}"`);
  return n;
}

function shortOwner(spec: CommandSpec, letter: string): { kind: "flag" | "option"; name: string } | undefined {
  for (const [name, f] of Object.entries(spec.flags)) if (f.short === letter) return { kind: "flag", name };
  for (const [name, o] of Object.entries(spec.options)) if (o.short === letter) return { kind: "option", name };
  return undefined;
}

function defaults(spec: CommandSpec): Parsed {
  const flags: Record<string, boolean> = {};
  for (const name of Object.keys(spec.flags)) flags[name] = false;
  const options: Record<string, OptionValue> = {};
  for (const [name, o] of Object.entries(spec.options)) options[name] = o.default;
  return { positionals: [], flags, options };
}

export function parseArgs(argv: string[], spec: CommandSpec): Parsed {
  const out = defaults(spec);
  const known = [...Object.keys(spec.flags), ...Object.keys(spec.options)];
  let i = 0;

  const takeValue = (name: string, inline: string | undefined): string => {
    if (inline !== undefined) return inline;
    const next = argv[i + 1];
    if (next === undefined || (next.startsWith("-") && next !== "-")) throw new UsageError(`--${name} needs a value`);
    i++;
    return next;
  };

  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const [name, inline] = splitInline(arg.slice(2));
      if (Object.hasOwn(spec.options, name)) {
        out.options[name] = coerce(name, takeValue(name, inline), spec.options[name]);
      } else if (Object.hasOwn(spec.flags, name)) {
        if (inline !== undefined) throw new UsageError(`--${name} is a flag and takes no value`);
        out.flags[name] = true;
      } else if (name.startsWith("no-") && Object.hasOwn(spec.flags, name.slice(3))) {
        out.flags[name.slice(3)] = false;
      } else {
        throw new UsageError(`unknown option --${name}${suggestion(name, known)}`);
      }
      continue;
    }

    if (arg.startsWith("-") && arg !== "-") {
      // In a bundle like -vq each letter is a flag; an option letter takes the rest of the bundle or the next argument.
      for (let j = 1; j < arg.length; j++) {
        const owner = shortOwner(spec, arg[j]);
        if (!owner) throw new UsageError(`unknown option -${arg[j]}`);
        if (owner.kind === "flag") {
          out.flags[owner.name] = true;
          continue;
        }
        const rest = arg.slice(j + 1);
        out.options[owner.name] = coerce(owner.name, takeValue(owner.name, rest === "" ? undefined : rest), spec.options[owner.name]);
        break;
      }
      continue;
    }

    out.positionals.push(arg);
  }

  const required = spec.positionals.filter((p) => p.required).length;
  if (out.positionals.length < required) {
    throw new UsageError(`missing <${spec.positionals[out.positionals.length].name}>`);
  }
  if (out.positionals.length > spec.positionals.length) {
    throw new UsageError(`unexpected argument "${out.positionals[spec.positionals.length]}"`);
  }
  return out;
}
