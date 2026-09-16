import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { preselectCandidates } from "../orchestrator/toolPreselector";
import { route } from "../orchestrator/router";
import { TOOLS_BY_NAME } from "../tools/registry";
import type { Lang } from "../tools/types";

// G2 — HONEST candidate-set recall, on the repo's HELD-OUT query set.
//
// The pre-selector's own ceiling is whether the gold tool is even IN the candidate
// set: whatever the model does later, it can only pick a tool still there. Measured on
// `ai/m0/finetune/recall_queries.json` — 750 novel Gemini-generated bilingual queries
// (3 per language per tool), authored independently of the registry's example strings.
//
// Two things make it honest, and both are the point of the gate:
//
//  1. the `verbatim` arm is DISABLED. It matches the registry's example strings, so
//     leaving it on would score a query that happens to BE an example as "retrieved",
//     measuring leakage instead of recall.
//  2. the figure is on the RULES-DECLINED RESIDUAL — the queries the deterministic
//     router returns NOTHING for, which is the model's real input. Recall over all 750
//     flatters the pre-selector with questions the rules already answer.
//
// WHAT IT FOUND, and this is the finding the gate exists for: recall is INADEQUATE at
// the shallow depths the plan originally proposed and ADEQUATE only at the depth the
// byte bound actually keeps. The plan's fixed K=12..16 would have capped recall at
// ~0.49-0.56; removing the tool-count cap was therefore load-bearing, not cosmetic.
// The measured remedy for a deep cut is the repo's published semantic ranker
// (`data/ai/evals/retriever_recall.json`), which the plan's §7 escalation names.

const QUERIES = JSON.parse(
  readFileSync(
    join(process.cwd(), "ai/m0/finetune/recall_queries.json"),
    "utf8",
  ),
) as Record<string, Partial<Record<Lang, string[]>>>;

type Case = { gold: string; question: string; lang: Lang };
const CASES: Case[] = Object.entries(QUERIES).flatMap(([gold, byLang]) =>
  (["bg", "en"] as const).flatMap((lang) =>
    (byLang[lang] ?? []).map((question) => ({ gold, question, lang })),
  ),
);
const DECLINED = CASES.filter(
  (c) => route(c.question, { lang: c.lang, election: "2026_04_19" }) === null,
);

// ONE pass over the residual, scoring every depth at once.
const KS = [1, 3, 5, 8, 12, 16, 24, 40, 80, 150, 203, 235] as const;
const HITS = new Map<number, number>(KS.map((k) => [k, 0]));
let unknownTool = 0;
const SIZES: number[] = [];
for (const c of DECLINED) {
  if (!TOOLS_BY_NAME[c.gold]) unknownTool++;
  const ranked = preselectCandidates(c.question, {
    withoutVerbatim: true,
  }).map((x) => x.tool);
  SIZES.push(ranked.length);
  for (const k of KS)
    if (ranked.slice(0, k).includes(c.gold)) HITS.set(k, HITS.get(k)! + 1);
}
const recall = (k: number) =>
  DECLINED.length ? HITS.get(k)! / DECLINED.length : 0;
const MEAN_SIZE = SIZES.reduce((a, b) => a + b, 0) / (SIZES.length || 1);

describe("candidate-set recall on the held-out query set (G2)", () => {
  it("uses the repo's held-out queries and the rules-declined residual", () => {
    expect(CASES).toHaveLength(750);
    // The published `recall_report.json` recorded 163 declined of 750; the router has
    // improved since, and this pins that the residual is still the same ORDER of
    // magnitude rather than silently collapsing (which would make this gate easier).
    expect(DECLINED.length).toBeGreaterThan(80);
    expect(DECLINED.length).toBeLessThan(200);
    for (const c of DECLINED)
      expect(
        route(c.question, { lang: c.lang, election: "2026_04_19" }),
        c.question,
      ).toBeNull();
    // No query names a tool the registry does not have, so the denominator is honest.
    expect(unknownTool).toBe(0);
  });

  it("is INADEQUATE at the shallow depths the plan originally proposed", () => {
    // This is why the tool-count cap had to go. At K=16 — the plan's own K_MAX
    // neighbourhood — the pre-selector misses the gold tool for ~44% of the residual,
    // and the published fuse baseline for this same residual is 0.564 @8, so a shallow
    // cut is no better than the retriever it contains.
    expect(recall(8)).toBeLessThan(0.6);
    expect(recall(16)).toBeLessThan(0.7);
    expect(recall(24)).toBeLessThan(0.75);
  });

  it("is ADEQUATE at the depth the byte bound actually keeps", () => {
    // Measured 2026-09-16: the byte-driven prefix keeps ~172 candidates on average,
    // and a saturated BG thread's candidate set fits the budget at ~203 tools, so a
    // real cut is far shallower than any of the K values above.
    expect(MEAN_SIZE).toBeGreaterThan(150);
    expect(recall(150)).toBeGreaterThan(0.8);
    expect(recall(203)).toBeGreaterThan(0.85);
  });

  it("is monotone in K, so a deeper cut can never be worse", () => {
    // The property the safety argument rests on: keeping more candidates cannot lose a
    // tool. A non-monotone curve would mean the ranking has an inversion.
    for (let i = 1; i < KS.length; i++)
      expect(
        recall(KS[i]),
        `K=${KS[i]} vs ${KS[i - 1]}`,
      ).toBeGreaterThanOrEqual(recall(KS[i - 1]));
  });

  it("records the published remedy for a deep cut", () => {
    // The plan's §7 escalation, measured by the repo rather than by this test: the
    // fine-tuned e5-small reaches 100% recall@8 and gemini-embedding-001 95.1% on this
    // same residual, against lexical's 49.1%. A future registry large enough to force a
    // deep cut must adopt one of them rather than tighten the arms here.
    const published = JSON.parse(
      readFileSync(
        join(process.cwd(), "data/ai/evals/retriever_recall.json"),
        "utf8",
      ),
    ) as {
      rows: { id: string; declined: Record<string, number> }[];
    };
    const byId = Object.fromEntries(
      published.rows.map((r) => [r.id, r.declined]),
    );
    expect(byId.lexical[8]).toBeLessThan(0.6);
    expect(byId["e5-small-naiasno"][8]).toBeGreaterThan(0.95);
    // ...and the pre-selector's own deep-cut number is worse than the remedy, which is
    // the whole reason the remedy is recorded rather than assumed unnecessary.
    expect(recall(8)).toBeLessThan(byId["e5-small-naiasno"][8]);
  });
});
