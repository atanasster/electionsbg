// Recompute metrics from retained outputs; never call the model or tune gold labels.
// node --import tsx ai/toolgrad/rescore.run.ts <report.json> [...]
import { readFileSync, writeFileSync } from "node:fs";
import { hash } from "./corpus";
import { scoreTask, metrics, type Row } from "./evaluation";
for (const path of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(path, "utf8"));
  r.originalScoringHash ??= r.scoringHash;
  r.scoringHash = hash(readFileSync("ai/toolgrad/evaluation.ts", "utf8"));
  r.rescoredAt = new Date().toISOString();
  r.rescoreReason =
    "Validate raw arguments before the production parser drops unknown keys. Also includes a type-only guard for optional reference history arguments. No new model requests or gold-label changes.";
  r.rows = r.rows.map((row: Row) => ({
    ...row,
    ...scoreTask(row, row.raw, row.error),
  }));
  r.metrics = metrics(r.rows);
  r.groups = Object.fromEntries(
    [...new Set<string>(r.rows.map((row: Row) => row.split))].map((split) => [
      split,
      metrics(r.rows.filter((row: Row) => row.split === split)),
    ]),
  );
  writeFileSync(path, JSON.stringify(r, null, 2) + "\n");
  console.log(path, JSON.stringify(r.groups));
}
