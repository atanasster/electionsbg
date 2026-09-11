// Local replay only: does not call a model or rewrite the frozen experiment.
import { readFileSync, writeFileSync } from "node:fs";
import { hash } from "../corpus";
import { requireAssessedNarration } from "./narrationAssessment";
import { semanticGrounded } from "../../llm/semanticGrounding";
import { matchesLang } from "../../llm/lang";
const dir = "data/ai/toolgrad/defaults";
const failures: Record<string, string> = {
  "turnout:en":
    "Strict rubric violation: 'one-year period' computes a duration not supplied as a fact; mathematically correct, not a factual hallucination.",
  "assets-small:bg":
    "Calls unaudited declarations 'ненадеждни' (unreliable), an unsupported reliability judgment.",
  "assets-small:en":
    "Computes 70,000 euros net difference, absent from the supplied facts.",
  "tax-rates:bg":
    "Claims an assessment of the urban environment and regional values despite receiving only a place and indicator count.",
  "tax-rates:en":
    "Misattributes the indicator count as an indicator 'value of one'.",
};
const reports = ["baseline", "candidate"].map((variant) => {
  const report = JSON.parse(
    readFileSync(`${dir}/narration-${variant}/report.json`, "utf8"),
  );
  requireAssessedNarration(variant, report);
  if (
    !report.complete ||
    report.rows.length !== 18 ||
    report.rows.some((r: { error?: string }) => r.error)
  )
    throw new Error("Incomplete experiment");
  const rows = report.rows.map(
    (r: {
      id: string;
      split: string;
      text: string;
      lang: "bg" | "en";
      accepted: boolean;
      env: { facts: unknown; title: string };
    }) => ({
      id: r.id,
      split: r.split,
      rubricPass: variant !== "baseline" || !failures[r.id],
      reason:
        variant === "baseline"
          ? (failures[r.id] ??
            "Supplied facts and rubric respected; directional comparisons without computed amounts are allowed.")
          : "Supplied facts and rubric respected.",
      editorialNote:
        variant === "candidate" && r.id === "risk:bg"
          ? "Untranslated screening_signals and fixture provenance; script guard does not ensure idiomatic Bulgarian."
          : variant === "baseline" && r.id === "contract:bg"
            ? "Final sentence about the difference between awarded and paid is ambiguous, but the preceding text explicitly states payment is unknown."
            : null,
      originalAccepted: r.accepted,
      replayAccepted:
        matchesLang(r.text, r.lang) &&
        semanticGrounded(r.text, r.env.facts, r.env.title),
    }),
  );
  return {
    variant,
    reportHash: hash(report),
    rows,
    rubricPass: rows.filter((r: { rubricPass: boolean }) => r.rubricPass)
      .length,
    originalAccepted: rows.filter(
      (r: { originalAccepted: boolean }) => r.originalAccepted,
    ).length,
    replayAccepted: rows.filter(
      (r: { replayAccepted: boolean }) => r.replayAccepted,
    ).length,
  };
});
writeFileSync(
  `${dir}/narration-review.json`,
  JSON.stringify(
    {
      version: 1,
      method:
        "Coding-agent local rubric assessment, not blinded human review or model grading. Outputs and pre-call cases preserved. Replay uses the current guard after fixing an observed false rejection; it is not fresh validation of that repair.",
      guardSourceHash: hash(
        readFileSync("ai/llm/semanticGrounding.ts", "utf8"),
      ),
      limitations: [
        "Lexical guards are not entailment checks and can miss unsupported claims or reject valid paraphrases.",
        "Bilingual pairs are correlated; one small run cannot establish statistical significance.",
        "Tax cases change supplied fact coverage as well as the prompt; their benefit cannot be attributed to prompt tuning alone.",
        "Original runs predate guardSourceHash metadata; their recorded acceptance is retained, not relabeled as the repaired guard.",
      ],
      reports,
    },
    null,
    2,
  ) + "\n",
);
