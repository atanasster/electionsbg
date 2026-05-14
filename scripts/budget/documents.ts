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
  lawDvUrl,
} from "./fetch_sources";
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
        notes:
          "Placeholder — resolve the Държавен вестник idMat and add it to " +
          "LAW_DV_MATERIALS in scripts/budget/fetch_sources.ts.",
      };
    });
};

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

// Merge freshly-built auto entries with whatever is already committed,
// preserving any manually-curated document (discovery: "manual" or any entry
// the operator has enriched). Auto entries only replace prior auto entries.
const mergeDocuments = (
  previous: BudgetDocument[],
  fresh: BudgetDocument[],
): BudgetDocument[] => {
  const byId = new Map<string, BudgetDocument>();
  for (const d of previous) byId.set(d.id, d);
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

export const buildDocuments = (
  parsed: ParsedResource[],
  bulnaoHtml: string | null,
  previous: BudgetDocument[],
): BudgetDocumentsFile => {
  const fresh: BudgetDocument[] = [
    buildKfpDocument(parsed),
    ...buildLawDocuments(parsed),
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
