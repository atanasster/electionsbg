// Budget-journey document index builder.
//
// Phase 1 assembles documents.json from what is reliably machine-discoverable:
//   - the data.egov.bg КФП feed itself (one "kfp-feed" document, each monthly
//     resource a source);
//   - one "law" stub per fiscal year seen in the feed — a placeholder the
//     Phase 3 PDF-annex work fills in with the real parliament.bg /
//     Държавен вестник URLs;
//   - best-effort "audit-report" entries scraped from the Сметна палата
//     audit-report listing (non-fatal: skipped when the fetch or parse fails).
//
// Hand-curated entries (real bill URLs, amendment sequencing, annex tagging)
// are added later with discovery: "manual"; the builder never overwrites them
// because the operator commits them into documents.json directly and this
// builder merges rather than replaces (see mergeDocuments).

import {
  EGOV_DATASET_UUID,
  BULNAO_AUDIT_URL,
  LAW_DV_MATERIALS,
  AMENDMENT_DV_MATERIALS,
  INTERIM_BUDGET_LAWS,
  FUND_BUDGET_LAWS,
  EXECUTION_REPORTS,
  lawDvUrl,
} from "./fetch_sources";
import {
  canonicalExecutionAdminId,
  executionDocumentId,
} from "./execution_facts";
import type {
  BudgetDocument,
  BudgetDocumentsFile,
  BudgetDocumentSource,
} from "./types";
import type { ParsedResource } from "./kfp";
import { KFP_DOCUMENT_ID } from "./kfp";

const egovResourceUrl = (uuid: string): string =>
  `https://data.egov.bg/resource/download/${uuid}/json`;

// The КФП feed document — the rolling state-budget execution series.
const buildKfpDocument = (parsed: ParsedResource[]): BudgetDocument => {
  const sources: BudgetDocumentSource[] = [
    {
      role: "dataset",
      url: `https://data.egov.bg/data/view/${EGOV_DATASET_UUID}`,
      format: "html",
      label: "data.egov.bg dataset — state budget execution",
    },
  ];
  for (const p of [...parsed].sort((a, b) =>
    a.header.asOf.localeCompare(b.header.asOf),
  )) {
    sources.push({
      role: "resource",
      url: egovResourceUrl(p.uuid),
      format: "json",
      label: `Execution as of ${p.header.asOf}`,
    });
  }
  return {
    id: KFP_DOCUMENT_ID,
    kind: "kfp-feed",
    fiscalYear: null,
    seq: 0,
    title: "КФП — state budget execution by major budget indicators",
    sources,
    discovery: "auto",
    notes:
      "Monthly cash-execution snapshots of the state budget published by the " +
      "Ministry of Finance on data.egov.bg. The primary Phase 1 source.",
  };
};

// One "law" entry per fiscal year that appears in the КФП feed or has a known
// Държавен вестник promulgation. Years in LAW_DV_MATERIALS carry the real DV
// HTML source (and are parsed for per-ministry appropriations); the rest stay
// as placeholders until their idMat is resolved.
const buildLawDocuments = (parsed: ParsedResource[]): BudgetDocument[] => {
  const interimYears = new Set(INTERIM_BUDGET_LAWS.map((l) => l.fiscalYear));
  const years = new Set<number>(parsed.map((p) => p.header.fiscalYear));
  for (const y of Object.keys(LAW_DV_MATERIALS)) years.add(parseInt(y, 10));
  return [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const idMat = LAW_DV_MATERIALS[year];
      const title = `Закон за държавния бюджет на Република България за ${year} г.`;
      if (idMat) {
        return {
          id: `law-${year}`,
          kind: "law" as const,
          fiscalYear: year,
          seq: 0,
          title,
          sources: [
            {
              role: "promulgated" as const,
              url: lawDvUrl(idMat),
              format: "html" as const,
              label:
                "Държавен вестник — promulgated text + appropriation tables",
            },
          ],
          discovery: "auto-confirmed" as const,
        };
      }
      return {
        id: `law-${year}`,
        kind: "law" as const,
        fiscalYear: year,
        seq: 0,
        title,
        sources: [],
        discovery: "auto" as const,
        notes: interimYears.has(year)
          ? `Placeholder — no State Budget Law was adopted for ${year} г.; an ` +
            "interim bridging law is in force instead (see the interim-law " +
            "entries for this year). Add the idMat to LAW_DV_MATERIALS once " +
            "the ЗДБ is finally promulgated."
          : "Placeholder — resolve the Държавен вестник idMat and add it to " +
            "LAW_DV_MATERIALS in scripts/budget/fetch_sources.ts.",
      };
    });
};

// One "amendment" entry per curated mid-year State Budget Law amendment. These
// are catalogued for provenance — the budget-journey UI links the promulgated
// text — but carry no parseable per-ministry tables (see AMENDMENT_DV_MATERIALS).
const buildAmendmentDocuments = (): BudgetDocument[] =>
  AMENDMENT_DV_MATERIALS.map((a) => ({
    id: `amendment-${a.fiscalYear}-${a.seq}`,
    kind: "amendment" as const,
    fiscalYear: a.fiscalYear,
    seq: a.seq,
    title: a.title,
    sources: [
      {
        role: "promulgated" as const,
        url: lawDvUrl(a.idMat),
        format: "html" as const,
        label: `Държавен вестник — ${a.dvIssue}`,
      },
    ],
    promulgationDate: a.promulgationDate,
    discovery: "auto-confirmed" as const,
    notes:
      "Mid-year amendment to the State Budget Law — catalogued for provenance. " +
      "The DV HTML carries no per-spending-unit appropriation tables; the " +
      "amended per-ministry appropriation comes from the year-end execution report.",
  }));

// One "interim-law" entry per interim "collection of revenue and execution of
// expenditure" (bridging) law and each of its ЗИД amendments. These exist for a
// fiscal year that opened with no adopted State Budget Law (FY2026); catalogued
// for provenance so the budget-journey UI shows the year ran on a stopgap law.
// Like amendments, the DV HTML carries no per-spending-unit tables — no figures
// are parsed.
const buildInterimLawDocuments = (): BudgetDocument[] =>
  INTERIM_BUDGET_LAWS.map((l) => ({
    id: `interim-law-${l.fiscalYear}-${l.seq}`,
    kind: "interim-law" as const,
    fiscalYear: l.fiscalYear,
    seq: l.seq,
    title: l.title,
    sources: [
      {
        role: "promulgated" as const,
        url: lawDvUrl(l.idMat),
        format: "html" as const,
        label: `Държавен вестник — ${l.dvIssue}`,
      },
    ],
    promulgationDate: l.promulgationDate,
    discovery: "auto-confirmed" as const,
    notes:
      l.seq === 0
        ? "Interim bridging law — adopted because no State Budget Law was in " +
          "force at the start of the fiscal year. Catalogued for provenance; " +
          "the DV HTML carries no per-spending-unit appropriation tables."
        : "Amendment to the interim bridging law — catalogued for provenance.",
  }));

// One "fund-law" entry per social-fund budget law (ЗБДОО / ЗБНЗОК) and each of
// its ЗИД amendments. These pass as one package with the State Budget Law but
// appropriate their own funds, not the first-level spending units — so, like
// amendments and interim laws, they are catalogued for provenance and no
// per-spending-unit appropriations are parsed from the DV HTML. Other things
// ARE read from it: the ЗБДОО annexes (Прил. 1/1А МОД floors, Прил. 2/2А ТЗПБ
// rates) are parsed by scripts/budget/noi/__write_annexes.ts, and its чл. 1–8
// per-fund plan is hand-keyed in noi/__write_fund_plan.ts. See FUND_BUDGET_LAWS.
const buildFundLawDocuments = (): BudgetDocument[] =>
  FUND_BUDGET_LAWS.map((l) => ({
    id: `fund-law-${l.fund}-${l.fiscalYear}-${l.seq}`,
    kind: "fund-law" as const,
    fiscalYear: l.fiscalYear,
    seq: l.seq,
    title: l.title,
    sources: [
      {
        role: "promulgated" as const,
        url: lawDvUrl(l.idMat),
        format: "html" as const,
        label: `Държавен вестник — ${l.dvIssue}`,
      },
    ],
    promulgationDate: l.promulgationDate,
    discovery: "auto-confirmed" as const,
    notes:
      (l.fund === "doo"
        ? "Social-security fund budget (ДОО/НОИ)"
        : "Health-insurance fund budget (НЗОК)") +
      (l.seq === 0 ? "" : " — ЗИД amendment") +
      ". Passes as one package with the State Budget Law but appropriates its " +
      "own fund, so no per-spending-unit tables are parsed; catalogued for " +
      "provenance. Its annexes and per-fund plan are ingested separately.",
  }));

// One "execution-report" entry per curated ministry program-budget execution
// report. The pipeline parses the figures out of these; the entry exists so
// the budget-journey UI can link the source document. The link is a direct
// PDF for most ministries; some publish an XLSX inside a ZIP, in which case
// the link is the ZIP (a viewer downloads and extracts).
const buildExecutionDocuments = (): BudgetDocument[] =>
  EXECUTION_REPORTS.map((r) => ({
    id: executionDocumentId(canonicalExecutionAdminId(r.adminId), r.fiscalYear),
    kind: "execution-report" as const,
    fiscalYear: r.fiscalYear,
    seq: 0,
    title:
      `Отчет за изпълнението на програмния бюджет на ` +
      `${r.unitNameBg} за ${r.fiscalYear} г.`,
    sources: [
      {
        role: "report" as const,
        url: r.url,
        format:
          r.format === "xlsx-in-zip" ? ("xlsx" as const) : ("pdf" as const),
        label:
          `${r.unitNameBg} — програмен отчет` +
          (r.format === "xlsx-in-zip" ? " (XLSX в ZIP архив)" : ""),
      },
    ],
    reportDate: `${r.fiscalYear}-12-31`,
    discovery: "auto-confirmed" as const,
  }));

// Best-effort scrape of the Сметна палата audit-report listing. The page lists
// every kind of audit; we keep only the ones whose anchor text mentions the
// state budget. Non-fatal — returns [] on any structural surprise.
const parseBulnaoAuditReports = (html: string): BudgetDocument[] => {
  const out: BudgetDocument[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    const href = m[1];
    const raw = m[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
    const aboutBudget =
      lower.includes("държавния бюджет") || lower.includes("държавен бюджет");
    const aboutExecution =
      lower.includes("изпълнение") || lower.includes("отчет");
    if (!aboutBudget || !aboutExecution) continue;
    // The anchor text often carries listing metadata ("851 KБ Категория: …
    // Тип: …") before the real title — trim to the first title keyword.
    const titleStart = raw.search(/(Одитен доклад|Доклад|Отчет)/);
    const text = titleStart >= 0 ? raw.slice(titleStart) : raw;
    // Prefer the fiscal year named in "за YYYY г."; fall back to any year.
    const yearMatch =
      text.match(/за\s+(20\d{2})\s*г/) ?? text.match(/\b(20\d{2})\b/);
    if (!yearMatch) continue;
    const fiscalYear = parseInt(yearMatch[1], 10);
    const id = `audit-${fiscalYear}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const url = href.startsWith("http")
      ? href
      : `https://www.bulnao.government.bg${href.startsWith("/") ? "" : "/"}${href}`;
    out.push({
      id,
      kind: "audit-report",
      fiscalYear,
      seq: 0,
      title: text,
      sources: [{ role: "report", url, format: "pdf" }],
      discovery: "auto",
    });
  }
  return out;
};

// Kinds whose ENTIRE id-space this builder enumerates from a committed config
// constant, with no network input: EXECUTION_REPORTS, AMENDMENT_DV_MATERIALS,
// INTERIM_BUDGET_LAWS, FUND_BUDGET_LAWS. For these — and only these — "absent
// from `fresh`" means "no longer part of the corpus" rather than "this run
// couldn't see it", so a prior entry that the build no longer produces is a
// stale record and is dropped.
//
// The other three kinds are deliberately OUT, because for them an absence is
// ambiguous: `law` is enumerated from the fetched КФП resources ∪
// LAW_DV_MATERIALS (a short feed would retire real law years), `audit-report`
// comes from a best-effort scrape that yields [] on any structural surprise,
// and `kfp-feed` exists only when the feed parsed. Pruning on those would turn
// a fetch failure into a silent retraction.
const PRUNABLE_KINDS: ReadonlySet<BudgetDocument["kind"]> = new Set([
  "execution-report",
  "amendment",
  "interim-law",
  "fund-law",
]);

// Merge freshly-built auto entries with whatever is already committed,
// preserving any manually-curated document (discovery: "manual" or any entry
// the operator has enriched). Auto entries only replace prior auto entries.
//
// A prior machine-derived entry of a PRUNABLE_KINDS kind that this build no
// longer produces is DROPPED. Without that, an id-minting change strands the
// old id in the committed file for ever: the merge is keyed on `id`, so a
// record whose id nobody mints again is never revisited, and the file
// accumulates one duplicate per renamed document. That is not hypothetical —
// it is how 15 of the corpus's 48 records came to be the same 15 execution
// reports twice, under `exec-admin-ministerstvoto-na-…` (the pre-
// canonicalExecutionAdminId slug, minted from the ministry's definite-article
// label) beside the `exec-admin-ministerstvo-na-…` the builder mints today.
export const mergeDocuments = (
  previous: BudgetDocument[],
  fresh: BudgetDocument[],
): BudgetDocument[] => {
  // Per kind, the ids this build produced. A kind that produced NOTHING is
  // absent from the map and therefore prunes nothing — an empty config (or a
  // builder that threw before contributing) must never wipe a whole family,
  // which is the same refusal the budget loader's shrink floor makes.
  const freshIdsByKind = new Map<string, Set<string>>();
  for (const d of fresh) {
    if (!PRUNABLE_KINDS.has(d.kind)) continue;
    const ids = freshIdsByKind.get(d.kind) ?? new Set<string>();
    ids.add(d.id);
    freshIdsByKind.set(d.kind, ids);
  }
  const isStale = (d: BudgetDocument): boolean => {
    if (d.discovery === "manual") return false; // curated — never ours to drop
    const ids = freshIdsByKind.get(d.kind);
    return ids !== undefined && !ids.has(d.id);
  };

  const byId = new Map<string, BudgetDocument>();
  for (const d of previous) {
    if (isStale(d)) continue;
    byId.set(d.id, d);
  }
  for (const d of fresh) {
    const prior = byId.get(d.id);
    if (prior && prior.discovery !== "auto") continue; // keep curated entry
    byId.set(d.id, d);
  }
  return [...byId.values()].sort((a, b) => {
    const ay = a.fiscalYear ?? 9999;
    const by = b.fiscalYear ?? 9999;
    if (ay !== by) return ay - by;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.seq - b.seq;
  });
};

// The PRUNABLE_KINDS half of the corpus: every document this builder can
// enumerate from a committed config alone, with no network. Exported because it
// is exactly the input `mergeDocuments` prunes against — a repair that needs to
// drop stale records offline uses this rather than a second copy of the id
// rules, which is what let the two spellings diverge in the first place.
export const buildConfigDocuments = (): BudgetDocument[] => [
  ...buildInterimLawDocuments(),
  ...buildFundLawDocuments(),
  ...buildAmendmentDocuments(),
  ...buildExecutionDocuments(),
];

export const buildDocuments = (
  parsed: ParsedResource[],
  bulnaoHtml: string | null,
  previous: BudgetDocument[],
): BudgetDocumentsFile => {
  const fresh: BudgetDocument[] = [
    buildKfpDocument(parsed),
    ...buildLawDocuments(parsed),
    ...buildConfigDocuments(),
  ];
  if (bulnaoHtml) {
    try {
      fresh.push(...parseBulnaoAuditReports(bulnaoHtml));
    } catch (e) {
      console.warn(
        `  bulnao audit-report parse failed (non-fatal): ${(e as Error).message}`,
      );
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    documents: mergeDocuments(previous, fresh),
  };
};

export { BULNAO_AUDIT_URL };
