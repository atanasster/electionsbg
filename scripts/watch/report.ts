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

  sections.push("\n## Errors");
  if (errors.length === 0) {
    sections.push("_(none)_");
  } else {
    for (const e of errors) {
      sections.push(`- **${e.source.label}**: ${e.line}`);
    }
  }

  sections.push("\n---");
  sections.push(`_Watcher run at ${runAt} UTC._`);

  return sections.join("\n") + "\n";
};
