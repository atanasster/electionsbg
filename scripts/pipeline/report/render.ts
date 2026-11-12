// report.md — rendered from run.json only, fixed headings in a fixed order so a
// reader (human or LLM) always finds the same thing in the same place:
//
//   Verdict → Failures → Needs operator → Needs agent → What ran → Findings
//   → Timings vs median → Publish decision → Next commands
//
// Nothing in a log or a result file is trusted as markdown: every value is
// flattened onto one line, and code spans are fenced so a backtick in the data
// cannot open structure. The same rule scripts/watch/report.ts applies.

import { formatDuration } from "../../perf/perf_log";
import type { RunRecord, StepRecord } from "./record";

export const flat = (v: unknown): string =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();

/** An inline code span that survives any backticks inside it. */
export const code = (v: unknown): string => {
  const s = flat(v);
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((m) => m.length));
  const fence = "`".repeat(longest + 1);
  return longest ? `${fence} ${s} ${fence}` : `${fence}${s}${fence}`;
};

/** A fenced block that survives any backtick run inside it. */
export const fenced = (body: string, lang = ""): string => {
  const longest = Math.max(
    2,
    ...(body.match(/`+/g) ?? []).map((m) => m.length),
  );
  const fence = "`".repeat(longest + 1);
  return `${fence}${lang}\n${body}\n${fence}`;
};

const SLOW_FACTOR = 1.5;

const isSlow = (s: StepRecord): boolean =>
  s.medianMs !== undefined &&
  s.medianMs > 5_000 &&
  s.durationMs > s.medianMs * SLOW_FACTOR;

export const renderReport = (rec: RunRecord): string => {
  const out: string[] = [];
  const steps = rec.units.flatMap((u) =>
    u.steps.map((s) => ({ unit: u.id, s })),
  );
  const failed = steps.filter(
    ({ s }) => s.status === "error" || s.status === "timeout",
  );
  const failedGates = rec.units.flatMap((u) =>
    u.gates.filter((g) => !g.ok).map((g) => ({ unit: u.id, g })),
  );

  out.push(`# Pipeline ${rec.kind} run — ${rec.session}`);
  out.push(
    `Started ${rec.startedAt}${rec.endedAt ? ` · ended ${rec.endedAt}` : " · still running"} · git ${rec.git.shaStart?.slice(0, 10) ?? "?"}${rec.git.shaEnd ? ` → ${rec.git.shaEnd.slice(0, 10)}` : ""}`,
  );

  out.push("", "## Verdict");
  const count = (st: string): number =>
    rec.units.filter((u) => u.status === st).length;
  out.push(
    `**${(rec.verdict ?? "unfinished").toUpperCase()}** (exit ${rec.exitCode ?? "?"}) — ` +
      `${rec.units.length} unit(s): ${count("ok")} ok · ${count("partial")} partial · ${count("failed")} failed · ` +
      `${count("blocked")} blocked · ${count("needs-operator")} needs operator · ${count("skipped")} skipped`,
  );

  out.push("", "## Failures");
  if (!failed.length && !failedGates.length) out.push("_(none)_");
  for (const { unit, s } of failed)
    out.push(
      `- **${flat(unit)} › ${flat(s.id)}** — ${s.status}, exit ${s.exitCode ?? "signal"} after ${formatDuration(s.durationMs)}; ` +
        `class ${code(s.failure?.class ?? "unknown")}. ${flat(s.failure?.hint)}` +
        (s.firstError ? `\n  First error: ${code(s.firstError)}` : "") +
        (s.packet
          ? `\n  Repair packet: ${code(s.packet)} · log ${code(s.log)}`
          : `\n  Log: ${code(s.log)}`),
    );
  for (const { unit, g } of failedGates)
    out.push(
      `- **${flat(unit)} › gate ${flat(g.id)}** — expected ${code(g.expected)}, observed ${code(g.observed)}`,
    );

  out.push("", "## Needs operator");
  if (!rec.needsOperator.length) out.push("_(none)_");
  for (const n of rec.needsOperator)
    out.push(
      `- **${flat(n.unit)}** (${flat(n.id)}): ${flat(n.instruction)}` +
        (n.url ? ` Source: ${flat(n.url)}.` : "") +
        (n.dropDir ? ` Drop into ${code(n.dropDir)}.` : "") +
        ` Then: ${code(`pnpm run pipeline:ack ${n.unit} ${n.id}`)}`,
    );

  out.push("", "## Needs agent");
  if (!rec.needsAgent.length) out.push("_(none)_");
  for (const n of rec.needsAgent)
    out.push(
      `- **${flat(n.unit)}** (${flat(n.id)}): ${flat(n.instruction)} Runbook: ${code(n.doc)}`,
    );

  out.push("", "## What ran");
  for (const u of rec.units) {
    out.push(
      `### ${flat(u.id)} — ${u.status}${u.stamped === undefined ? "" : u.stamped ? " · marker stamped" : " · marker NOT stamped"}`,
    );
    if (u.why) out.push(`Why: ${flat(u.why)}`);
    if (u.sources?.length)
      out.push(`Sources: ${u.sources.map(code).join(", ")}`);
    if (u.summary) out.push(`Summary: ${flat(u.summary)}`);
    if (u.steps.length) {
      out.push(
        "",
        "| # | step | status | time | note |",
        "|---|---|---|---|---|",
      );
      for (const s of u.steps)
        out.push(
          `| ${s.seq} | ${flat(s.id).replace(/\|/g, "\\|")} | ${s.status} | ${formatDuration(s.durationMs)} | ${flat(
            s.status === "ok"
              ? (s.result?.summary ?? "")
              : (s.firstError ?? ""),
          )
            .replace(/\|/g, "\\|")
            .slice(0, 160)} |`,
        );
    }
    for (const s of u.steps) {
      if (s.result?.counts && Object.keys(s.result.counts).length)
        out.push(
          `Counts (${flat(s.id)}): ` +
            Object.entries(s.result.counts)
              .map(([k, v]) => `${flat(k)}=${v}`)
              .join(", "),
        );
      for (const w of s.result?.warnings ?? [])
        out.push(`Warning (${flat(s.id)}): ${flat(w)}`);
      if (s.resultError)
        out.push(`Result file problem (${flat(s.id)}): ${flat(s.resultError)}`);
    }
    if (u.filesChanged?.length)
      out.push(
        `Files changed: ${u.filesChanged.slice(0, 20).map(code).join(", ")}${u.filesChanged.length > 20 ? ` … +${u.filesChanged.length - 20}` : ""}`,
      );
    out.push("");
  }

  out.push("## Findings");
  if (!rec.findings.length) out.push("_(none)_");
  for (const f of rec.findings) out.push(`- ${flat(f)}`);

  out.push("", "## Timings vs median");
  const timed = steps.filter(({ s }) => s.status !== "skipped");
  const total = timed.reduce((n, { s }) => n + s.durationMs, 0);
  out.push(
    `Sum of step durations: ${formatDuration(total)} over ${timed.length} step(s).`,
  );
  const slow = timed.filter(({ s }) => isSlow(s));
  if (slow.length)
    for (const { unit, s } of slow)
      out.push(
        `- slower than usual: ${flat(unit)} › ${flat(s.id)} ${formatDuration(s.durationMs)} vs median ${formatDuration(s.medianMs ?? 0)}`,
      );
  else out.push("No step ran more than 1.5× its median.");

  out.push("", "## Publish decision");
  if (!rec.publish || rec.publish.decision === "n/a")
    out.push("_(not applicable to this run)_");
  else {
    out.push(`**${rec.publish.decision.toUpperCase()}**`);
    for (const r of rec.publish.heldBecause) out.push(`- held: ${flat(r)}`);
  }

  out.push("", "## Next commands");
  const next: string[] = [];
  for (const { s } of failed)
    if (s.packet) next.push(`# fix, then re-run: see ${s.packet}`);
  if (rec.kind === "ingest" && rec.publish?.decision === "go")
    next.push("pnpm run pipeline:publish");
  if (rec.kind === "ingest" && rec.publish?.decision === "held")
    next.push(
      "# publish held — fix the failures above, then: pnpm run pipeline:publish",
    );
  next.push(`pnpm run pipeline:report --session ${rec.session}`);
  out.push(fenced(next.join("\n"), "bash"));

  return out.join("\n") + "\n";
};
