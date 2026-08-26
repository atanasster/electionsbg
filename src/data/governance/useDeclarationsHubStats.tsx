// The /governance/declarations tile figures — one ~1 KB blob for six tiles.
//
// Six leaderboards, each backed by its own matview. Counting them live would be six queries
// on a page whose only job is to point elsewhere; the alternative that shipped was no
// figures at all, which leaves a reader unable to tell whether „Автомобили на депутати" is
// about forty cars or two thousand.
//
// `undefined` is an answer, not a loading state: on a checkout with no generated blob the
// tiles render without numbers, exactly as they did before, rather than showing zeroes.
//
// THE SCOPED HALF IS THE POINT, AND ITS SCOPE IS `?pscope`. /mp-assets and /mp-cars
// are scoped by the SAME shared param this hook reads, through the SAME
// `pscopeToMpAssets` mapping and the SAME `mpAssetsNsScope` helper those screens
// filter with — so the tile and the page it opens are one number by construction
// rather than by coincidence. Measured on the committed blob, the gap that
// coincidence would have to close is 15×: 42 cars on the 52nd against 643 all-time,
// 240 MPs with declared assets against 2,122.
//
// It was `?elections` plus a local `useState` on each screen until 2026-08-26, which
// is a worse thing than it sounds: the hub could not offer an all-time view at all,
// and the two destinations reset to their own default on arrival, so a reader who
// widened one and followed a link silently got the other's window back. `?pscope` is
// in the `usePreserveParams` allowlist, so the scope now rides the link.
//
// The register has NO year slices — 2024 held two parliaments, so no calendar year
// names one — hence `useScope({ years: [] })`. `resolveScope` clamps an inbound
// `y:2019` (minted on /procurement and carried along by that same allowlist) back to
// the selected parliament, and `pscopeToMpAssets` is the second line of defence.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import {
  mpAssetsNsScope,
  useMpAssetsScope,
} from "@/screens/utils/mpAssetsScope";

export interface DeclarationsNsStats {
  mpsWithAssets: number;
  cars: number;
  carOwners: number;
}

export interface DeclarationsHubStats {
  computedAt: string;
  /** What /persons LISTS on arrival — its default tier='P' public-figure floor. NOT the
   *  identity layer's 126,004, and not person_browse_table's 128,584. */
  people: number;
  peopleWithDeclaration: number;
  /** What /officials/assets opens on — its is_exec filter, not the table's 19,036. */
  officials: number;
  /** What /companies?political=1 LISTS — company_browse_table (188) WHERE
   *  is_official_linked, formerly official_companies' (178) whole relation. NOT
   *  „companies": some are сдружения, читалища, фондации, кооперации or държавни
   *  предприятия. */
  organisations: number;
  /** DISTINCT people in public life attached to them. Renamed from `companyMps` when the
   *  destination stopped being MP-only — a field keeping that name lies by name. */
  organisationPeople: number;
  /** Keyed by `ns` — the numeric parliament ('52'), plus the 'all' roll-up. */
  byNs: Record<string, DeclarationsNsStats>;
  /** The head's evidence rail — the largest declared net worth, in `/officials/assets`'
   *  own filter and sort order, so the rail's rows ARE that page's first rows.
   *
   *  ⚠️ Absent on a blob generated before 2026-08-26. The evidence builder refuses
   *  outright in that case rather than rendering an undated list. */
  topNetWorth?: TopNetWorth[];
  /** The span of filing years those rows are drawn from. NOT one year: each row is that
   *  person's LATEST filing and people stop filing when they leave office, so the rail
   *  legitimately mixes vintages — measured 2026-08-26, five rows spanning 2021 to 2026.
   *  It rides on the SAME blob as the rows so the two cannot describe different sets. */
  topNetWorthYears?: { first: number; last: number } | null;
}

export interface TopNetWorth {
  /** The /person slug — the row's link, and its React key: two officials can share a name. */
  slug: string;
  name: string;
  /** Declared assets minus declared debts, in EUR. NOT a valuation — the register excludes
   *  property the declarant only uses and counts nothing it was not told about. */
  netWorthEur: number;
  /** The filing this figure comes from. Differs per person, by up to five years. */
  year: number;
}

const queryFn = async (): Promise<DeclarationsHubStats | undefined> => {
  const r = await fetch(dataUrl("/governance/declarations_hub_stats.json"));
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`declarations-hub-stats: ${r.status}`);
  return r.json();
};

export const useDeclarationsHubStats = (): {
  stats: DeclarationsHubStats | undefined;
  /** The ACTIVE scope's slice — the selected parliament on `ns`, the whole register on
   *  `all` — or undefined when that slice has no rows. */
  nsStats: DeclarationsNsStats | undefined;
  /** Which of the two the caller ASKED for, so a caption can name it. */
  scope: "ns" | "all";
  /** The bucket actually READ — which is not always `scope`. `mpAssetsNsScope` falls
   *  back to the national roll-up when the selection resolves to no NS folder, so on
   *  `scope: "ns"` with no folder `nsStats` IS the all-parliaments figure. A caption
   *  keyed on `scope` would then print „2 122 · от 2 122 за всички парламенти" — the
   *  same number twice, as two facts. Key it on this instead. */
  bucket: string;
  /** IN FLIGHT — genuinely, not „has no figures".
   *
   *  ⚠️ THE TWO ARE NOT THE SAME STATE, AND `stats === undefined` CANNOT TELL THEM APART.
   *  A 404 is an ANSWER here (see this file's head: the tiles render bare on a checkout
   *  with no generated blob), and it leaves `stats` undefined exactly as a request in
   *  flight does. A skeleton keyed on `stats` is therefore a tautology that pulses for
   *  ever on any hosting deploy that lands before the bucket sync. */
  pending: boolean;
} => {
  const { selected } = useElectionContext();
  // ⚠️ `?pscope`, THE SHARED PARAM — the same one /mp-assets and /mp-cars now read, which is
  // what keeps a tile and the page it opens on one number. `?elections` still names WHICH
  // parliament `ns` means; `?pscope` chooses between that parliament and the whole register.
  // The two coexist here exactly as they do on /procurement.
  //
  // `years: []` because this corpus is sliced by PARLIAMENT, not by calendar year — 2024
  // held two parliaments, so `y:2024` names no single slice and resolves back to `ns`.
  const { scope } = useMpAssetsScope();
  const { data, isPending } = useQuery({
    queryKey: ["governance", "declarations-hub-stats"] as const,
    queryFn,
    staleTime: Infinity,
  });

  // Exactly the destination screens' filter value: the NS folder when the selected election
  // maps to one, 'all' otherwise — which is also what they fall back to for a non-
  // parliamentary selection. Duplicating this rule by hand is how the two would drift.
  const key = mpAssetsNsScope(scope, electionToNsFolder(selected)).val;

  return {
    stats: data,
    nsStats: data?.byNs?.[key],
    scope,
    bucket: key,
    pending: isPending,
  };
};
