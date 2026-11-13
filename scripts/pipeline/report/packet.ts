// The repair packet: one self-contained markdown file per failed step, written
// for a reader who has NOTHING else — not the conversation, not the runbook,
// not the terminal. Plan: docs/plans/watch-pipeline-scripts-v1.md §2.8.
//
// Nine fixed sections. Every value comes from the run record, the step's log,
// git or the perf trace; the packet invents no prose about the failure beyond
// the classifier's hint, which is labelled as a hint and shown with the line
// that triggered it.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { formatDuration, readSteps } from "../../perf/perf_log";
import { REPO } from "../state";
import type { GateRecord, StepRecord } from "./record";
import { redact } from "./redact";
import { code, fenced, flat } from "./render";

export const MAX_LINE = 400;
export const EXCERPT_LINES = 80;

export interface LogExcerpt {
  /** 1-based number of the first line shown. */
  from: number;
  lines: string[];
  /** 1-based line number of the first-error line, when found in the log. */
  errorAt?: number;
  totalLines: number;
}

export interface CodeContext {
  entry?: string;
  imports: string[];
  tests: string[];
  recentCommits: string[];
}

export interface PacketInput {
  session: string;
  unit: string;
  step: StepRecord;
  /** Exact command to reproduce, env pins included. */
  reproduce: string;
  excerpt: LogExcerpt | null;
  code: CodeContext;
  history: {
    session: string;
    status: string;
    durationMs: number;
    ts: string;
  }[];
  watcher: { source: string; detail?: string; meta?: unknown }[];
  /** Classifier hint + the handler's known-failure advice. */
  guidance: string[];
  /** Rules a fix must not break. */
  never: string[];
  /** What the failed run left behind. */
  stateLeft: string[];
  doneMeans: string[];
  /** The unit's gates; a failed one is the expectation this step missed. */
  gates: GateRecord[];
}

const clip = (l: string): string =>
  l.length > MAX_LINE
    ? `${l.slice(0, MAX_LINE)} …[+${l.length - MAX_LINE} chars]`
    : l;

/** The last EXCERPT_LINES of a log, plus where the first error sits in it. */
/** Bytes read from the END of a log for the excerpt — enough for 80 long
 *  lines without loading a multi-hundred-MB log into memory. */
const TAIL_BYTES = 512 * 1024;

const countLines = (file: string): number => {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(1 << 20);
  let n = 0;
  let last = 0x0a;
  try {
    for (let r; (r = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) {
      for (
        let i = buf.indexOf(0x0a);
        i !== -1 && i < r;
        i = buf.indexOf(0x0a, i + 1)
      )
        n++;
      last = buf[r - 1];
    }
  } finally {
    fs.closeSync(fd);
  }
  // A final line without a trailing newline is still a line.
  return last === 0x0a ? n : n + 1;
};

/** The last `lines` lines of a log — redacted, since the excerpt is committed —
 *  plus where the first error sits among them. */
export const excerptLog = (
  file: string,
  firstError: string | undefined,
  lines = EXCERPT_LINES,
): LogExcerpt | null => {
  if (!fs.existsSync(file)) return null;
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(size - start);
  try {
    fs.readSync(fd, buf, 0, buf.length, start);
  } finally {
    fs.closeSync(fd);
  }
  let window = buf.toString("utf8").split("\n");
  if (start > 0) window = window.slice(1); // first line is cut mid-way
  if (window.at(-1) === "") window.pop();
  const totalLines = countLines(file);
  const shown = window.slice(-lines);
  const from = totalLines - shown.length + 1;
  let errorAt: number | undefined;
  if (firstError) {
    const needle = firstError.slice(0, 120);
    for (let i = shown.length - 1; i >= 0; i--)
      if (redact(shown[i]).includes(needle)) {
        errorAt = from + i;
        break;
      }
  }
  return {
    from,
    lines: shown.map((l) => clip(redact(l))),
    errorAt,
    totalLines,
  };
};

const git = (...args: string[]): string => {
  try {
    return execFileSync("git", args, {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return "";
  }
};

/** The script file a command ends up running, when it names one. */
export const entryOf = (
  command: string,
  scripts: Record<string, string>,
): string | undefined => {
  const direct = command.match(/\b(scripts\/[^\s'"]+\.(?:ts|mjs|js))/)?.[1];
  if (direct) return direct;
  const script = command.match(/^pnpm run ([^\s]+)/)?.[1];
  const body = script ? scripts[script] : undefined;
  if (!body) return undefined;
  return body.match(/(?:\.\/)?(scripts\/[^\s'"]+\.(?:ts|mjs|js))/)?.[1];
};

/** Relative imports of a file, resolved to repo paths that exist. */
export const localImports = (file: string): string[] => {
  const abs = path.join(REPO, file);
  if (!fs.existsSync(abs)) return [];
  const src = fs.readFileSync(abs, "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    const base = path.resolve(path.dirname(abs), m[1]);
    for (const cand of [
      base,
      `${base}.ts`,
      `${base}/index.ts`,
      base.replace(/\.js$/, ".ts"),
    ])
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        out.add(path.relative(REPO, cand));
        break;
      }
  }
  return [...out].sort();
};

export const codeContext = (
  command: string,
  scripts: Record<string, string>,
): CodeContext => {
  const entry = entryOf(command, scripts);
  if (!entry) return { imports: [], tests: [], recentCommits: [] };
  const imports = localImports(entry);
  const tests = [entry, ...imports]
    .flatMap((f) => {
      const stem = f.replace(/\.(?:ts|mjs|js)$/, "");
      return [`${stem}.test.ts`, `${stem}.data.test.ts`];
    })
    .filter((f) => fs.existsSync(path.join(REPO, f)));
  const recentCommits = git(
    "log",
    "-5",
    "--format=%h %cs %s",
    "--",
    entry,
    ...imports,
  )
    .split("\n")
    .filter(Boolean);
  return { entry, imports, tests: [...new Set(tests)], recentCommits };
};

/** The last `n` recorded outcomes of this step label in earlier sessions. */
export const stepHistory = (
  perfRun: string,
  stepId: string,
  session: string,
  n = 5,
  perfDir?: string,
): PacketInput["history"] =>
  readSteps(perfRun, perfDir)
    .steps.filter((s) => s.step === stepId && s.session !== session)
    .slice(-n)
    .map((s) => ({
      session: s.session,
      status: s.status,
      durationMs: s.durationMs,
      ts: s.ts,
    }));

export const renderPacket = (p: PacketInput): string => {
  const s = p.step;
  const out: string[] = [];
  out.push(`# Repair packet — ${flat(p.unit)} › ${flat(s.id)}`);
  out.push(
    `Session ${code(p.session)}. Read top to bottom; everything needed to reproduce and fix this failure is here.`,
  );

  out.push("", "## 1. What failed");
  out.push(
    `- Unit: ${code(p.unit)}${s.chainOf ? ` (link of chain ${code(s.chainOf)})` : ""}`,
  );
  out.push(`- Step: ${code(s.id)} (phase ${flat(s.phase)})`);
  out.push(`- Command: ${code(s.command)}`);
  out.push(
    `- Result: ${s.status}, exit ${s.exitCode ?? "signal"}, after ${formatDuration(s.durationMs)}`,
  );
  out.push(
    `- Class: ${code(s.failure?.class ?? "unknown")} (retryable: ${s.failure?.retryable ? "yes" : "no"})`,
  );

  out.push("", "## 2. Reproduce");
  out.push(fenced(p.reproduce, "bash"));

  out.push("", "## 3. Evidence");
  if (s.firstError) out.push(`First error line: ${code(s.firstError)}`);
  if (s.failure?.evidence && s.failure.evidence !== s.firstError)
    out.push(`Line the classifier matched: ${code(s.failure.evidence)}`);
  if (p.excerpt) {
    out.push(
      `Log ${code(s.log)} — showing lines ${p.excerpt.from}–${p.excerpt.from + p.excerpt.lines.length - 1} of ${p.excerpt.totalLines}` +
        (p.excerpt.errorAt
          ? `; the first error line is line ${p.excerpt.errorAt}.`
          : "."),
    );
    out.push(
      fenced(
        p.excerpt.lines
          .map((l, i) => `${String(p.excerpt!.from + i).padStart(5)}  ${l}`)
          .join("\n"),
      ),
    );
  } else
    out.push(
      `The log ${code(s.log || "(none)")} is not on this machine (logs are local, not committed).`,
    );

  out.push("", "## 4. Expected vs observed");
  if (p.gates.length)
    for (const g of p.gates)
      out.push(
        `- gate ${code(g.id)}: ${g.ok ? "passed" : "FAILED"} — expected ${code(g.expected)}, observed ${code(g.observed)}`,
      );
  else out.push("_(no gate on this unit; the step's expectation is exit 0)_");
  if (s.result?.counts)
    out.push(
      `Counts the step reported: ${Object.entries(s.result.counts)
        .map(([k, v]) => `${flat(k)}=${v}`)
        .join(", ")}`,
    );

  out.push("", "## 5. Where the code is");
  if (p.code.entry) {
    out.push(`- Entry: ${code(p.code.entry)}`);
    if (p.code.imports.length)
      out.push(`- Local imports: ${p.code.imports.map(code).join(", ")}`);
    out.push(
      `- Tests: ${p.code.tests.length ? p.code.tests.map(code).join(", ") : "_(none found next to these files)_"}`,
    );
  } else
    out.push(
      "_(the command names no script file; start from the command above)_",
    );

  out.push("", "## 6. What changed");
  out.push("Recent commits touching that code:");
  out.push(
    p.code.recentCommits.length
      ? fenced(p.code.recentCommits.join("\n"))
      : "_(none found)_",
  );
  if (p.watcher.length) {
    out.push("Watcher state of the source(s) that triggered this run:");
    for (const w of p.watcher)
      out.push(
        `- ${code(w.source)}: ${flat(w.detail)}` +
          (w.meta
            ? `\n${fenced(JSON.stringify(w.meta, null, 2).slice(0, 2000), "json")}`
            : ""),
      );
  }
  out.push("This step's last outcomes in earlier sessions:");
  out.push(
    p.history.length
      ? p.history
          .map(
            (h) =>
              `- ${h.ts.slice(0, 16)} ${h.status} ${formatDuration(h.durationMs)} (${h.session})`,
          )
          .join("\n")
      : "_(no earlier runs of this step)_",
  );

  out.push("", "## 7. Guidance");
  for (const g of p.guidance) out.push(`- ${flat(g)}`);
  if (p.never.length) {
    out.push("Rules a fix must NOT break:");
    for (const n of p.never) out.push(`- ${flat(n)}`);
  }

  out.push("", "## 8. State left behind");
  for (const l of p.stateLeft) out.push(`- ${flat(l)}`);

  out.push("", "## 9. Done means");
  for (const d of p.doneMeans) out.push(`- ${flat(d)}`);

  // Committed, like report.md: redact the whole packet, not just the excerpt.
  return redact(out.join("\n") + "\n");
};
