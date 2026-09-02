// Interreg on /funds — the cross-border corpus ИСУН does not hold, and the
// municipalities it moves once counted.
//
// `fund_projects` contains ZERO Interreg projects. That is a system boundary,
// not a filter: Interreg runs on Jems while the Bulgarian OPs run on ИСУН 2020,
// so no amount of re-querying the ИСУН export would have found them. Because
// Interreg is cross-border by definition, every euro of it lands on a border
// municipality — which is why the site's per-capita ranking understated exactly
// the poorest, most depopulated общини in the country until migration 139.
//
// The tile therefore does two things, and the second is the point: it states the
// corpus, and it shows WHO MOVED. A total nobody can locate is a statistic; a
// municipality that climbs 43 places is the finding.
//
// Both figures come from live aggregates over the fact tables (137/138/139),
// never from fund_payloads — an `interreg-*` kind written there would be
// silently deleted by the next db:load:funds:pg.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/ux/Card";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import {
  useInterregOverview,
  useFundsMuniRank,
} from "@/data/funds/useInterreg";

const numFmt = new Intl.NumberFormat("bg-BG");
const MOVERS_SHOWN = 10;
const PROGRAMMES_SHOWN = 6;

// The per-place Interreg tile lives on the governance/My-Area dashboard, at this
// fixed id — see MyAreaInterregTile.tsx (which sets it) and
// FundsInterregProgrammeScreen.tsx (which also links to it). Exported so all
// three sites share one literal rather than three independent copies that can
// drift silently if the anchor is ever renamed. Linking here with a `#` hash
// relies on the app-wide hash-scroll in routes.tsx's `ScrollToTop`, so no
// scroll code is needed on this end.
export const GOVERNANCE_INTERREG_ANCHOR = "myarea-interreg";

// Sofia never appears in `municipalities.json` under the obshtina code this
// corpus keys it with: `interreg_programme()`/`interreg_by_place()` (194/138)
// normalise the capital to the synthetic `S22` anchor — the same pseudo-code
// `fund_projects` uses (139's header) — and `findMunicipality("S22")` finds
// no row. Left unhandled, every surface reading `m.obshtina` renders the bare
// code "S22" instead of a name (and the ИСУН side of this same family can
// also emit the district codes S23xx/S24xx/S25xx — summaryTiles.tsx's
// `TopMunis` already folds those the same way). One definition so the two
// Interreg municipality lists (this tile's movers list and
// FundsInterregProgrammeScreen's per-programme list) cannot drift.
export const interregMuniName = (
  code: string,
  findMunicipality: (
    code?: string | null,
  ) => { name: string; name_en: string } | undefined,
  bg: boolean,
): string => {
  if (/^S2[2-5]\d{0,2}$/.test(code))
    return bg ? "София (столица)" : "Sofia (city)";
  const muni = findMunicipality(code);
  return (bg ? muni?.name : muni?.name_en) ?? code;
};

const Stat: FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div className="flex flex-col">
    <span className="text-lg font-bold tabular-nums leading-tight">
      {value}
    </span>
    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    {hint ? (
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    ) : null}
  </div>
);

export const InterregTile: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const bg = lang === "bg";
  // 25, not 12 (the route's own default): comfortably above the ~19-23
  // registered programmes, so the "see all" expansion below has the whole
  // list already in memory — no second request on click.
  const { data: overview } = useInterregOverview(25);
  // 300, not 10: the server orders by RANK while the tile ranks by rankDelta,
  // so a smaller limit returns the wrong ten climbers. ~40 KB for 256 rows.
  const { data: ranking } = useFundsMuniRank(300);
  const { findMunicipality } = useMunicipalities();
  const [showAllMunis, setShowAllMunis] = useState(false);
  const [showAllProgrammes, setShowAllProgrammes] = useState(false);

  // The biggest climbers, which is what the tile exists to show. Sorted on
  // rankDelta rather than on money: a large municipality can take more euros and
  // barely move, while a village of 3,000 moves 40 places on a single project —
  // and it is the second that the ИСУН-only ranking was getting wrong.
  const movers = useMemo(
    () =>
      (ranking?.munis ?? [])
        .filter((m) => m.rankDelta > 0)
        .sort(
          (a, b) => b.rankDelta - a.rankDelta || b.interregEur - a.interregEur,
        )
        .slice(0, MOVERS_SHOWN),
    [ranking],
  );

  // Every municipality Interreg reaches at all, not only the ones whose rank
  // moved — a place can hold Interreg money and still tie its previous rank
  // (rank() never decreases on more money, but two municipalities can share a
  // rank). Sorted by money, since "who moved" no longer applies once the list
  // is complete. This is the "see all" expansion — no extra fetch: `ranking`
  // already holds the full ~256-municipality cohort (see the 300 above).
  const allWithInterreg = useMemo(
    () =>
      (ranking?.munis ?? [])
        .filter((m) => m.interregEur > 0)
        .sort(
          (a, b) =>
            b.interregEur - a.interregEur ||
            a.obshtina.localeCompare(b.obshtina),
        ),
    [ranking],
  );

  const visibleMunis = showAllMunis ? allWithInterreg : movers;

  // The programmes list, sliced the same toggle-dependent way as the
  // municipalities lists above — memoized for the same reason `movers`/
  // `allWithInterreg` are, and for consistency with them.
  const visibleProgrammes = useMemo(
    () =>
      showAllProgrammes
        ? (overview?.programmes ?? [])
        : (overview?.programmes ?? []).slice(0, PROGRAMMES_SHOWN),
    [overview, showAllProgrammes],
  );

  // Everything the ranking cannot see, on the INTERREG arm. `ranked` is the
  // covered bucket, so it is not an exclusion — the other two are. The ИСУН
  // exclusion is a separate and far larger number (€6.56bn, mostly Sofia) and
  // comes from the payload: printing only this one beside a sentence naming both
  // sources would say €95m is missing from a ranking missing €6.6bn.
  const excludedEur = useMemo(
    () =>
      Object.entries(ranking?.excluded ?? {})
        .filter(([reason]) => reason !== "ranked")
        .reduce((a, [, v]) => a + v.eur, 0),
    [ranking],
  );

  // The hooks above must run unconditionally on every render (rules-of-hooks),
  // so the early return sits here rather than before them.
  if (!overview || overview.partnerCount === 0) return null;

  // `programmeCount` is the server's own unbounded distinct-programme count,
  // which is what the "see all N" wording SHOULD promise (see the memo
  // above's sibling reasoning). But nothing enforces `programmeCount <=
  // overview.programmes.length` — the array is a server-side LIMIT prefix,
  // capped at 25 in the request below — so clamping here is what stops a
  // future corpus outgrowing that cap from making this button lie about how
  // many rows expanding it will actually show.
  const displayedProgrammeCount = Math.min(
    overview.programmeCount,
    overview.programmes.length,
  );

  const p2127 = overview.periods["2021-2027"];
  const p1420 = overview.periods["2014-2020"];

  // data-og is the og:image capture's anchor AND its wait-for (scripts/og/capture-screens.ts).
  // It sits below the `!overview` guard on purpose: the attribute only exists once the tile
  // has data, so a capture waiting on it cannot photograph the loading state.
  return (
    <Card data-og="funds-interreg">
      <CardContent className="p-4 flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold">{t("interreg_title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("interreg_intro")}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat
            label={t("interreg_stat_budget")}
            value={formatEurCompact(overview.budgetEur, lang)}
          />
          <Stat
            label={t("interreg_stat_operations")}
            value={numFmt.format(overview.operationCount)}
          />
          <Stat
            label={t("interreg_stat_partners")}
            value={numFmt.format(overview.partnerCount)}
            // `placed`, not `count`: i18next reserves `count` for plural
            // selection and types it as a number, so a pre-formatted string
            // there is a type error rather than a label.
            hint={t("interreg_placed_hint", {
              placed: numFmt.format(overview.placedCount),
            })}
          />
          <Stat
            label={t("interreg_stat_programmes")}
            value={numFmt.format(overview.programmeCount)}
          />
        </div>

        {/* The period split is a caveat, not a detail: keep.eu's national-id
            field exists only in the 2021-2027 template, so the older and larger
            half of this money can be attributed to a PLACE but never to a
            company. Saying so here is cheaper than every downstream surface
            having to discover it. */}
        {p1420 && p2127 ? (
          <p className="text-[11px] text-muted-foreground">
            {t("interreg_periods", {
              older: formatEur(p1420.budgetEur, lang),
              newer: formatEur(p2127.budgetEur, lang),
              linked: numFmt.format(p2127.linkedCount),
              rows: numFmt.format(p2127.partnerCount),
            })}
          </p>
        ) : null}

        {allWithInterreg.length > 0 && ranking ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold">
              {/* The heading names WHAT is rendered beneath it — "who climbs"
                  is true of the default movers-only view, but once expanded
                  most rows never moved rank at all (they show "=", not "+N"),
                  so the caption must switch with the list rather than keep
                  asserting a claim the expanded rows do not support. */}
              {showAllMunis
                ? t("interreg_munis_all_title", {
                    total: numFmt.format(ranking.withInterregCount),
                  })
                : t("interreg_movers_title", {
                    moved: numFmt.format(ranking.movedCount),
                    cohort: numFmt.format(ranking.cohortSize),
                  })}
            </h3>
            <ul className="divide-y text-xs">
              {visibleMunis.map((m) => {
                return (
                  <li
                    key={m.obshtina}
                    className="flex flex-wrap items-baseline gap-x-3 py-1.5"
                  >
                    {/* Every place with Interreg money already has a per-place
                        breakdown on the governance dashboard (MyAreaInterregTile,
                        id="myarea-interreg") — the app-wide hash-scroll in
                        routes.tsx's ScrollToTop lands the reader on it. */}
                    <Link
                      to={`/governance/${m.obshtina}#${GOVERNANCE_INTERREG_ANCHOR}`}
                      className="min-w-0 flex-1 truncate font-medium underline"
                    >
                      {interregMuniName(m.obshtina, findMunicipality, bg)}
                    </Link>
                    <span className="tabular-nums text-muted-foreground">
                      {formatEurCompact(m.interregEur, lang)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {m.rankBefore} → {m.rank}
                    </span>
                    <span
                      className={
                        m.rankDelta > 0
                          ? "w-10 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400"
                          : "w-10 text-right tabular-nums text-muted-foreground"
                      }
                    >
                      {m.rankDelta > 0 ? `+${m.rankDelta}` : "="}
                    </span>
                  </li>
                );
              })}
            </ul>
            {allWithInterreg.length > MOVERS_SHOWN ? (
              <button
                type="button"
                aria-expanded={showAllMunis}
                onClick={() => setShowAllMunis((v) => !v)}
                className="self-start text-[11px] font-medium text-primary hover:underline"
              >
                {showAllMunis
                  ? t("interreg_munis_collapse")
                  : t("interreg_munis_expand", {
                      // The server's own count for "how many municipalities hold
                      // Interreg money" — not `allWithInterreg.length`, which is
                      // derived from a 300-row-capped response. The two agree
                      // today (the cohort is ~256), but only one of them stays
                      // correct if the cohort ever grows past the cap.
                      total: numFmt.format(ranking.withInterregCount),
                    })}
              </button>
            ) : null}
            {/* WHAT THE RANKING DOES NOT COVER. Столична община's €88.7m is the
                bulk of it: Sofia has no per-capita figure on EITHER arm, because
                ГРАО carries no Sofia city EKATTE. Without this line the table
                above reads as national coverage it does not have. */}
            {excludedEur > 0 ? (
              <p className="text-[10px] text-muted-foreground">
                {t("interreg_excluded", {
                  cohort: numFmt.format(ranking.cohortSize),
                  interreg: formatEur(excludedEur, lang),
                  isun: formatEur(ranking.excludedIsunEur, lang),
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {overview.programmes.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold">
              {showAllProgrammes
                ? t("interreg_by_programme_all", {
                    total: numFmt.format(displayedProgrammeCount),
                  })
                : t("interreg_by_programme", {
                    shown: Math.min(
                      PROGRAMMES_SHOWN,
                      overview.programmes.length,
                    ),
                    total: numFmt.format(displayedProgrammeCount),
                  })}
            </h3>
            <ul className="divide-y text-xs">
              {visibleProgrammes.map((p) => (
                <li
                  key={p.code}
                  className="flex flex-wrap items-baseline gap-x-3 py-1.5"
                >
                  <Link
                    to={`/funds/interreg/programme/${p.code}`}
                    className="min-w-0 flex-1 truncate underline"
                  >
                    {(bg ? p.nameBg : p.nameEn) ?? p.code}
                  </Link>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {p.period}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {numFmt.format(p.operationCount)}
                  </span>
                  <span className="tabular-nums font-medium">
                    {formatEurCompact(p.budgetEur, lang)}
                  </span>
                </li>
              ))}
            </ul>
            {overview.programmes.length > PROGRAMMES_SHOWN ? (
              <button
                type="button"
                aria-expanded={showAllProgrammes}
                onClick={() => setShowAllProgrammes((v) => !v)}
                className="self-start text-[11px] font-medium text-primary hover:underline"
              >
                {showAllProgrammes
                  ? t("interreg_programmes_collapse")
                  : t("interreg_programmes_expand", {
                      total: numFmt.format(displayedProgrammeCount),
                    })}
              </button>
            ) : null}
          </div>
        ) : null}

        <p className="text-[10px] text-muted-foreground">
          <a
            href="https://keep.eu/"
            target="_blank"
            rel="noreferrer noopener"
            className="underline"
          >
            keep.eu
          </a>{" "}
          {t("interreg_source")}
        </p>
      </CardContent>
    </Card>
  );
};
