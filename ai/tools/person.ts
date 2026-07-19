// Unified person-identity tools (plan §4b). Backed by the resolved person layer
// (scripts/person/resolve_persons.ts → 082 person_by_slug / person_by_name), served via
// the /api/db `person-profile` route. Everything narrated is verbatim from the payload —
// office labels, company names, exact counts — never computed here, so the grounded-number
// gate holds. Only active + public-safe roles reach the payload (person_by_slug enforces
// the §3/§6 public-surface + privacy rules), so a tool answer can never assert a
// review-status link.
//
// Scope here is the FACTUAL profile only. The person↔person "свързани лица" tool
// (personConnections) is deliberately NOT here: it narrates inferred links and needs the
// dedicated claims/disclaimer gate (§4b/§7d) before it can ship.

import { fetchDb } from "./dataClient";
import type { Envelope, ToolArgs, ToolContext } from "./types";

type ProfileRole = {
  source: string;
  facet: string;
  sourceLabel: string;
  role: string;
  ref: string;
  place: string | null;
};
type ProfileCompany = { eik: string; name: string | null; roles: string[] };
type PersonProfilePayload = {
  slug: string;
  name: string;
  namesakeRisk: number;
  facets: string[];
  roles: ProfileRole[];
  companies: ProfileCompany[];
} | null;

const notFound = (query: string, bg: boolean): Envelope => ({
  tool: "personProfile",
  kind: "scalar",
  viz: "none",
  title: bg
    ? `Не е намерено лице „${query}“`
    : `No person found for "${query}"`,
  facts: {
    [bg ? "търсене" : "query"]: query,
    [bg ? "подсказка" : "hint"]: bg
      ? "Опитайте с пълно име (име, презиме и фамилия) на публична личност — депутат, кмет, съветник, магистрат или дарител."
      : "Try a full name of a public figure — MP, mayor, councillor, magistrate or donor.",
  },
  provenance: ["person_by_slug (082_person_api.sql)"],
});

/**
 * One person's unified cross-source profile: the offices they hold, the companies they
 * own/manage (Търговски регистър), how many times they ran, and how many parties they
 * donated to — all resolved to ONE person, regardless of source.
 */
export const personProfile = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const query = String(args.name ?? args.person ?? "").trim();
  if (!query) return notFound(query, bg);

  const p = await fetchDb<PersonProfilePayload>("person-profile", {
    name: query,
  });
  if (!p || !p.slug) return notFound(query, bg);

  const offices = p.roles.filter(
    (r) =>
      r.source === "mp" ||
      r.source.startsWith("official") ||
      r.source === "magistrate",
  );
  const candidacies = p.roles.filter((r) => r.source === "candidate").length;
  const donations = new Set(
    p.roles.filter((r) => r.source === "donor").map((r) => r.ref.split(":")[0]),
  ).size;

  // Distinct office labels (e.g. "Народни представители", "Общинска администрация"),
  // exactly as person_source labels them — no free text.
  const officeLabels = [...new Set(offices.map((r) => r.sourceLabel))];
  const companyNames = p.companies
    .map((c) => c.name ?? c.eik)
    .filter(Boolean) as string[];

  const facts: Record<string, string | number> = {
    [bg ? "име" : "name"]: p.name,
  };
  if (officeLabels.length)
    facts[bg ? "длъжности" : "positions"] = officeLabels.join(", ");
  if (companyNames.length) {
    facts[bg ? "фирми (брой)" : "companies"] = companyNames.length;
    facts[bg ? "фирми" : "company names"] = companyNames.slice(0, 8).join(", ");
  }
  if (candidacies)
    facts[bg ? "кандидатури (брой)" : "candidacies"] = candidacies;
  if (donations)
    facts[bg ? "дарения към партии (брой)" : "party donations"] = donations;
  // The identity disclaimer travels with every profile so the narration can't drop it.
  facts[bg ? "бележка" : "note"] = bg
    ? "Връзките са по съвпадение на име — насока, не категорично доказателство."
    : "Links are by name match — a lead, not definitive proof.";

  const summaryBits = [
    officeLabels.length ? officeLabels.join(", ") : null,
    companyNames.length
      ? bg
        ? `${companyNames.length} фирми`
        : `${companyNames.length} companies`
      : null,
  ].filter(Boolean);

  return {
    tool: "personProfile",
    domain: "people",
    kind: "scalar",
    viz: "none",
    title: summaryBits.length
      ? `${p.name} — ${summaryBits.join(" · ")}`
      : p.name,
    facts,
    provenance: ["person_by_slug (082_person_api.sql)"],
  };
};
