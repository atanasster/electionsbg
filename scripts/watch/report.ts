import type { ReportEntry } from "./types";
import { formatSofia } from "./fingerprint";

export const renderReport = (entries: ReportEntry[], runAt: string): string => {
  const today = runAt.slice(0, 10);
  const dateLabel = formatSofia(runAt);
  const changed = entries.filter(
    (e) => e.status === "changed" || e.status === "first-run",
  );
  const unchanged = entries.filter((e) => e.status === "unchanged");
  const errors = entries.filter((e) => e.status === "error");

  const sections: string[] = [];
  sections.push(`# Watch report — ${today} (${dateLabel} Europe/Sofia)`);

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
