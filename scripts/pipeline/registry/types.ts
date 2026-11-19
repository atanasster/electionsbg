// The typed routing table for the watch → ingest → publish pipeline.
// Plan: docs/plans/watch-pipeline-scripts-v1.md §2.1.
//
// Until this registry existed the same facts lived as prose tables in
// .claude/skills/process-watch-report/SKILL.md and 37 update-* runbooks, and
// three tests kept them honest by regex. Everything the runners decide — what
// to run, in which order, what a publish needs — is read from here.

/** Something a handler or one of its steps cannot run without. Checked by the
 *  preflight (`pipeline:doctor`); an unmet need plans the handler as `blocked`
 *  instead of letting it time out half-way. */
export const NEEDS = [
  "pg-local", // docker Postgres on 5433
  "egress:bg", // a Bulgarian exit IP (КЗК, АСП, ГИТ)
  "reach:gov-hosts", // parliament.bg + mod.bg answer (a datacenter VPN exit hangs them; a BG line is fine)
  "headed", // a display for headed Playwright
  "drive:prices", // raw_data/prices symlink target mounted
  "bin:pdftotext",
  "bin:unzip",
  "tr-state", // raw_data/tr/state.sqlite present
  "gemini", // GEMINI_API_KEY for an OCR arm
  "proxy", // the Cloud SQL proxy on 5434 (a read-only check against prod)
] as const;
export type Need = (typeof NEEDS)[number];

/** Who can carry this handler end to end today.
 *    script   — `pipeline:ingest` runs every step itself.
 *    skill    — steps are recorded, but a judgment gap remains: the run lists
 *               it under "Needs agent" with the runbook to follow.
 *    operator — no automation at all; a human edits something, then acks. */
export type Runner = "script" | "skill" | "operator";

export type Phase = "ingest" | "derive" | "verify";

/** What the planner knows about this run, handed to `args`/`when` hooks. */
export interface RunCtx {
  /** Watcher source ids that moved since this handler's marker. */
  flipped: ReadonlySet<string>;
  /** `state/watch/<id>.json.meta`, when the watcher stored one. */
  meta(sourceId: string): Record<string, unknown> | undefined;
  /** `state/watch/<id>.json.detail`. */
  detail(sourceId: string): string | undefined;
  now: Date;
  /** This handler's marker (`lastSuccessfulIngest`), null when it never ran.
   *  A scoped step reads every scope entry NEWER than this — not just the
   *  latest one — so a run that fell behind still covers every change. */
  since: string | null;
}

export interface Step {
  /** Stable across runs — it is the perf-trace step label. */
  id: string;
  /** The exact command line. `pnpm run <script> [args]` or `pnpm exec …`. */
  run: string;
  /** Run only when one of these sources flipped. Omitted = whenever the
   *  handler runs. */
  on?: readonly string[];
  /** Extra arguments derived from structured watcher state. Returning null
   *  SKIPS the step with the reason "no scope" — never run it unscoped. */
  args?: (ctx: RunCtx) => string[] | null;
  phase: Phase;
  /** Default 30. A step that exceeds it is killed and classed `timeout`. */
  timeoutMin?: number;
  /** Exit codes that are a finding, not a failure. */
  okExit?: readonly number[];
  /** `chain` expands a package.json `&&` chain one link per trace row. */
  kind?: "command" | "chain";
  /** Needs beyond the handler's own. */
  needs?: readonly Need[];
}

/** Something only a human can do. The pipeline never guesses past one. */
export interface OperatorStep {
  id: string;
  /** Relevant only when one of these flipped. Omitted = whenever queued. */
  on?: readonly string[];
  /** One line: what to do. */
  instruction: string;
  url?: string;
  /** Repo-relative directory the file goes in. */
  dropDir?: string;
  /** What the outstanding item stops:
   *    handler — nothing runs, marker stays;
   *    arm     — steps sharing its `on` sources are skipped, the rest run;
   *    nothing — informational, the automated part is complete without it. */
  blocks: "handler" | "arm" | "nothing";
  /** True once the human part is verifiably done. Omitted = undetectable: the
   *  item stays open until `pipeline:ack <handler> <step>`. */
  done?: (ctx: RunCtx) => boolean;
}

/** An LLM-assisted step — never run by `pipeline:nightly` on its own. */
export interface AgentStep {
  id: string;
  on?: readonly string[];
  instruction: string;
  /** The runbook section to follow. */
  doc: string;
}

/** One `:cloud` command, optionally tied to the sources that require it. */
export interface CloudSpec {
  run: string | ((ctx: RunCtx) => string);
  on?: readonly string[];
}

export interface PublishSpec {
  /** `bucket:sync:paths` arguments, relative to data/. */
  paths?: readonly string[];
  /** `:cloud` commands. ORDER is taken from CLOUD_ORDER, not from here. */
  cloud?: readonly (string | CloudSpec)[];
  /** Files a cloud command rewrites that must be committed after publish. */
  commitAfter?: readonly string[];
  /** Top-level data/ entries matching this are ALSO published when the run
   *  modified them — for per-cycle folders (`data/2023_10_29_mi`) whose names
   *  no watcher field carries. The runner resolves it by mtime after ingest. */
  dirsMatching?: RegExp;
}

export interface Handler {
  /** Also the default ingest marker: state/ingest/<id>.json. */
  id: string;
  /** Marker file stem when it differs from `id`. */
  marker?: string;
  /** The runbook that still documents this handler, if any. */
  skill?: string;
  runner: Runner;
  /** Watcher source ids that queue it. */
  sources: readonly string[];
  needs?: readonly Need[];
  /** Handlers that must run first when queued in the same run. */
  after?: readonly string[];
  steps: readonly Step[];
  operator?: readonly OperatorStep[];
  agent?: readonly AgentStep[];
  publish?: PublishSpec;
  /** Who writes the data-changes.json row.
   *    orchestrator — the runner, gated on a data diff;
   *    self         — the ingest script does (never append twice);
   *    none         — no public changelog row for this handler. */
  changelog: "orchestrator" | "self" | "none";
  /** Who stamps the marker. `self` = a script stamps it itself — possibly
   *  BEFORE the handler's last step, so the runner snapshots the marker before
   *  the handler runs and restores it if any later step fails. */
  stamp?: "runner" | "self";
  /** Post-step ids (registry/post_steps.ts) this handler triggers. */
  followUps?: readonly string[];
  /** The runbook's troubleshooting table, as data: when a failed step's
   *  output matches `match`, the repair packet quotes `advice`. */
  knownFailures?: readonly { match: RegExp; advice: string }[];
  /** Rules a fix must NOT break — quoted in every repair packet for this
   *  handler (e.g. "never lower minimumYears"). */
  never?: readonly string[];
  /** Assertions on what the handler produced (registry/gates.ts). A failed
   *  gate fails the handler: no stamp, publish held. */
  gates?: readonly import("./gates").Gate[];
  /** Repo-relative trees the handler writes; the commit pathspec. */
  outputs?: readonly string[];
  notes?: string;
}

export const markerOf = (h: Handler): string => h.marker ?? h.id;

/** A step's needs: its own plus the handler's. */
export const stepNeeds = (h: Handler, s: Step): readonly Need[] => [
  ...(h.needs ?? []),
  ...(s.needs ?? []),
];
