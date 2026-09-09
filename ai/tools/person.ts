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

import { isNameMatch } from "../../src/screens/components/linkBasis";
import { isOfficialSource } from "../../src/lib/officialSources";
import { clarifyEnvelope } from "./clarify";
import { fetchDb } from "./dataClient";
import { officeLabel } from "./officeLabel";
import type { Envelope, ToolArgs, ToolContext } from "./types";

type ProfileRole = {
  source: string;
  facet: string;
  sourceLabel: string;
  role: string;
  ref: string;
  // The TYPED place (migration 115). `placeKind` names the namespace `placeCode` is in
  // — 'mir' (31 electoral constituencies), 'obshtina' (the app's municipality codes) or
  // 'judicial' (a judicial_body code) — and both labels are precomputed server-side, so
  // no consumer needs a code→name dictionary. `judicialKind` is set for magistrate roles
  // only and drives the Съдия/Прокурор/Следовател heading.
  placeKind: "mir" | "obshtina" | "judicial" | null;
  placeCode: string | null;
  placeLabel: string | null;
  placeLabelEn: string | null;
  judicialKind: string | null;
};
type ProfileCompany = {
  eik: string;
  name: string | null;
  roles: string[];
  /** 082's basis for the link. Optional because a serving database on an older 082 omits it —
   *  and, exactly as in the UI, ABSENT must read as a name match, never as declared. */
  linkBasis?: "declared" | "name_match";
};
type PersonProfilePayload = {
  slug: string;
  name: string;
  namesakeRisk: number;
  facets: string[];
  roles: ProfileRole[];
  companies: ProfileCompany[];
  ngos: {
    eik: string;
    name: string | null;
    linkBasis?: "declared" | "name_match";
  }[];
  procuredEur: number;
  fundsEur: number;
  subsidiesEur: number;
  sanctions: { program: string; authority: string; date: string }[];
  ds: {
    decisionNo: string;
    decisionDate: string;
    body: string;
    category: string | null;
    pseudonyms: string[];
  }[];
  regulators: { body: string; seat: string; termStart: string | null }[];
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

type PersonLookupHit = { slug?: string; name?: string };
type ResolvedPerson = NonNullable<PersonProfilePayload>;
type PersonResolution =
  | { kind: "found"; profile: ResolvedPerson }
  | { kind: "ambiguous"; hits: { slug: string; name: string }[] }
  | { kind: "missing" };

// person_by_name deliberately requires a unique folded full name. For a Latin
// two-part query, resolve through the shared transliterating person search and
// then load the stable slug. We only accept a single leading identity; a tie is
// left unresolved instead of attaching the question to an arbitrary person.
const resolvePersonProfile = async (
  query: string,
): Promise<PersonResolution> => {
  const direct = await fetchDb<PersonProfilePayload>("person-profile", {
    name: query,
  });
  if (direct?.slug) return { kind: "found", profile: direct };
  const hits = await fetchDb<PersonLookupHit[]>("person-lookup", {
    q: query,
    limit: 10,
  });
  const unique = (hits ?? []).filter(
    (hit): hit is { slug: string; name: string } => !!hit.slug && !!hit.name,
  );
  if (unique.length > 1) return { kind: "ambiguous", hits: unique };
  if (unique.length === 0) return { kind: "missing" };
  const profile = await fetchDb<PersonProfilePayload>("person-profile", {
    slug: unique[0].slug,
  });
  return profile?.slug ? { kind: "found", profile } : { kind: "missing" };
};

const ambiguousPerson = (
  query: string,
  bg: boolean,
  tool: "personProfile" | "personConnections" | "personWealth",
  hits: { slug: string; name: string }[],
): Envelope =>
  clarifyEnvelope(
    bg
      ? `Кое лице „${query}“ имате предвид?`
      : `Which person "${query}" do you mean?`,
    hits.map((hit) => ({
      label: hit.name,
      sublabel: hit.slug,
      tool,
      args: { name: hit.slug },
    })),
    ["person-lookup", "person_by_slug (082_person_api.sql)"],
    "people",
  );

const notFound = (
  query: string,
  bg: boolean,
  tool:
    | "personProfile"
    | "personConnections"
    | "personWealth" = "personProfile",
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

  const resolved = await resolvePersonProfile(query);
  if (resolved.kind === "ambiguous")
    return ambiguousPerson(query, bg, "personProfile", resolved.hits);
  if (resolved.kind === "missing") return notFound(query, bg);
  const p = resolved.profile;

  const offices = p.roles.filter(
    (r) =>
      r.source === "mp" ||
      isOfficialSource(r.source) ||
      r.source === "magistrate" ||
      r.source === "local",
  );
  const candidacies = p.roles.filter((r) => r.source === "candidate").length;
  const donations = new Set(
    p.roles.filter((r) => r.source === "donor").map((r) => r.ref.split(":")[0]),
  ).size;

  // Distinct office labels — for local the ROLE carries the signal (the source is labelled
  // „Местни кандидати и съветници", which lumps a sitting mayor in with someone who merely
  // ran), so `officeLabel` overrides there. Verbatim from the payload, no free text.
  const officeLabels = [
    ...new Set(
      offices.map((r) => officeLabel(r.source, r.role, r.sourceLabel, bg)),
    ),
  ];
  const companyNames = p.companies
    .map((c) => c.name ?? c.eik)
    .filter(Boolean) as string[];

  // THE BASIS TRAVELS WITH THE NAMES, because this is the surface whose output a model turns
  // into a SENTENCE about a named person. /person marks each name-matched row „по име" and
  // caveats the block; the same rows reached the chat as bare grounded facts, so the model
  // could assert "X sits on the board of Y" from an attribution the page itself hedges.
  // Measured 2026-08-25: 5,670 of 5,727 board seats rest on a folded name.
  //
  // Same rule as the UI, read from the same helper — absent means name match, so an older
  // 082 annotates everything rather than nothing. Annotating the KEY rather than each value
  // keeps the fact verbatim: the names stay exactly what the register holds.
  const nameMatched = (
    rows: { linkBasis?: "declared" | "name_match" }[],
  ): boolean => rows.some((r) => isNameMatch(r.linkBasis));
  const byName = bg ? " — по съвпадение на име" : " — matched by name";

  const facts: Record<string, string | number> = {
    [bg ? "име" : "name"]: p.name,
  };
  // Official sanctions FIRST — the highest-stakes fact, verbatim from the government finding.
  if (p.sanctions?.length)
    facts[bg ? "санкции" : "sanctions"] = p.sanctions
      .map((s) => `${s.program} (${s.authority}, ${s.date})`)
      .join("; ");
  // ДС / COMDOS affiliation — an official Комисия по досиетата verdict, cited to the
  // решение № + date, verbatim from the government finding (a public act, not our claim).
  if (p.ds?.length)
    facts[bg ? "принадлежност към ДС" : "State Security affiliation"] = p.ds
      .map(
        (d) =>
          `${d.category ?? d.body}${
            d.pseudonyms.length ? ` „${d.pseudonyms.join("“, „")}“` : ""
          } (Комисия по досиетата, реш. № ${d.decisionNo}/${d.decisionDate})`,
      )
      .join("; ");
  // Seats on the independent / regulatory bodies (the `regulator` "кой решава" facet) —
  // verbatim body + seat, a neutral civic office, never computed prose.
  if (p.regulators?.length)
    facts[bg ? "регулаторни органи" : "regulatory bodies"] = p.regulators
      .map((r) => `${r.body}${r.seat ? ` (${r.seat})` : ""}`)
      .join("; ");
  if (officeLabels.length)
    facts[bg ? "длъжности" : "positions"] = officeLabels.join(", ");
  if (companyNames.length) {
    facts[bg ? "фирми (брой)" : "companies"] = companyNames.length;
    facts[
      (bg ? "фирми" : "company names") +
        (nameMatched(p.companies) ? byName : "")
    ] = companyNames.slice(0, 8).join(", ");
  }
  const ngos = p.ngos ?? [];
  const ngoNames = ngos.map((n) => n.name ?? n.eik).filter(Boolean) as string[];
  if (ngoNames.length)
    facts[
      (bg ? "управа на ЮЛНЦ (НПО)" : "NGO board seats") +
        (nameMatched(ngos) ? byName : "")
    ] = ngoNames.slice(0, 6).join(", ");
  if (candidacies)
    facts[bg ? "кандидатури (брой)" : "candidacies"] = candidacies;
  if (donations)
    facts[bg ? "дарения към партии (брой)" : "party donations"] = donations;
  // Public money won by the person's companies (post-annex EUR basis) — grounded verbatim.
  if (p.procuredEur > 0)
    facts[bg ? "обществени поръчки (EUR)" : "public contracts (EUR)"] =
      Math.round(p.procuredEur);
  if (p.fundsEur > 0)
    facts[bg ? "средства от ЕС (EUR)" : "EU funds (EUR)"] = Math.round(
      p.fundsEur,
    );
  if (p.subsidiesEur > 0)
    facts[bg ? "земеделски субсидии (EUR)" : "farm subsidies (EUR)"] =
      Math.round(p.subsidiesEur);
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
  const resolved = await resolvePersonProfile(query);
  if (resolved.kind === "ambiguous")
    return ambiguousPerson(query, bg, "personConnections", resolved.hits);
  if (resolved.kind === "missing")
    return notFound(query, bg, "personConnections");
  const prof = resolved.profile;

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
    viz: "none",
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

type WealthSeriesPoint = {
  year: number;
  assetsEur: number;
  debtsEur: number;
  netEur: number;
  incomeEur: number;
  filings: number;
  tier: string;
};
type WealthPayload = {
  slug: string;
  series: WealthSeriesPoint[];
  markers: {
    year: number;
    type: string;
    filedAt: string | null;
    institution: string | null;
    positionTitle: string | null;
  }[];
} | null;

/**
 * A public figure's DECLARED wealth over time — assets, debts and net worth per year,
 * from the Court-of-Audit (Сметна палата) property declarations (089/090). Every number
 * is verbatim from person_wealth_series: the tool NEVER computes a figure, so the
 * grounded-number gate holds. Declared, not audited — the caveat rides in the payload.
 * Public-safe: the serving fn only returns a public, active person's series.
 */
export const personWealth = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const query = String(args.name ?? args.person ?? "").trim();
  if (!query) return notFound(query, bg, "personWealth");

  // Resolve name → stable slug (same path personConnections uses), then the series.
  const resolved = await resolvePersonProfile(query);
  if (resolved.kind === "ambiguous")
    return ambiguousPerson(query, bg, "personWealth", resolved.hits);
  if (resolved.kind === "missing") return notFound(query, bg, "personWealth");
  const prof = resolved.profile;

  const wealth = await fetchDb<WealthPayload>("person-wealth", {
    slug: prof.slug,
  });
  const series = wealth?.series ?? [];

  const note = bg
    ? "Декларирано пред Сметна палата, не одитирано. Недвижими имоти без обявена стойност се броят за 0."
    : "Declared to the Court of Audit, not audited. Real estate with no declared value counts as €0.";

  if (!series.length) {
    return {
      tool: "personWealth",
      domain: "people",
      kind: "scalar",
      viz: "none",
      title: bg
        ? `Няма декларации за имущество за ${prof.name}`
        : `No asset declarations for ${prof.name}`,
      facts: {
        [bg ? "име" : "name"]: prof.name,
        [bg ? "декларирани години" : "declared years"]: 0,
        [bg ? "бележка" : "note"]: note,
      },
      provenance: ["person_wealth_series (090_person_wealth.sql)"],
    };
  }

  const latest = series[series.length - 1];
  const first = series[0];
  return {
    tool: "personWealth",
    domain: "people",
    kind: "table",
    viz: "line",
    title: bg
      ? `${prof.name} — декларирано имущество по години`
      : `${prof.name} — declared wealth by year`,
    columns: [
      { key: "year", label: bg ? "Година" : "Year" },
      {
        key: "net",
        label: bg ? "Нетно (€)" : "Net (€)",
        numeric: true,
        format: "int",
      },
      {
        key: "assets",
        label: bg ? "Активи (€)" : "Assets (€)",
        numeric: true,
        format: "int",
      },
      {
        key: "debts",
        label: bg ? "Задължения (€)" : "Debts (€)",
        numeric: true,
        format: "int",
      },
    ],
    rows: series.map((p) => ({
      year: p.year,
      net: p.netEur,
      assets: p.assetsEur,
      debts: p.debtsEur,
    })),
    facts: {
      [bg ? "име" : "name"]: prof.name,
      [bg ? "декларирани години" : "declared years"]: series.length,
      [bg ? "най-нова година" : "latest year"]: latest.year,
      [bg ? "нетно (последно)" : "net worth (latest)"]: latest.netEur,
      [bg ? "нетно (първо)" : "net worth (first)"]: first.netEur,
      [bg ? "период" : "span"]: `${first.year}–${latest.year}`,
      [bg ? "бележка" : "note"]: note,
    },
    provenance: ["person_wealth_series (090_person_wealth.sql)"],
  };
};
