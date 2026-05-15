// Turn parsed ministry execution reports into admin-grain BudgetFacts.
//
// The program-budget execution report gives, per first-level spending unit,
// THREE columns we care about — Закон / Уточнен план / Отчет. We emit one
// `BudgetFact` per stage at the `admin` grain so the reconciler can join the
// whole journey:
//   law (отчет's "Закон")  →  amended (уточнен план)  →  executed (отчет)
//
// Why also emit `law` here, when `law_html.ts` already emits law facts from
// the State Budget Law itself: the отчет's "Закон" column restates the
// appropriation at the отчет's scope — for some ministries this is the
// CONSOLIDATED annual budget (own + EU-fund + transfers) which is materially
// larger than the State Budget Law's section II РАЗХОДИ that `law_html.ts`
// parses. Joining law_html's value to отчет's amended/executed produces a
// fake "amendment trail" that is mostly scope-difference (e.g. МОСВ 2024:
// law_html €60M vs отчет's "Закон" €104M). Using the отчет's "Закон" here
// keeps the trail like-with-like; the reconciler prefers it when present, and
// `documentId: exec-…` (vs `law-…`) makes the provenance explicit.
//
// Program-grain facts are NOT emitted yet: the report's programmes are keyed
// by the МФ classification code, which has no crosswalk to the law's program
// registry (keyed by programme name) — that crosswalk is a separate increment.
// The parser still captures `unit.programs`; this builder just doesn't fact
// them until the join exists.

import { createHash } from "crypto";
import { LAW_PROMULGATION } from "./facts";
import { slugify } from "./slug";
import type { ParsedExecutionUnit } from "./execution_pdf";
import type {
  BudgetFact,
  BudgetStage,
  ClassificationRegistry,
  FactKind,
  Money,
} from "./types";

// Match a programme name in the отчет to a node in the law's program
// registry. Same admin owner; same normalised name (strip "Бюджетна програма"
// boilerplate + quote marks; lowercase via slugify).
const normaliseProgramName = (name: string): string =>
  name
    .replace(/Бюджетна(?:та)?\s+програма/gi, "")
    .replace(/[„"”'']/g, "")
    .replace(/\s+/g, " ")
    .trim();

const findProgramNode = (
  registry: ClassificationRegistry,
  adminId: string,
  programName: string,
): string | null => {
  const want = slugify(normaliseProgramName(programName), "prog");
  for (const n of registry.nodes) {
    if (n.ownerAdminId !== adminId) continue;
    if (slugify(normaliseProgramName(n.nameBg), "prog") === want) return n.id;
  }
  return null;
};

// Stable document id for a ministry's execution report — referenced from
// documents.json and from every fact's sourceRef.
export const executionDocumentId = (
  adminId: string,
  fiscalYear: number,
): string => `exec-${adminId}-${fiscalYear}`;

// factKey includes `documentId` so the отчет's restated `law`-stage fact does
// not collide with the State Budget Law's own law fact at the same
// (year, kind, admin) coordinates.
const factKey = (
  fiscalYear: number,
  stage: BudgetStage,
  seq: number,
  kind: FactKind,
  classKey: string,
  documentId: string,
): string =>
  createHash("sha256")
    .update(`${fiscalYear}|${stage}|${seq}|${kind}|${classKey}|${documentId}`)
    .digest("hex")
    .slice(0, 12);

// Emit the law + amendment + execution facts for one parsed unit.
//
// Admin grain: revenue + expenditure totals (always emitted).
// Program grain: every отчет programme that name-matches a node in the law's
//   program registry (same admin owner). The State Budget Law does NOT
//   decompose ministry budgets below the policy-area level, so this match is
//   effectively at policy-area grain (отчет `.00` codes ↔ law policy areas).
//   Unmatched отчет programmes (budget programmes the law never enumerated)
//   are dropped here.
export const buildExecutionFacts = (
  adminId: string,
  unit: ParsedExecutionUnit,
  programRegistry: ClassificationRegistry,
): BudgetFact[] => {
  const { fiscalYear, asOf } = unit;
  const documentId = executionDocumentId(adminId, fiscalYear);
  const classKey = `admin:${adminId}`;
  // The отчет's restated `law`'s effectiveDate is the State Budget Law's own
  // promulgation date when known, else the start of the fiscal year.
  const lawEffectiveDate =
    LAW_PROMULGATION[fiscalYear] ?? `${fiscalYear}-01-01`;
  const facts: BudgetFact[] = [];

  const classification = {
    admin: adminId,
    functional: null,
    economic: null,
    program: null,
    programLine: null,
  } as const;

  const emit = (
    kind: FactKind,
    rowLabel: string,
    law: Money | null,
    amended: Money | null,
    executed: Money | null,
  ): void => {
    // law stage — the отчет's "Закон" column. Same scope as amended +
    // executed, so the reconciler joins like-with-like (see file header).
    if (law) {
      facts.push({
        key: factKey(fiscalYear, "law", 0, kind, classKey, documentId),
        fiscalYear,
        version: {
          stage: "law",
          seq: 0,
          effectiveDate: lawEffectiveDate,
          documentId,
        },
        kind,
        classification,
        grain: ["admin"],
        money: law,
        sourceRef: { documentId, rowLabel },
      });
    }
    // amendment stage — the уточнен план. seq 1: a single consolidated
    // amendment point (the report does not break the trail into steps).
    if (amended) {
      facts.push({
        key: factKey(fiscalYear, "amendment", 1, kind, classKey, documentId),
        fiscalYear,
        version: {
          stage: "amendment",
          seq: 1,
          effectiveDate: asOf,
          documentId,
        },
        kind,
        classification,
        grain: ["admin"],
        money: amended,
        sourceRef: { documentId, rowLabel },
      });
    }
    // execution stage — the отчет.
    if (executed) {
      facts.push({
        key: factKey(fiscalYear, "execution", 0, kind, classKey, documentId),
        fiscalYear,
        version: {
          stage: "execution",
          seq: 0,
          effectiveDate: asOf,
          documentId,
        },
        kind,
        classification,
        grain: ["admin"],
        money: executed,
        sourceRef: { documentId, rowLabel },
      });
    }
  };

  emit(
    "revenue",
    "Общо приходи",
    unit.revenue.law,
    unit.revenue.amended,
    unit.revenue.executed,
  );
  emit(
    "expenditure",
    "Общо разходи",
    unit.expenditure.law,
    unit.expenditure.amended,
    unit.expenditure.executed,
  );

  // Program-grain — match by normalised programme name against the law's
  // program registry. The law has no individual budget programmes, only
  // policy areas, so only the отчет's .00 (policy-area) rows match; the rest
  // are skipped here. (If/when the law parser starts capturing budget
  // programmes too, those will also flow.)
  for (const p of unit.programs) {
    const programId = findProgramNode(programRegistry, adminId, p.nameBg);
    if (!programId) continue;
    const programClassKey = `admin:${adminId}|program:${programId}`;
    const programClassification = {
      admin: adminId,
      functional: null,
      economic: null,
      program: programId,
      programLine: null,
    } as const;

    const push = (
      stage: BudgetStage,
      seq: number,
      effectiveDate: string,
      money: Money | null,
    ): void => {
      if (!money) return;
      facts.push({
        key: factKey(
          fiscalYear,
          stage,
          seq,
          "expenditure",
          programClassKey,
          documentId,
        ),
        fiscalYear,
        version: { stage, seq, effectiveDate, documentId },
        kind: "expenditure",
        classification: programClassification,
        // grain is `program` ONLY — even though the classification.admin field
        // is filled in for provenance, the admin-grain reconciler must not
        // treat this fact as an admin-grain total (it'd otherwise overwrite
        // the ministry's "Общо разходи" with a single policy area's value).
        grain: ["program"],
        money,
        sourceRef: { documentId, rowLabel: p.nameBg },
      });
    };
    push("law", 0, lawEffectiveDate, p.law);
    push("amendment", 1, asOf, p.amended);
    push("execution", 0, asOf, p.executed);
  }

  return facts.sort((a, b) =>
    a.kind === b.kind
      ? a.version.stage.localeCompare(b.version.stage)
      : a.kind.localeCompare(b.kind),
  );
};
