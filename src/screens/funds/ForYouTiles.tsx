// Stage 9 — band 5, „За теб". The personalised entry points into the funds module.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// A NAVIGATION BAND, NOT A THIRD ANALYSIS. Everything above it answers a question about the
// country; this answers „and what about MY place / MY sector". So each tile is a short,
// place- or sector-specific figure plus the links that continue the journey — never a new
// aggregate, and never a fourth copy of a leaderboard.
//
// WHAT IS MISSING FROM IT, AND WHY. The plan's band-5 row names three tiles: „Моята община ·
// Моят сектор · Следя тази процедура". The third is NOT here, and it is not an oversight — the
// same plan's out-of-scope list says alerts/subscriptions „needs an account system", which this
// site does not have. There is no honest no-account version: a „follow" button that forgets you
// on reload is worse than no button, because the reader believes they are covered. Named here
// rather than silently dropped, per §8.4.
//
// „МОЯТА ОБЩИНА" SHOWS AWARDED MONEY, NOT OPEN CALLS, and the reason is measured rather than
// aesthetic. `opencalls_alerts.ts` establishes it: of the 66 loaded rows, every ИСУН row has
// `territory = NULL` and every ДФЗ row is national („на територията на цялата страна"). Not one
// names an obshtina. So „open calls for your municipality" would render either nothing at all,
// or the same eleven national forecasts in all 265 municipalities. The awarded corpus, by
// contrast, is genuinely per-place — and the combined ИСУН+Interreg basis (migration 139) is
// exactly the figure whose absence understated the border municipalities.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MapPin, Layers } from "lucide-react";
import { useAreaAnchor } from "@/data/area/areaAnchor";
import { useAreaResolver } from "@/data/area/useAreaResolver";
import { isSofiaRayonObshtina } from "@/data/dataTypes";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useFundsMuniCombined } from "@/data/funds/useFundsMuniCombined";
import { useFundsProjectsIndex } from "@/data/funds/useFundsProjectsIndex";
import { formatEur } from "@/lib/currency";

/** The one key Sofia's ~25 район dashboards share — the funds corpus is published citywide. */
const SOFIA_CITY_KEY = "S22";

/** The key shapes `/api/db/funds-muni-combined` accepts. Mirrors the route's own regex: sending
 *  anything else is a 400, a React Query retry, and then a permanent error card. */
const FUNDS_MUNI_KEY = /^([A-Z]{3}\d{2}|S\d{2,4}|SFO_CITY)$/;

const Card: FC<{
  icon: typeof MapPin;
  title: string;
  children: React.ReactNode;
}> = ({ icon: Icon, title, children }) => (
  <div className="rounded-lg border bg-card p-4">
    {/* An <h3>, not a <div>. The shared CardTitle is one, and a screen reader walking the page
        by heading would otherwise skip this whole band. */}
    <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      {title}
    </h3>
    {children}
  </div>
);

/**
 * „Моята община" — the user's chosen place, and what it has actually received.
 *
 * Reads the GLOBAL area anchor (`?area=`), the same one the header pill and MyAreaScreen use,
 * so a place chosen anywhere on the site is already chosen here. With no anchor it invites the
 * reader to pick one rather than defaulting to Sofia: a default place is a wrong answer that
 * looks like a right one.
 */
export const MyMunicipalityTile: FC = () => {
  const { t } = useTranslation();
  const anchor = useAreaAnchor();
  const area = useAreaResolver(anchor?.id);
  const { findMunicipality } = useMunicipalities(!!anchor?.id);
  const resolved =
    area && area.kind !== "unknown" ? (area.obshtina ?? undefined) : undefined;

  // THE KEY THE PAYLOAD ACTUALLY HAS, not the anchor's own id. Two shapes reach this tile that
  // `fund_payloads`' muni-summary does not carry, and both were found in review:
  //   * Sofia's ~25 район anchors — the funds corpus is published at CITY grain, and the whole
  //     city is one key. `MyAreaProjectsMapTile` established S22 as that key; using a different
  //     one here would give the same place two different totals on two pages.
  //   * Пловдив/Варна район ids (`PDV22-01`) — synthesized by the resolver, and no funds key
  //     exists for them at all. The route's regex rejects them, so sending one produced a 400,
  //     a retry, and then a permanent error card on a page that simply has no figure to show.
  //     Sending nothing renders the pick-a-place invitation instead, which is true.
  const obshtina = isSofiaRayonObshtina(resolved)
    ? SOFIA_CITY_KEY
    : resolved && FUNDS_MUNI_KEY.test(resolved)
      ? resolved
      : undefined;
  const { data, isError, isPending } = useFundsMuniCombined(obshtina);

  const title = t("funds_foryou_muni") || "Моята община";

  if (!anchor?.id || !obshtina)
    return (
      <Card icon={MapPin} title={title}>
        <p className="text-sm text-muted-foreground">
          {t("funds_foryou_muni_pick") ||
            "Изберете населено място от полето горе вдясно, за да видите колко европейски пари са стигнали до него."}
        </p>
      </Card>
    );

  // An error is NOT rendered as „0 €" — a failed fetch and a municipality that received nothing
  // are different facts, and the second is a claim we would be making without evidence.
  if (isError)
    return (
      <Card icon={MapPin} title={title}>
        <p className="text-sm text-muted-foreground">
          {t("funds_foryou_unavailable") || "Данните не се заредиха."}
        </p>
      </Card>
    );

  // THE MUNICIPALITY'S NAME, ALWAYS — never the settlement's.
  //
  // The figure below is a MUNICIPAL total, and the common anchor shape is a settlement. Naming
  // the village in bold above its municipality's money reads as „с. Микрево received €10m",
  // which is a claim about the wrong place and one nothing on the card corrects. When the two
  // differ the settlement is named as context, in the smaller line, where it belongs.
  const muniName =
    area?.kind === "settlement"
      ? // `SettlementInfo` carries the obshtina CODE, not its name. The resolver has already
        // pulled `municipalities`, so this lookup is a cache hit rather than a second fetch.
        (findMunicipality(area.settlement.obshtina)?.name ??
        area.settlement.obshtina)
      : area?.kind === "municipality"
        ? area.municipality.name
        : obshtina;
  const settlementName =
    area?.kind === "settlement" ? area.settlement.name : null;

  return (
    <Card icon={MapPin} title={title}>
      <div className="text-sm font-medium">{muniName}</div>
      {settlementName ? (
        <p className="text-xs text-muted-foreground">
          {t("funds_foryou_muni_via") || "по общината на"} {settlementName}
        </p>
      ) : null}
      {data ? (
        <>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {formatEur(data.totalEur)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("funds_foryou_muni_basis") ||
              "ИСУН (подписани договори) + Interreg (публикуван бюджет на българския партньор)."}
            {data.interregEur > 0 ? (
              <>
                {" "}
                {t("funds_foryou_muni_interreg") || "От тях по Interreg:"}{" "}
                <span className="tabular-nums">
                  {formatEur(data.interregEur)}
                </span>
                .
              </>
            ) : null}
          </p>
          {/* NULL-CHECKED, not `> 0`. Migration 139 returns NULL for a cohort non-member —
              `rank()` is never 0 for a row it emits — so a `> 0` test silently never fires and
              the not-ranked copy below would be stranded. Столична община is the case: no ГРАО
              city EKATTE, so no per-capita figure on either arm, and rendering a rank for it
              would put the country's largest recipient last.

              And it is labelled „в страната": the payload carries BOTH a national `rank` and an
              `oblastRank`, MyAreaProjectsMapTile renders the oblast one under „в областта", and
              an unlabelled number would be the same silent redefinition its comment warns of. */}
          {data.rank != null && data.cohortSize > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("funds_foryou_muni_rank") ||
                "На глава от населението, в страната:"}{" "}
              <span className="tabular-nums">
                {data.rank}/{data.cohortSize}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("funds_foryou_muni_unranked") ||
                "Общината не е в класацията на глава от населението — това не значи „без пари“."}
            </p>
          )}
        </>
      ) : (
        // `!data` is THREE different states — the fetch in flight, a database without migration
        // 139 (the route degrades to `null` at a 200), and a municipality the payload has no
        // row for. None of them is „not ranked", which is what this branch used to assert on
        // every cold load. Say only what is known.
        <p className="mt-1 text-sm text-muted-foreground">
          {isPending
            ? (t("funds_foryou_loading") ?? "Зарежда се…")
            : (t("funds_foryou_muni_nodata") ??
              "Няма публикувана сума за тази община.")}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {/* The governance dashboard is the per-place hub; there is no `/funds/place/:code`
            route and inventing a link to one would 404 the tile's main affordance. */}
        {/* `resolved`, NOT `obshtina`. The latter is the FUNDS key, which folds all ~25 Sofia
            районы onto S22 because the corpus is published citywide — following it here would
            send a reader who chose Средец to the whole-city dashboard. The governance hub does
            serve район grain, so the link keeps the place the reader actually picked. */}
        <Link
          to={`/governance/${encodeURIComponent(resolved ?? obshtina)}`}
          className="text-primary hover:underline"
        >
          {t("funds_foryou_muni_link") || "Управление на общината"}
        </Link>
        <Link to="/funds/calls" className="text-primary hover:underline">
          {t("funds_foryou_calls_link") || "Отворени процедури"}
        </Link>
      </div>
    </Card>
  );
};

/**
 * „Моят сектор" — the programmes, as an entry point rather than a ranking.
 *
 * Deliberately the FIRST few by money with a „see all" rather than a top-10 leaderboard: band 3
 * already ranks programmes, and repeating it here would make this band read as offcuts. What
 * this adds is the jump — pick the programme that funds your kind of work and land on its page.
 */
export const MySectorTile: FC = () => {
  const { t } = useTranslation();
  const { data, isError, isPending } = useFundsProjectsIndex();

  const title = t("funds_foryou_sector") || "Моят сектор";
  // Ordered by money in the index, so the first five are the programmes most readers will be
  // looking for. Band 3 already RANKS them; this is a jump-off, so the figures are left out.
  const programmes = (data?.byProgram ?? [])
    .filter((p) => p.programCode && p.programName)
    .slice(0, 5);

  // Three states, three sentences. `isError || !programmes.length` collapsed „in flight" and
  // „loaded, and the corpus genuinely has none" into „could not load" — a falsehood on every
  // cold render, and one an earlier test pinned.
  if (isPending || isError || !programmes.length)
    return (
      <Card icon={Layers} title={title}>
        <p className="text-sm text-muted-foreground">
          {isPending
            ? (t("funds_foryou_loading") ?? "Зарежда се…")
            : isError
              ? (t("funds_foryou_unavailable") ?? "Данните не се заредиха.")
              : (t("funds_foryou_sector_none") ?? "Няма програми в корпуса.")}
        </p>
      </Card>
    );

  return (
    <Card icon={Layers} title={title}>
      <p className="mb-2 text-xs text-muted-foreground">
        {t("funds_foryou_sector_hint") ||
          "Всяка програма финансира различни дейности. Изберете тази, която покрива вашата."}
      </p>
      <ul className="space-y-1 text-sm">
        {programmes.map((p) => (
          <li key={p.programCode}>
            <Link
              to={`/funds/programme/${encodeURIComponent(p.programCode)}`}
              className="text-primary hover:underline"
            >
              {p.programName}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-xs">
        {/* Band 3's programme ranking, on this same page — there is no `/funds/programs` index
            route, and the anchor is where the full list actually lives. */}
        <Link to="/funds#programs" className="text-primary hover:underline">
          {t("funds_foryou_sector_all") || "Всички програми"}
        </Link>
      </div>
    </Card>
  );
};
