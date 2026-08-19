// useCompanyPolitical — the /company/:eik political-links tile's one data source.
//
// It reads `/api/db/company-political`, which unions THREE arms server-side:
// `company_politicians` (008, procurement-derived), the ИСУН `political-by-eik` shard, and
// `company_political_links` (158, the gated person layer). The union is not done here because
// its dedup key cannot be: the three arms name one human three ways, and resolving them needs
// `officials_person_slug()` — total only because it falls through `person_slug_retired`, whose
// 37 retired refs nothing in the browser can resolve. See the route's header for the full
// argument and the measurements.
//
// ⚠️ AN ARM THAT COULD NOT RUN IS `unavailable`, WHICH IS NOT `absent`, AND THE DIFFERENCE IS
// THE WHOLE REASON THIS TILE WAS REWRITTEN. The old tile printed «Няма установени връзки с
// политици.» whenever its two money-gated arms came back empty — which, for any company that
// never signed a contract or drew EU funds, they always do. That denial was a false claim about
// named public figures. A consumer must therefore treat `unavailable` as UNKNOWN and never fold
// it into "nothing found"; `hasUnavailableArm` below exists so that cannot be done by accident.

import { useQuery } from "@tanstack/react-query";
import { decodeEntities } from "@/lib/decodeEntities";

/** Whether an arm answered, contributed nothing, or could not run at all. */
export type ArmState = "ok" | "absent" | "unavailable";

/** Which corpus a direct row came from. Never sort ACROSS these — see `direct` below. */
export type PoliticalArm = "pg" | "funds" | "person_layer";

export interface CompanyPoliticalDirect {
  arm: PoliticalArm;
  /** Person-layer slug; the dedup key. Null when no resolver could name one. */
  slug: string | null;
  /** Where the row links. Null when there is no servable destination. */
  href: string | null;
  name: string;
  kind: "mp" | "official";
  mpId?: number;
  /** pg only — the official's category bucket (mayor / governor / …). */
  role?: string | null;
  /**
   * pg + funds — relation jsonb. Summarize with `summarizeFundsRelations`
   * (`@/data/funds/relationLabel`); MP rows are `FundsMpRelation[]` (`@/data/funds/types`).
   */
  relations?: unknown;
  totalEur?: number | null;
  /** funds officials only. */
  category?: string | null;
  institution?: string | null;
  municipality?: string | null;
  latestDeclarationYear?: number | null;
  /** funds officials only — summarize with `summarizeOfficialRoles` (`@/data/funds/officialLabels`). */
  officialRoles?: unknown;
  /** 158 only — `person_source.key` / `person_role.role` of their most prominent office. */
  officeSource?: string | null;
  officeRole?: string | null;
  /** 158 only — their tr/ngo role codes AT this company (`tr_role_*` labels them). */
  trRoles?: string[];
  /**
   * 158 only. `declared` means a curated register put this COMPANY on this person; it is
   * stronger than a bare name fold and is NOT a confirmed identity (148 §0.2). Never render it
   * as "verified".
   */
  linkBasis?: "declared" | "name_match" | null;
}

export interface CompanyPoliticalBridged {
  slug: string;
  name: string;
  /**
   * ⚠️ BULGARIAN ONLY — DO NOT RENDER. This is `person_source.label_bg`, and `person_source`
   * has no `label_en` column, so putting it on the page ships BG office names to `/en`. Render
   * `officeRole` through `usePersonLabels().roleLabel()` (`pp_role_*`, bilingual, 55 of 57
   * roles) instead. Declared here only because the route returns it.
   */
  office: string | null;
  officeSource: string | null;
  officeRole: string | null;
  /** The officer shared between this company and `viaCompany`. */
  bridgeName: string | null;
  /** How many companies that officer holds — the tightness of the path, and the sort key. */
  bridgeCompanies: number | null;
  viaEik: string | null;
  viaCompany: string | null;
  /** How many distinct paths reach this person; the row shows the tightest. */
  pathCount: number | null;
}

export interface CompanyPolitical {
  eik: string;
  name: string | null;
  /**
   * Ordered pg (money desc) → funds → 158 (office prominence). Sort WITHIN an `arm` if you must;
   * sorting across them scatters the two arms that have no money to sort by into the tail.
   */
  direct: CompanyPoliticalDirect[];
  /**
   * SECOND-DEGREE leads, kept in their own array so they cannot be rendered as first-degree
   * links. Never merge this into `direct` behind a confidence column — that is exactly how the
   * retired shard family let a two-hop coincidence read as a finding.
   */
  bridged: CompanyPoliticalBridged[];
  directCount: number | null;
  bridgedCount: number | null;
  directTruncated: boolean;
  bridgedTruncated: boolean;
  /** Duplicates removed from `bridged` because the person is already direct — window-scoped. */
  bridgedSuppressedAsDirect: number;
  bridgeMaxCompanies: number | null;
  /** Officers too widely held to traverse. >0 means the bridge did not look everywhere. */
  bridgeFoldsSuppressed: number | null;
  arms: { pg: ArmState; funds: ArmState; personLayer: ArmState };
}

const fetchCompanyPolitical = async (
  eik: string,
): Promise<CompanyPolitical | null> => {
  const r = await fetch(
    `/api/db/company-political?eik=${encodeURIComponent(eik)}`,
  );
  if (!r.ok) throw new Error(`company-political: ${r.status}`);
  // `Partial` rather than the full type: the normalization below is only honest if the cast
  // does not already promise the fields are there.
  const j = (await r.json()) as Partial<CompanyPolitical> | null;
  if (!j) return null;
  return {
    ...(j as CompanyPolitical),
    // ⚠️ `name` AND `viaCompany` ARE THE SAME COLUMN — `tr_companies.name` — of which 14,741 of
    // 1,020,707 carry a raw `&quot;`. Decoding one and not the other puts the escape sequence in
    // the tile's header and not in its rows; EIK 831192122 returns both at once, which is how
    // that asymmetry was found. `bridgeName` is `tr_person_roles.name` from the same feed (82
    // rows), and `decodeEntities` is a no-op on a string with no entity, so all three decode.
    name: j.name ? decodeEntities(j.name) : null,
    // Both arrays are typed non-nullable, so both are normalized. Guarding one and spreading the
    // other means the type is a promise the fetch only half keeps.
    direct: j.direct ?? [],
    // ⚠️ AND `arms` MOST OF ALL — it is the field whose absence prints a denial. Typed
    // non-nullable like the arrays, so it is normalized HERE rather than guarded twice
    // downstream; an absent `arms` means "we do not know which arms ran", which is
    // `unavailable`, never `absent`. The route always emits it, but hosting and the `db`
    // function deploy separately and a warm instance can serve an older response shape for ten
    // minutes (CLAUDE.md), so the older shape must degrade to unknown rather than to "none".
    arms: j.arms ?? {
      pg: "unavailable",
      funds: "unavailable",
      personLayer: "unavailable",
    },
    bridged: (j.bridged ?? []).map((b) => ({
      ...b,
      bridgeName: b.bridgeName ? decodeEntities(b.bridgeName) : null,
      viaCompany: b.viaCompany ? decodeEntities(b.viaCompany) : null,
    })),
  };
};

export const useCompanyPolitical = (eik?: string | null) =>
  useQuery({
    queryKey: ["company-political", eik ?? ""],
    queryFn: () => fetchCompanyPolitical(eik as string),
    enabled: !!eik,
    staleTime: Infinity,
  });

/**
 * Which sources could not be consulted. THE one place this rule is written.
 *
 * A missing `arms` object is every arm unavailable, not none of them — but the fetch normalizes
 * that away at the boundary, so this branch is belt-and-braces rather than the only defence.
 */
const unavailableArms = (d: CompanyPolitical): PoliticalArm[] => {
  if (!d.arms) return ["pg", "funds", "person_layer"];
  const out: PoliticalArm[] = [];
  if (d.arms.pg === "unavailable") out.push("pg");
  if (d.arms.funds === "unavailable") out.push("funds");
  if (d.arms.personLayer === "unavailable") out.push("person_layer");
  return out;
};

/**
 * True when we cannot support the sentence "no links found".
 *
 * ⚠️ THIS IS THE SCALAR FORM, AND IT IS NOT WHAT THE TILE ASKS — `companyPoliticalVerdict` is.
 * Kept exported because "is this answer complete?" is a legitimate question for a consumer that
 * does not need the rows (a KPI, a chip), and DERIVED from `unavailableArms` so the two can never
 * disagree about a missing `arms` object. They were two hand-written copies of the same rule, and
 * the drift between them was invisible: the suite covered the armless case only through this
 * predicate, which nothing ships, so deleting the guard in the shipped one still passed 11/11.
 */
export const hasUnavailableArm = (d: CompanyPolitical | null | undefined) =>
  !d || unavailableArms(d).length > 0;

/**
 * What the corpus supports saying about this company. THREE states, because the two the old tile
 * had were what made it lie: it rendered «Няма установени връзки с политици.» off
 * `links.length === 0`, which conflates "every arm answered and found nobody" with "we could not
 * look".
 *
 * ⚠️ ASK THROUGH THIS, NOT THROUGH `direct.length`. A predicate a caller may forget is weaker
 * than a type with no `none` member until the unknown case has been discharged.
 *
 * ⚠️ AND `links` OUTRANKS `unknown`, WHICH IS THE HALF THAT IS EASY TO GET BACKWARDS. Checking
 * "is any arm unavailable" FIRST looks like the cautious order and is the mirror image of the
 * original defect: with the PG arm down and the person layer returning five office-holders, it
 * discards all five and prints «проверката не можа да бъде извършена». Suppressing a true finding
 * is not the safe direction — it is the same failure pointed the other way. A found link is a
 * fact whatever else was unreachable, so it is published WITH `unavailable` naming what is
 * missing, and `unknown` is reserved for the case where we have nothing to show AND could not
 * look everywhere.
 */
export type PoliticalVerdict =
  /** Nothing found and at least one source unreachable — we cannot say anything. */
  | { state: "unknown"; unavailable: PoliticalArm[] | "no-payload" }
  /** Every arm answered and found nobody. `bridgeComplete` false = the bridge was cut short. */
  | { state: "none"; bridgeComplete: boolean }
  /** Links found. `unavailable` may still be non-empty — the answer is real but partial. */
  | {
      state: "links";
      direct: CompanyPoliticalDirect[];
      bridged: CompanyPoliticalBridged[];
      unavailable: PoliticalArm[];
      bridgeComplete: boolean;
    };

export const companyPoliticalVerdict = (
  d: CompanyPolitical | null | undefined,
): PoliticalVerdict => {
  if (!d) return { state: "unknown", unavailable: "no-payload" };
  const unavailable = unavailableArms(d);
  const direct = d.direct ?? [];
  const bridged = d.bridged ?? [];
  // A suppressed fold means the bridge did NOT look everywhere — a refusal, not an absence, and
  // the copy has to be able to tell the reader which one it is looking at.
  const bridgeComplete = (d.bridgeFoldsSuppressed ?? 0) === 0;
  if (direct.length || bridged.length)
    return { state: "links", direct, bridged, unavailable, bridgeComplete };
  if (unavailable.length) return { state: "unknown", unavailable };
  return { state: "none", bridgeComplete };
};
