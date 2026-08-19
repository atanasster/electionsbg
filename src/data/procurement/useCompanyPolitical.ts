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
 * True when we cannot support the sentence "no links found".
 * ⚠️ A `null`/`undefined` payload is UNKNOWN too, not empty — that covers React Query's loading
 * and error states, a route that is not deployed (404 → throw), and a malformed EIK. Folding any
 * of them into "nothing found" reinstates the denial this tile exists to delete. A body with no
 * `arms` at all is unknown for the same reason.
 */
export const hasUnavailableArm = (d: CompanyPolitical | null | undefined) =>
  !d ||
  !d.arms ||
  d.arms.pg === "unavailable" ||
  d.arms.funds === "unavailable" ||
  d.arms.personLayer === "unavailable";

/**
 * What the corpus supports saying about this company. THREE states, because the two the old
 * tile had were what made it lie: it rendered «Няма установени връзки с политици.» off
 * `links.length === 0`, which conflates "every arm answered and found nobody" with "we could
 * not look".
 *
 * ⚠️ ASK THROUGH THIS, NOT THROUGH `direct.length`. A predicate a caller may forget is weaker
 * than a type with no `none` member until the unknown case has been discharged — and the T3
 * author is porting from exactly the expression that got this wrong.
 */
export type PoliticalVerdict =
  | { state: "unknown"; reason: "no-payload" | "arm-unavailable" }
  | {
      state: "none";
      /** What was actually searched, so the copy can say it instead of denying flatly. */
      searched: { registryRoles: boolean; bridgeComplete: boolean };
    }
  | {
      state: "links";
      direct: CompanyPoliticalDirect[];
      bridged: CompanyPoliticalBridged[];
    };

export const companyPoliticalVerdict = (
  d: CompanyPolitical | null | undefined,
): PoliticalVerdict => {
  if (!d) return { state: "unknown", reason: "no-payload" };
  if (hasUnavailableArm(d))
    return { state: "unknown", reason: "arm-unavailable" };
  const direct = d.direct ?? [];
  const bridged = d.bridged ?? [];
  if (direct.length || bridged.length)
    return { state: "links", direct, bridged };
  return {
    state: "none",
    searched: {
      registryRoles: d.arms.personLayer !== "unavailable",
      // A suppressed fold means the bridge did NOT look everywhere — a refusal, not an absence,
      // and the copy has to be able to tell the reader which one it is looking at.
      bridgeComplete: (d.bridgeFoldsSuppressed ?? 0) === 0,
    },
  };
};
