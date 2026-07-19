// Unified person-identity tools (plan §4b). Backed by the resolved person layer
// (scripts/person/resolve_persons.ts → 082 person_by_slug / person_by_name), served via
// the /api/db `person-profile` route. Everything narrated is verbatim from the payload —
// office labels, company names, exact counts — never computed here, so the grounded-number
// gate holds. Only active + public-safe roles reach the payload (person_by_slug enforces
// the §3/§6 public-surface + privacy rules), so a tool answer can never assert a
// review-status link.
//
// personConnections narrates person↔person links, but its defamation gate is DATA-level:
// person_connections (084) only ever returns public/active endpoints and drops
// association-noise companies, and the disclaimer rides IN the payload — so the tool can't
// surface a private co-owner or a review-status link and never invents an edge.

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
  ngos: { eik: string; name: string | null }[];
  procuredEur: number;
  sanctions: { program: string; authority: string; date: string }[];
} | null;

type ConnectionsPayload = {
  subject: { slug: string; name: string };
  related: {
    slug: string;
    name: string;
    sharedCount: number;
    companies: { eik: string; name: string | null }[];
  }[];
  disclaimer: string;
} | null;

// Localized labels for the office ROLE (not just the source) so a mayor doesn't narrate as
// the generic "Местни кандидати и съветници". Unknown roles fall back to the source label.
const ROLE_LABEL: Record<string, { bg: string; en: string }> = {
  mayor: { bg: "Кмет", en: "Mayor" },
  councillor: { bg: "Общински съветник", en: "Municipal councillor" },
};

const notFound = (
  query: string,
  bg: boolean,
  tool: "personProfile" | "personConnections" = "personProfile",
): Envelope => ({
  tool,
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
      r.source === "magistrate" ||
      r.source === "local",
  );
  const candidacies = p.roles.filter((r) => r.source === "candidate").length;
  const donations = new Set(
    p.roles.filter((r) => r.source === "donor").map((r) => r.ref.split(":")[0]),
  ).size;

  // Distinct office labels — for local (mayor/councillor) the ROLE carries the signal, so
  // use it; other offices fall back to the person_source label. Verbatim, no free text.
  const officeLabels = [
    ...new Set(
      offices.map((r) => {
        const rl = ROLE_LABEL[r.role];
        return r.source === "local" && rl
          ? bg
            ? rl.bg
            : rl.en
          : r.sourceLabel;
      }),
    ),
  ];
  const companyNames = p.companies
    .map((c) => c.name ?? c.eik)
    .filter(Boolean) as string[];

  const facts: Record<string, string | number> = {
    [bg ? "име" : "name"]: p.name,
  };
  // Official sanctions FIRST — the highest-stakes fact, verbatim from the government finding.
  if (p.sanctions?.length)
    facts[bg ? "санкции" : "sanctions"] = p.sanctions
      .map((s) => `${s.program} (${s.authority}, ${s.date})`)
      .join("; ");
  if (officeLabels.length)
    facts[bg ? "длъжности" : "positions"] = officeLabels.join(", ");
  if (companyNames.length) {
    facts[bg ? "фирми (брой)" : "companies"] = companyNames.length;
    facts[bg ? "фирми" : "company names"] = companyNames.slice(0, 8).join(", ");
  }
  const ngoNames = (p.ngos ?? [])
    .map((n) => n.name ?? n.eik)
    .filter(Boolean) as string[];
  if (ngoNames.length)
    facts[bg ? "управа на ЮЛНЦ (НПО)" : "NGO board seats"] = ngoNames
      .slice(0, 6)
      .join(", ");
  if (candidacies)
    facts[bg ? "кандидатури (брой)" : "candidacies"] = candidacies;
  if (donations)
    facts[bg ? "дарения към партии (брой)" : "party donations"] = donations;
  // Public money won by the person's companies (post-annex EUR basis) — grounded verbatim.
  if (p.procuredEur > 0)
    facts[bg ? "обществени поръчки (EUR)" : "public contracts (EUR)"] =
      Math.round(p.procuredEur);
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

/**
 * A public person's "свързани лица" — OTHER public figures who are officers/owners of the
 * same company (Търговски регистър). SAFE BY CONSTRUCTION: person_connections (084) only
 * ever returns public-figure, active endpoints and drops association-noise companies (a
 * board / professional association is not a business tie), and the identity disclaimer
 * rides IN the payload — so the tool never surfaces a private co-owner or a review-status
 * link, and the disclaimer is always a narratable fact. No numbers are computed here.
 */
export const personConnections = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const query = String(args.name ?? args.person ?? "").trim();
  if (!query) return notFound(query, bg, "personConnections");

  // Resolve the name → the person's stable slug (person-profile does slug-or-name), then
  // pull their edges by slug.
  const prof = await fetchDb<PersonProfilePayload>("person-profile", {
    name: query,
  });
  if (!prof || !prof.slug) return notFound(query, bg, "personConnections");

  const conn = await fetchDb<ConnectionsPayload>("person-connections", {
    slug: prof.slug,
  });
  const related = conn?.related ?? [];

  if (!related.length) {
    return {
      tool: "personConnections",
      domain: "people",
      kind: "scalar",
      viz: "none",
      title: bg
        ? `Няма намерени публични връзки за ${prof.name}`
        : `No public connections found for ${prof.name}`,
      facts: {
        [bg ? "име" : "name"]: prof.name,
        [bg ? "свързани лица (брой)" : "connected people"]: 0,
      },
      provenance: ["person_connections (084_person_connections.sql)"],
    };
  }

  const names = related.slice(0, 10).map((r) => r.name);
  const companies = [
    ...new Set(
      related.flatMap((r) =>
        r.companies.map((c) => c.name).filter(Boolean),
      ) as string[],
    ),
  ];

  return {
    tool: "personConnections",
    domain: "people",
    kind: "table",
    viz: "table",
    title: bg
      ? `${prof.name} — ${related.length} свързани лица`
      : `${prof.name} — ${related.length} connected people`,
    columns: [
      { key: "person", label: bg ? "Лице" : "Person" },
      {
        key: "shared",
        label: bg ? "Общи фирми" : "Shared companies",
        numeric: true,
        format: "int",
      },
      { key: "via", label: bg ? "Чрез" : "Via" },
    ],
    rows: related.map((r) => ({
      person: r.name,
      shared: r.sharedCount,
      via: r.companies.map((c) => c.name ?? c.eik).join(", "),
    })),
    facts: {
      [bg ? "име" : "name"]: prof.name,
      [bg ? "свързани лица (брой)" : "connected people"]: related.length,
      [bg ? "лица" : "people"]: names.join(", "),
      [bg ? "чрез фирми" : "via companies"]: companies.slice(0, 8).join(", "),
      // The disclaimer travels FROM the grounded payload — never dropped, never our claim.
      [bg ? "бележка" : "note"]:
        conn?.disclaimer ??
        (bg
          ? "Връзките са по съвпадение на име и обща фирма — насока, не доказателство."
          : "Links are by name + shared company — a lead, not proof."),
    },
    provenance: ["person_connections (084_person_connections.sql)"],
  };
};
