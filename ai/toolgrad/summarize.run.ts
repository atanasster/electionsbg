// node --import tsx ai/toolgrad/summarize.run.ts
import { readFileSync, writeFileSync } from "node:fs";
const root = "data/ai/toolgrad/";
const read = (p: string) => JSON.parse(readFileSync(root + p, "utf8"));
const db = read("development-baseline/report.json"),
  dc = read("development-candidate/report.json"),
  vb = read("validation-baseline/report.json"),
  vc = read("validation-candidate/report.json");
for (const [b, c] of [
  [db, dc],
  [vb, vc],
]) {
  if (
    !b.complete ||
    !c.complete ||
    b.metrics.errors ||
    c.metrics.errors ||
    b.suiteHash !== c.suiteHash ||
    b.scoringHash !== c.scoringHash
  )
    throw new Error("Incomplete or incomparable paired evaluation");
}
const gates = {
  developmentImproved: dc.metrics.callCorrect > db.metrics.callCorrect,
  holdoutImproved:
    vc.groups.holdout.callCorrect > vb.groups.holdout.callCorrect,
  referenceNotWorse:
    vc.groups.reference.callCorrect >= vb.groups.reference.callCorrect,
  clarificationNotWorse:
    vc.groups.reference.clarificationCorrect >=
    vb.groups.reference.clarificationCorrect,
};
const generation = read("generation.json"),
  narration = read("narration/report.json"),
  semantic = read("narration/review.json");
const routing = [db, dc, vb, vc];
const summary = {
  version: 1,
  decision: Object.values(gates).every(Boolean)
    ? "eligible-for-review"
    : "do-not-promote",
  gates,
  runtimeChanged: false,
  calls: {
    generation: generation.totalRecordedAttempts,
    routing: routing.reduce((s, r) => s + r.calls, 0),
    narration: narration.calls,
  },
  reservationCeilingUSD:
    generation.totalRecordedReservationCeilingUSD +
    routing.reduce((s, r) => s + r.reservationCeilingUSD, 0) +
    narration.reservationCeilingUSD,
  billedUSD: null,
  costNote:
    "Provider omitted billed cost; reservation ceiling is conservative accounting, not actual spend.",
  comparison: {
    development: { baseline: db.metrics, candidate: dc.metrics },
    holdout: { baseline: vb.groups.holdout, candidate: vc.groups.holdout },
    reference: {
      baseline: vb.groups.reference,
      candidate: vc.groups.reference,
    },
  },
  interpretation: {
    syntheticCases: 8,
    numberGatePassed: semantic.numberGatePassed,
    languageGatePassed: semantic.languageGatePassed,
    locallyReviewedSemanticPassed: semantic.semanticPassed,
  },
  limitations: [
    "One stochastic run per variant; paraphrases are clustered in24 workflows, not144 independent tasks.",
    "Generated wording comes from contracts. Masked entity tasks do not test real entity resolution.",
    "Reference questions predate the pilot but may have influenced the existing prompt; their argument checks are partial.",
    "Frozen gold remains unchanged after evaluation. Some city/province and transfer-type/ranking wording is ambiguous; exact-workflow accuracy is not adjudicated user-answer quality.",
    "Synthetic narration smoke checks are not live factual-accuracy measurements; local agent review is not human review.",
    "No fine-tuning, serving change or deployment. Rejected candidate is retained for reproducibility.",
  ],
};
writeFileSync(root + "summary.json", JSON.stringify(summary, null, 2) + "\n");
console.log(
  JSON.stringify({
    decision: summary.decision,
    gates,
    calls: summary.calls,
    reservation: summary.reservationCeilingUSD,
  }),
);
