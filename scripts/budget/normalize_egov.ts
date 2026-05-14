// Economic-grain normalizer — turns the data.egov.bg КФП feed into BudgetFacts
// at the `economic` classification grain, plus the economic registry.
//
// The feed's monthly resources carry, for the five top-level sections AND
// their line items, both a "Закон" (plan) and an "Изпълнение" (execution)
// column. For a complete fiscal year that gives a real full-year plan-vs-actual
// pair per economic node — the input the reconciler turns into variance.
//
// Ministry-grain execution is deliberately NOT here: the КФП feed has no
// administrative breakdown, and the year-end execution report's per-unit
// tables are not cleanly machine-readable (the Сметна палата audit is
// narrative prose; the Ministry of Finance annexes 403 automated clients).
// So execution lives at the economic grain; the law gives the admin grain.

import { createHash } from "crypto";
import { slugify } from "./slug";
import { LAW_PROMULGATION } from "./facts";
import type { ParsedResource } from "./kfp";
import type {
  BudgetFact,
  BudgetStage,
  ClassificationNode,
  ClassificationRegistry,
  FactKind,
  Money,
} from "./types";

// Economic node id for a top-level section — keyed on its КФП series so it is
// stable regardless of label wording.
const sectionNodeId = (series: string): string => `eco-${series.toLowerCase()}`;

const factKey = (
  fiscalYear: number,
  stage: BudgetStage,
  kind: FactKind,
  economicId: string,
): string =>
  createHash("sha256")
    .update(`${fiscalYear}|${stage}|0|${kind}|economic:${economicId}`)
    .digest("hex")
    .slice(0, 12);

// The latest resource of each fiscal year — December for a complete year (the
// full-year figure), else the most recent month available.
const latestPerYear = (parsed: ParsedResource[]): ParsedResource[] => {
  const byYear = new Map<number, ParsedResource>();
  for (const p of parsed) {
    const cur = byYear.get(p.header.fiscalYear);
    if (!cur || p.header.period > cur.header.period) {
      byYear.set(p.header.fiscalYear, p);
    }
  }
  return [...byYear.values()].sort(
    (a, b) => a.header.fiscalYear - b.header.fiscalYear,
  );
};

interface EconomicNormalizeResult {
  factsByYear: Map<number, BudgetFact[]>;
  registry: ClassificationRegistry;
}

// Build economic-grain facts (law + execution stages) and the economic
// classification registry from the egov feed.
export const buildEconomicFacts = (
  parsed: ParsedResource[],
): EconomicNormalizeResult => {
  const resources = latestPerYear(parsed);
  const factsByYear = new Map<number, BudgetFact[]>();
  const nodes = new Map<string, ClassificationNode>();

  const registerNode = (
    id: string,
    nameBg: string,
    parentId: string | null,
    fiscalYear: number,
  ): void => {
    let node = nodes.get(id);
    if (!node) {
      node = {
        id,
        dimension: "economic",
        nameBg,
        nameEn: "",
        parentId,
        history: [],
      };
      nodes.set(id, node);
    }
    if (!node.history.some((h) => h.fiscalYear === fiscalYear)) {
      node.history.push({ fiscalYear, sourceCode: nameBg, sourceName: nameBg });
    }
  };

  for (const res of resources) {
    const { fiscalYear, asOf } = res.header;
    const lawDate = LAW_PROMULGATION[fiscalYear] ?? `${fiscalYear}-01-01`;
    const facts: BudgetFact[] = [];

    const emit = (
      economicId: string,
      kind: FactKind,
      planned: Money | null,
      executed: Money | null,
    ): void => {
      for (const [stage, money, effectiveDate] of [
        ["law", planned, lawDate],
        ["execution", executed, asOf],
      ] as Array<[BudgetStage, Money | null, string]>) {
        if (!money) continue;
        facts.push({
          key: factKey(fiscalYear, stage, kind, economicId),
          fiscalYear,
          version: {
            stage,
            seq: 0,
            effectiveDate,
            documentId: "kfp-egov",
          },
          kind,
          classification: {
            admin: null,
            functional: null,
            economic: economicId,
            program: null,
            programLine: null,
          },
          grain: ["economic"],
          money,
          sourceRef: {
            documentId: "kfp-egov",
            sheet: res.uuid,
            rowLabel: economicId,
          },
        });
      }
    };

    for (const section of res.sections) {
      const sectionId = sectionNodeId(section.series);
      registerNode(sectionId, section.labelBg, null, fiscalYear);
      emit(sectionId, section.kind, section.planned, section.executed);

      // Line items, with collision-safe ids (the feed repeats a few labels).
      const usedInSection = new Map<string, number>();
      for (const line of section.lines) {
        let lineId = slugify(line.labelBg, "eco");
        const seen = usedInSection.get(lineId) ?? 0;
        usedInSection.set(lineId, seen + 1);
        if (seen > 0) lineId = `${lineId}-${seen + 1}`;
        registerNode(lineId, line.labelBg, sectionId, fiscalYear);
        emit(lineId, section.kind, line.planned, line.executed);
      }
    }

    facts.sort((a, b) =>
      a.classification.economic === b.classification.economic
        ? `${a.version.stage}${a.kind}`.localeCompare(
            `${b.version.stage}${b.kind}`,
          )
        : (a.classification.economic ?? "").localeCompare(
            b.classification.economic ?? "",
          ),
    );
    factsByYear.set(fiscalYear, facts);
  }

  return {
    factsByYear,
    registry: {
      dimension: "economic",
      generatedAt: new Date().toISOString(),
      nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    },
  };
};
