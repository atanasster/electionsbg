import type { ManualRequest, ReportEntry } from "./types";
import { formatSofia } from "./fingerprint";

export const renderReport = (entries: ReportEntry[], runAt: string): string => {
  const today = runAt.slice(0, 10);
  const dateLabel = formatSofia(runAt);
  const changed = entries.filter(
    (e) => e.status === "changed" || e.status === "first-run",
  );
  const unchanged = entries.filter((e) => e.status === "unchanged");
  const skipped = entries.filter((e) => e.status === "skipped");
  const errors = entries.filter((e) => e.status === "error");
  const blocked = entries.filter((e) => e.status === "blocked");

  const sections: string[] = [];
  sections.push(`# Watch report — ${today} (${dateLabel} Europe/Sofia)`);

  // ABOVE „Changed", because a missing input blocks the ingest entirely — there
  // is nothing to run even when the upstream did move. Rendered only when
  // something is outstanding: a permanent empty section is one everybody learns
  // to scroll past, and this one has to still be readable on the day it matters.
  // Nothing about a ManualRequest is trusted markdown, and `files` is
  // documented as upstream-derived. A newline in `instruction` emits a literal
  // „## Changed" heading ABOVE the real one, with a fabricated bullet under it;
  // a backtick in `dropDir` breaks the code span. Flattened rather than
  // escaped: these are one-line fields by contract, so collapsing whitespace is
  // both the fix and an assertion about the shape.
  const flat = (v: string): string => v.replace(/\s+/g, " ").trim();
  const code = (v: string): string => "`" + flat(v).replace(/`/g, "'") + "`";

  const manual = entries.filter(
    (e): e is ReportEntry & { manual: ManualRequest } => e.manual != null,
  );
  if (manual.length > 0) {
    sections.push("\n## Manual downloads needed");
    for (const e of manual) {
      const m = e.manual;
      sections.push(`- **${flat(e.source.label)}**: ${flat(m.instruction)}`);
      const link = (v: string): string => `[${flat(v)}](${flat(v)})`;
      sections.push(
        m.dropDir
          ? `  Save from ${link(m.url)} into ${code(m.dropDir)}:`
          : `  Source: ${link(m.url)}`,
      );
      for (const f of m.files ?? []) sections.push(`  - ${code(f)}`);
    }
  }

  sections.push("\n## Changed");
  if (changed.length === 0) {
    sections.push("_(no changes — all upstreams stable)_");
  } else {
    for (const e of changed) {
      const tag = e.status === "first-run" ? " · first run" : "";
      sections.push(`- **${e.source.label}**${tag}: ${e.line}`);
    }
  }

  sections.push("\n## Unchanged");
  if (unchanged.length === 0) {
    sections.push("_(none)_");
  } else {
    for (const e of unchanged) {
      sections.push(`- ${e.source.label}: ${e.line}`);
    }
  }

  if (skipped.length > 0) {
    sections.push("\n## Skipped (off-cadence)");
    for (const e of skipped) {
      sections.push(`- ${e.source.label} (${e.source.cadence}): ${e.line}`);
    }
  }

  if (blocked.length > 0) {
    sections.push("\n## Blocked (wrong exit country — not probed)");
    for (const e of blocked) {
      const streak =
        (e.consecutiveBlocked ?? 0) > 1
          ? ` _(blocked ${e.consecutiveBlocked} runs in a row)_`
          : "";
      sections.push(`- ${e.source.label}: ${e.line}${streak}`);
    }
  }

  sections.push("\n## Errors");
  if (errors.length === 0) {
    sections.push("_(none)_");
  } else {
    for (const e of errors) {
      const streak =
        (e.consecutiveErrors ?? 0) > 1
          ? ` _(failing ${e.consecutiveErrors} runs in a row)_`
          : "";
      sections.push(`- **${e.source.label}**: ${e.line}${streak}`);
    }
  }

  sections.push("\n---");
  sections.push(`_Watcher run at ${runAt} UTC._`);

  return sections.join("\n") + "\n";
};

/** The same run as data — what scripts and the pipeline read instead of
 *  parsing markdown (plan §3.1). One entry per registered source. */
export interface JsonReport {
  schema: 1;
  runAt: string;
  egress: string | null;
  /** Why the exit country is unknown (every source was then probed). */
  egressError?: string;
  sources: {
    id: string;
    label: string;
    status: ReportEntry["status"];
    line: string;
    error?: string;
    durationMs?: number;
    consecutiveErrors?: number;
    consecutiveBlocked?: number;
    manual?: ManualRequest;
  }[];
}

export const renderJsonReport = (
  entries: ReportEntry[],
  runAt: string,
  egress: string | null,
  egressError?: string,
): JsonReport => ({
  schema: 1,
  runAt,
  egress,
  ...(egressError ? { egressError } : {}),
  sources: entries.map((e) => ({
    id: e.source.id,
    label: e.source.label,
    status: e.status,
    line: e.line,
    ...(e.error ? { error: e.error } : {}),
    ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
    ...(e.consecutiveErrors ? { consecutiveErrors: e.consecutiveErrors } : {}),
    ...(e.consecutiveBlocked
      ? { consecutiveBlocked: e.consecutiveBlocked }
      : {}),
    ...(e.manual ? { manual: e.manual } : {}),
  })),
});
