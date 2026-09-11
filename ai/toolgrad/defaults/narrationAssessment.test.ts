import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { requireAssessedNarration } from "./narrationAssessment";
it.each(["baseline", "candidate"])(
  "binds %s judgments to the assessed responses",
  (variant) => {
    const report = JSON.parse(
      readFileSync(
        `data/ai/toolgrad/defaults/narration-${variant}/report.json`,
        "utf8",
      ),
    );
    expect(() => requireAssessedNarration(variant, report)).not.toThrow();
    report.rows[0].text = "Unreviewed replacement response";
    expect(() => requireAssessedNarration(variant, report)).toThrow(
      "Unassessed narration report",
    );
  },
);
