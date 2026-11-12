// Plain-text rendering of a Plan, for the terminal and for run reports.
// Everything comes from the Plan object, so `--json` and the text never differ.

import type { Plan } from "./planner";

export const renderPlan = (pl: Plan): string => {
  const lines: string[] = [];
  const count = (s: string): number =>
    pl.entries.filter((e) => e.status === s).length;
  lines.push(`# Pipeline plan — ${pl.generatedAt}`);
  lines.push(
    `${pl.entries.length} handler(s) due: ${count("run")} run · ` +
      `${count("blocked")} blocked · ${count("needs-operator")} needs operator · ` +
      `${count("bootstrap")} bootstrap · ${count("nothing-to-run")} nothing to run`,
  );
  for (const e of pl.entries) {
    lines.push("");
    lines.push(
      `## ${e.handler} [${e.status}] (${e.runner}${e.skill ? `, runbook ${e.skill}` : ""})`,
    );
    if (e.why) lines.push(`  why: ${e.why}`);
    for (const r of e.reasons)
      lines.push(
        `  moved: ${r.source} at ${r.lastChanged} (marker ${e.marker}: ${r.lastIngest ?? "none"})`,
      );
    if (!e.stampable)
      lines.push(
        `  marker NOT stamped this run — deferred: ${e.deferred.join(", ")}`,
      );
    for (const s of e.steps)
      lines.push(
        s.status === "run"
          ? `  run  ${s.id}: ${s.run}`
          : `  skip ${s.id}: ${s.why}`,
      );
    for (const o of e.operator)
      lines.push(`  operator (${o.blocks}) ${o.id}: ${o.instruction}`);
    for (const a of e.agent)
      lines.push(`  agent ${a.id}: ${a.instruction} [${a.doc}]`);
  }
  if (pl.followUps.length)
    lines.push("", `Follow-ups: ${pl.followUps.join(", ")}`);
  if (pl.cloud.length) {
    lines.push("", "Cloud publish, in order:");
    pl.cloud.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));
  }
  if (pl.unrouted.length)
    lines.push("", `Unrouted watcher sources: ${pl.unrouted.join(", ")}`);
  if (pl.warnings.length) {
    lines.push("", "Warnings:");
    for (const w of pl.warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n") + "\n";
};
