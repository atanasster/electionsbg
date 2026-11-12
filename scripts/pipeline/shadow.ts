// Shadow comparison: would the planner have queued what the LLM orchestrator
// actually ran? Plan: docs/plans/watch-pipeline-scripts-v1.md §5 Tier 0.
//
// For a past `process-watch-report` session we rebuild the state it decided
// from — state/watch and state/ingest as committed just before the session
// started — run the planner over it, and diff the result against the skills
// the session's perf trace records. Report-only: a difference is a question
// for a human (the registry is wrong, or the LLM run was), never an error.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { IngestState } from "../lib/ingest-state";
import type { WatchState } from "../watch/types";
import { plan, type Plan } from "./planner";
import { HANDLERS, markerOf, type Handler } from "./registry";
import { REPO } from "./state";

export const PERF_INGEST = path.join(
  REPO,
  "state/perf/process-watch-report.jsonl",
);

export interface PerfRow {
  session: string;
  step: string;
  phase?: string;
  command?: string;
  status: string;
  startedAt: string;
}

/** Names a perf row might carry for this handler: the runbook name the LLM
 *  recorded (`update-kzk-appeals`), the handler id, or its marker. */
export const labelsOf = (h: Handler): string[] => [
  ...new Set([h.skill, h.id, markerOf(h)].filter((x): x is string => !!x)),
];

/** Sessions in file order, each with its rows. */
export const readSessions = (
  file: string = PERF_INGEST,
): Map<string, PerfRow[]> => {
  const out = new Map<string, PerfRow[]>();
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as PerfRow;
    out.set(r.session, [...(out.get(r.session) ?? []), r]);
  }
  return out;
};

export interface ShadowResult {
  session: string;
  startedAt: string;
  stateCommit: string;
  /** Runbook-level labels the planner queued with status "run". */
  planned: string[];
  /** Rows the session recorded for a known handler, any status. */
  ran: { label: string; status: string }[];
  /** Planned, and the LLM attempted it (status ok or error). */
  agree: string[];
  /** Planned, not attempted — the LLM skipped it or never got to it, or the
   *  planner over-queues. */
  plannedOnly: string[];
  /** Attempted, never planned: the registry misses a trigger, or the LLM ran
   *  something the state did not call for. */
  ranOnly: string[];
  /** Planned but not runnable (blocked / needs-operator / …), with why. */
  heldBack: { label: string; status: string; why?: string }[];
  /** Held back by the planner AND recorded only as `skipped` by the LLM —
   *  agreement about not running, not a difference. */
  bothHeld: string[];
}

/** A row the LLM actually tried to run. `skipped` is a decision NOT to. */
const attempted = (status: string): boolean =>
  status === "ok" || status === "error";

/** Pure: compare a plan against the session's rows. */
export const compare = (
  session: string,
  startedAt: string,
  stateCommit: string,
  p: Plan,
  rows: readonly PerfRow[],
  handlers: readonly Handler[] = HANDLERS,
): ShadowResult => {
  const byId = new Map(handlers.map((h) => [h.id, h]));
  // A handler and the runbook it belongs to collapse to the runbook name, the
  // granularity the LLM trace records at.
  const label = (id: string): string => {
    const h = byId.get(id);
    return h?.skill ?? h?.id ?? id;
  };
  const known = new Map<string, string>();
  for (const h of handlers)
    for (const l of labelsOf(h)) known.set(l, h.skill ?? h.id);

  const planned = [
    ...new Set(
      p.entries.filter((e) => e.status === "run").map((e) => label(e.handler)),
    ),
  ];
  // A direct-command handler shows up in the trace as its command line, not
  // its name. Credit a row by command only when exactly one handler owns that
  // command as an INGEST step: a shared derive (db:load:council:pg is in two
  // handlers) proves nothing about which one ran.
  const owners = new Map<string, Set<string>>();
  for (const h of handlers)
    for (const s of h.steps)
      if (s.phase === "ingest")
        owners.set(
          s.run,
          (owners.get(s.run) ?? new Set()).add(h.skill ?? h.id),
        );
  const byCommand = (command: string | undefined): string | undefined => {
    if (!command) return undefined;
    const hit = [...owners].find(
      ([run, who]) =>
        who.size === 1 && (command === run || command.startsWith(`${run} `)),
    );
    return hit ? [...hit[1]][0] : undefined;
  };
  const ran = rows.flatMap((r) => {
    const named = r.phase === "ingest" ? known.get(r.step) : undefined;
    const lbl = named ?? byCommand(r.command);
    return lbl ? [{ label: lbl, status: r.status }] : [];
  });
  const ranSet = new Set(
    ran.filter((r) => attempted(r.status)).map((r) => r.label),
  );
  const skippedOnly = new Set(
    ran.filter((r) => !ranSet.has(r.label)).map((r) => r.label),
  );
  const plannedSet = new Set(planned);
  const heldBack = p.entries
    .filter((e) => e.status !== "run")
    .map((e) => ({ label: label(e.handler), status: e.status, why: e.why }));
  return {
    session,
    startedAt,
    stateCommit,
    planned,
    ran,
    agree: planned.filter((l) => ranSet.has(l)),
    plannedOnly: planned.filter((l) => !ranSet.has(l)),
    ranOnly: [...ranSet].filter((l) => !plannedSet.has(l)),
    heldBack,
    bothHeld: [
      ...new Set(
        heldBack.map((h) => h.label).filter((l) => skippedOnly.has(l)),
      ),
    ],
  };
};

/** `20261108T225046Z-471d` → `2026-11-08T22:50:46Z`, or null. */
export const sessionIdTime = (session: string): string | null => {
  const m = session.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
};

/** The session's start: the EARLIER of its id's mint time and its first row.
 *  Neither alone is safe — rows are recorded after the fact (a commit can land
 *  between the mint and the first row), and one row has been seen stamped
 *  before its own session id. */
export const sessionStart = (
  session: string,
  rows: readonly PerfRow[],
): string | undefined =>
  [sessionIdTime(session), ...rows.map((r) => r.startedAt)]
    .filter((t): t is string => !!t && !Number.isNaN(Date.parse(t)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];

// ------------------------------------------------------------- git loading

const gitOut = (args: string[], input?: string): string =>
  execFileSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"],
  });

/** The last commit at or before `iso` (any author — the watch state commit is
 *  usually the auto-committer's). */
export const commitBefore = (iso: string): string | null => {
  const sha = gitOut(["rev-list", "-1", `--before=${iso}`, "HEAD"]).trim();
  return sha || null;
};

/** `<dir>/*.json` at a commit, parsed, keyed by file stem. One `cat-file
 *  --batch` call instead of one process per file. */
export const readTreeAt = <T>(sha: string, dir: string): Map<string, T> => {
  const names = gitOut(["ls-tree", "--name-only", `${sha}:${dir}`])
    .split("\n")
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  const out = new Map<string, T>();
  if (!names.length) return out;
  const raw = execFileSync("git", ["cat-file", "--batch"], {
    cwd: REPO,
    input: names.map((f) => `${sha}:${dir}/${f}`).join("\n") + "\n",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"],
  });
  for (const [name, text] of parseCatFileBatch(raw, names))
    try {
      out.set(name.slice(0, -".json".length), JSON.parse(text) as T);
    } catch {
      // A corrupt historical file is not this report's problem; skip it.
    }
  return out;
};

/** `git cat-file --batch` output → [name, utf-8 content] pairs. Each object is
 *  "<oid> <type> <size>\n<size BYTES>\n"; a missing one is "<ref> missing\n".
 *  Sizes are bytes, so this walks the Buffer — never a decoded string, where
 *  Cyrillic content would make every later offset wrong. */
export const parseCatFileBatch = (
  raw: Buffer,
  names: readonly string[],
): [string, string][] => {
  const out: [string, string][] = [];
  let i = 0;
  for (const name of names) {
    const nl = raw.indexOf(0x0a, i);
    if (nl === -1) break;
    const header = raw.subarray(i, nl).toString("utf8").split(" ");
    if (header[1] === "missing") {
      i = nl + 1;
      continue;
    }
    const size = Number(header[2]);
    const start = nl + 1;
    out.push([name, raw.subarray(start, start + size).toString("utf8")]);
    i = start + size + 1;
  }
  return out;
};

export const shadowSession = (
  session: string,
  rows: readonly PerfRow[],
): ShadowResult | null => {
  const startedAt = sessionStart(session, rows);
  if (!startedAt) return null;
  const sha = commitBefore(startedAt);
  if (!sha) return null;
  const watch = readTreeAt<WatchState>(sha, "state/watch");
  const ingest = readTreeAt<IngestState>(sha, "state/ingest");
  const p = plan({
    handlers: HANDLERS,
    watch,
    ingest,
    now: new Date(startedAt),
    // The LLM run asked on a missing marker; "run" shows what WOULD queue.
    bootstrap: "run",
  });
  return compare(session, startedAt, sha, p, rows);
};

export const renderShadow = (r: ShadowResult): string => {
  const lines = [
    `## ${r.session} (started ${r.startedAt}, state at ${r.stateCommit.slice(0, 10)})`,
    `  agree (${r.agree.length}): ${r.agree.join(", ") || "—"}`,
    `  planned, not run (${r.plannedOnly.length}): ${r.plannedOnly.join(", ") || "—"}`,
    `  run, not planned (${r.ranOnly.length}): ${r.ranOnly.join(", ") || "—"}`,
    `  both held back (${r.bothHeld.length}): ${r.bothHeld.join(", ") || "—"}`,
  ];
  for (const h of r.heldBack)
    lines.push(
      `  held back: ${h.label} [${h.status}]${h.why ? ` — ${h.why}` : ""}`,
    );
  return lines.join("\n");
};
