// Turn parsed budget-law spending units into admin-grain BudgetFacts and the
// administrative classification registry.
//
// Phase 3 (this increment): the State Budget Law gives every first-level
// spending unit its full-year appropriation. We emit one fact per
// (unit, kind) — revenue / expenditure / balance — at the `admin` grain, and
// bootstrap data/budget/classification/admin.json from the units observed
// across every parsed law year. The registry is hand-maintainable afterwards
// (merge drifted names, add ministry EIKs for the Phase 4 procurement link).

import { createHash } from "crypto";
import { slugify } from "./slug";
import type { ParsedLawUnit } from "./law_html";
import type {
  BudgetFact,
  ClassificationNode,
  ClassificationRegistry,
  FactKind,
  Money,
} from "./types";

// Държавен вестник promulgation dates, keyed by fiscal year — the
// FactVersion.effectiveDate. Hand-curated alongside LAW_DV_MATERIALS.
export const LAW_PROMULGATION: Record<number, string> = {
  2024: "2023-12-30", // ДВ бр. 108
  2025: "2025-03-27", // ДВ бр. 26
};

// Bulgarian Cyrillic → Latin, for deriving a stable, human-readable node id.
const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sht",
  ъ: "a",
  ь: "y",
  ю: "yu",
  я: "ya",
};

const slugifyUnit = (name: string): string => {
  const latin = [...name.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("");
  const slug = latin
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `admin-${slug}`;
};

// Stable English label for the common first-level spending units. Anything
// unmapped falls back to the Bulgarian name on the frontend.
const UNIT_EN: Record<string, string> = {
  "съдебната власт": "Judiciary",
  "Народното събрание": "National Assembly",
  "Сметната палата": "National Audit Office",
  "Администрацията на президента": "Presidential Administration",
  "Министерския съвет": "Council of Ministers",
  "Конституционния съд": "Constitutional Court",
  Омбудсмана: "Ombudsman",
  "Министерството на финансите": "Ministry of Finance",
  "Министерството на външните работи": "Ministry of Foreign Affairs",
  "Министерството на отбраната": "Ministry of Defence",
  "Министерството на вътрешните работи": "Ministry of the Interior",
  "Министерството на правосъдието": "Ministry of Justice",
  "Министерството на труда и социалната политика":
    "Ministry of Labour and Social Policy",
  "Министерството на здравеопазването": "Ministry of Health",
  "Министерството на образованието и науката":
    "Ministry of Education and Science",
  "Министерството на културата": "Ministry of Culture",
  "Министерството на околната среда и водите":
    "Ministry of Environment and Water",
  "Министерството на икономиката и индустрията":
    "Ministry of Economy and Industry",
  "Министерството на иновациите и растежа": "Ministry of Innovation and Growth",
  "Министерството на енергетиката": "Ministry of Energy",
  "Министерството на туризма": "Ministry of Tourism",
  "Министерството на регионалното развитие и благоустройството":
    "Ministry of Regional Development and Public Works",
  "Министерството на земеделието и храните": "Ministry of Agriculture and Food",
  "Министерството на транспорта и съобщенията":
    "Ministry of Transport and Communications",
  "Министерството на електронното управление": "Ministry of e-Governance",
  "Министерството на младежта и спорта": "Ministry of Youth and Sports",
};

// The kinds we emit at the admin grain. III (transfers) is parsed for context
// but not emitted — the FactKind vocabulary has no "transfer", and the unit's
// own spending (II → expenditure) is the figure that matters here.
const EMIT_SECTIONS: Array<{ code: string; kind: FactKind }> = [
  { code: "I", kind: "revenue" },
  { code: "II", kind: "expenditure" },
  { code: "IV", kind: "balance" },
];

const factKey = (fiscalYear: number, kind: FactKind, adminId: string): string =>
  createHash("sha256")
    .update(`${fiscalYear}|law|0|${kind}|admin:${adminId}`)
    .digest("hex")
    .slice(0, 12);

// Build the administrative classification registry from every parsed law year.
// One node per distinct unit name; the per-year source name is recorded in
// `history` so a drifted name surfaces as a new node for the operator to merge.
export const buildAdminRegistry = (
  unitsByYear: Map<number, ParsedLawUnit[]>,
): ClassificationRegistry => {
  const byId = new Map<string, ClassificationNode>();
  for (const [year, units] of [...unitsByYear.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    for (const u of units) {
      const id = slugifyUnit(u.unitName);
      let node = byId.get(id);
      if (!node) {
        node = {
          id,
          dimension: "admin",
          nameBg: u.unitName,
          nameEn: UNIT_EN[u.unitName] ?? "",
          parentId: null,
          history: [],
        };
        byId.set(id, node);
      }
      if (!node.history.some((h) => h.fiscalYear === year)) {
        node.history.push({
          fiscalYear: year,
          sourceCode: u.unitName,
          sourceName: u.unitName,
        });
      }
    }
  }
  return {
    dimension: "admin",
    generatedAt: new Date().toISOString(),
    nodes: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
};

// Emit admin-grain BudgetFacts for one parsed law year.
export const buildLawFacts = (
  fiscalYear: number,
  units: ParsedLawUnit[],
): BudgetFact[] => {
  const documentId = `law-${fiscalYear}`;
  const effectiveDate =
    LAW_PROMULGATION[fiscalYear] ?? `${fiscalYear - 1}-12-31`;
  const facts: BudgetFact[] = [];
  for (const u of units) {
    const adminId = slugifyUnit(u.unitName);
    for (const { code, kind } of EMIT_SECTIONS) {
      const section = u.sections.find((s) => s.code === code);
      const money: Money | null = section?.amount ?? null;
      if (!money) continue;
      facts.push({
        key: factKey(fiscalYear, kind, adminId),
        fiscalYear,
        version: { stage: "law", seq: 0, effectiveDate, documentId },
        kind,
        classification: {
          admin: adminId,
          functional: null,
          economic: null,
          program: null,
          programLine: null,
        },
        grain: ["admin"],
        money,
        sourceRef: { documentId, rowLabel: u.unitName },
      });
    }
  }
  return facts.sort((a, b) =>
    a.classification.admin === b.classification.admin
      ? a.kind.localeCompare(b.kind)
      : (a.classification.admin ?? "").localeCompare(
          b.classification.admin ?? "",
        ),
  );
};

export { slugifyUnit };

// ---------------------------------------------------------------------------
// Program grain — the policy-area / budget-program tables in the law.
// ---------------------------------------------------------------------------

const programFactKey = (fiscalYear: number, programId: string): string =>
  createHash("sha256")
    .update(`${fiscalYear}|law|0|expenditure|program:${programId}`)
    .digest("hex")
    .slice(0, 12);

interface ProgramDataResult {
  registry: ClassificationRegistry;
  factsByYear: Map<number, BudgetFact[]>;
}

// Build the program classification registry + program-grain BudgetFacts from
// every parsed law year. A program node is owned by its spending unit
// (`ownerAdminId` / `parentId`); ids are stable per (owner, program name), with
// a numeric suffix only when two different units share a program slug.
export const buildProgramData = (
  unitsByYear: Map<number, ParsedLawUnit[]>,
): ProgramDataResult => {
  const idByKey = new Map<string, string>(); // "ownerId|name" -> program id
  const ownerById = new Map<string, string>(); // program id -> ownerId
  const programId = (ownerAdminId: string, programName: string): string => {
    const key = `${ownerAdminId}|${programName}`;
    const existing = idByKey.get(key);
    if (existing) return existing;
    const base = slugify(programName, "prog");
    let id = base;
    let n = 1;
    while (ownerById.has(id) && ownerById.get(id) !== ownerAdminId) {
      n += 1;
      id = `${base}-${n}`;
    }
    idByKey.set(key, id);
    ownerById.set(id, ownerAdminId);
    return id;
  };

  const nodes = new Map<string, ClassificationNode>();
  const factsByYear = new Map<number, BudgetFact[]>();

  for (const [year, units] of [...unitsByYear.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const facts: BudgetFact[] = [];
    for (const unit of units) {
      if (unit.programs.length === 0) continue;
      const ownerAdminId = slugifyUnit(unit.unitName);
      for (const program of unit.programs) {
        const id = programId(ownerAdminId, program.nameBg);
        let node = nodes.get(id);
        if (!node) {
          node = {
            id,
            dimension: "program",
            nameBg: program.nameBg,
            nameEn: "",
            parentId: ownerAdminId,
            ownerAdminId,
            history: [],
          };
          nodes.set(id, node);
        }
        if (!node.history.some((h) => h.fiscalYear === year)) {
          node.history.push({
            fiscalYear: year,
            sourceCode: program.code,
            sourceName: program.nameBg,
          });
        }
        if (!program.amount) continue;
        facts.push({
          key: programFactKey(year, id),
          fiscalYear: year,
          version: {
            stage: "law",
            seq: 0,
            effectiveDate: LAW_PROMULGATION[year] ?? `${year - 1}-12-31`,
            documentId: `law-${year}`,
          },
          kind: "expenditure",
          classification: {
            admin: ownerAdminId,
            functional: null,
            economic: null,
            program: id,
            programLine: null,
          },
          grain: ["admin", "program"],
          money: program.amount,
          sourceRef: {
            documentId: `law-${year}`,
            rowLabel: program.nameBg,
          },
        });
      }
    }
    facts.sort((a, b) =>
      (a.classification.program ?? "").localeCompare(
        b.classification.program ?? "",
      ),
    );
    factsByYear.set(year, facts);
  }

  return {
    registry: {
      dimension: "program",
      generatedAt: new Date().toISOString(),
      nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    },
    factsByYear,
  };
};
