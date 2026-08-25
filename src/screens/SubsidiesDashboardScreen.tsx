// ДФ „Земеделие" (State Fund Agriculture) subsidy hub — /subsidies.
//
// A DASHBOARD HUB, not a dashboard: this page fronts the module's thirteen destinations and
// renders no analysis of its own. Everything it used to draw inline — the choropleth, the
// concentration ladder, the scheme and oblast bars, the year trend, the top-recipient list —
// now lives on the sub-page that is about it, reachable from the tile that names it. The
// immediate win was the map: 407 KB of oblast GeoJSON that every visitor downloaded to see a
// thumbnail, now loaded only by the reader who opens /subsidies/places.
//
// WHAT STAYS LIVE ABOVE THE GRID: the finder (a named recipient is the most common intent) and
// the scope picker. Nothing else — in particular there is deliberately NO KPI strip, because
// every figure it carried is now the metric on the tile whose page owns it, and printing the
// same four numbers twice on one screen is how two copies start disagreeing.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// EVERY TILE METRIC IS READ FROM THE SOURCE ITS OWN DESTINATION RENDERS. That is the rule this
// file exists to keep, and it is not automatic — two of the thirteen would have been wrong if
// the plan's literals had been copied in:
//
//   • the municipal tile: the plan said €4.56bn / 2025; `budget_muni_transfer` has since moved
//     to €4.93bn / 2026. A literal would have been stale on the day it shipped.
//   • the rail tile: the plan said €447.2m for 2026 — the newest row in rail_subsidy.json.
//     /sector/transport anchors instead on the newest year that HAS a ridership figure, so it
//     can state a per-passenger number, and shows €443.1m for 2025. Same four components,
//     different year. The hub follows the destination and reads `useRailSubsidy` rather than
//     the file, because a reader who clicks and sees a different number learns that one of the
//     two pages is lying and cannot tell which. (Verified live: the tile there reads
//     „€443,1 млн. · 2025" and „5,55 € на пътник", which is exactly what this hub prints.)
//
// Bands 1, 2 and 4 come from ONE call (`agri_hub_stats`, migration 162) — the same call the
// seven sub-pages make, so a tile cannot announce a figure its page disagrees with. Band 3 adds
// three small fetches (rail 2.9 KB, culture overview 7.3 KB, and the municipal arm which rides
// free inside the hub blob's `crossStream`); the party figure is two constants and no fetch.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// Copies the homepage shell (no max-width cap); tiles, never tabs.
//
// ⚠️ TWO CONVENTIONS IN ONE FILE, deliberately and temporarily. The tile CAPTIONS go through
// `t()` (43 keys landed with this step, because the registry names them and a missing key
// renders as its own literal). Everything else — the metric secondaries, both empty-state
// cards, the source footer, the page title — is still an inline `bg ? … : …`. Plan step 8 is
// the pass that converts them, and it converts the whole module at once so the BG is written
// as BG rather than as a translation of the EN sibling. Until then, prefer adding a key over
// adding a ternary.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange } from "lucide-react";
import {
  TileHubGrid,
  HubHead,
  type HubKpi,
  type TileHubSection,
} from "@/ux/infographic";
import {
  useAgriHubStats,
  type AgriHubStats,
} from "@/data/agri/useAgriHubStats";
import { AGRI_FINANCIAL_YEARS, agriScopeToKey } from "@/data/agri/constants";
import {
  subsidiesHubKpis,
  subsidiesHubEvidence,
  subsidiesWindow,
  promotedTiles,
} from "@/screens/subsidies/subsidiesHubFigures";
import { agriLabel, numberLocale } from "@/data/agri/labels";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { scopeYear } from "@/data/scope/useScope";
import { ScopeControl } from "./components/ScopeControl";
import { GovernanceBreadcrumb } from "./components/GovernanceBreadcrumb";
import { SubsidiesSearchBox } from "./SubsidiesSearchBox";
import { useAgriScope } from "@/data/agri/useAgriScope";
import { AgriScopeFallback } from "./subsidies/AgriScopeGate";
import { SUBSIDIES_BANDS } from "./subsidies/subsidiesRegistry";
import { SUBSIDIES_SCENES } from "./subsidies/subsidiesScenes";
import { useRailSubsidy } from "@/data/procurement/useRailSubsidy";
import { useCultureOverview } from "@/data/culture/useCulture";
import { FIRST_POSSIBLE_YEAR } from "./subsidies/SubsidiesCoverageScreen";
import {
  PARTY_SUBSIDY_VOTES,
  PARTY_SUBSIDY_RATE_EUR,
  PARTY_SUBSIDY_SINCE,
} from "@/lib/bgTaxPolicy";

/** The three band-3 figures that are not in the hub blob. Each is `null` until its own source
 *  arrives, and a null renders a tile with no metric rather than a zero. */
interface Band3 {
  railTotalEur: number | null;
  railYear: number | null;
  railPerPassenger: number | null;
  filmEur: number | null;
  filmCount: number | null;
  filmFirstYear: number | null;
  filmLastYear: number | null;
}

type Metric = {
  metric: string;
  metricCaption: string;
  metricSecondary?: string;
};

const tileMetric = (
  id: string,
  s: AgriHubStats | null | undefined,
  b3: Band3,
  lang: string,
  bg: boolean,
  t: (k: string, o?: Record<string, unknown>) => string,
  /** The band took this tile's HEADLINE figure (§3.1 rule 5). The tile then shows its
   *  SECOND figure instead of nothing — blanking the whole `Metric` removed three numbers
   *  the band never carried, and one of them (`entityEurExPayer`) is the denominator the
   *  „към топ 100" cell's own basis names, so the head stated a share of a quantity the
   *  page no longer printed anywhere. Handled per case because each secondary needs its
   *  own caption: promoting it under the headline's caption would mislabel it. */
  demoted = false,
): Metric | undefined => {
  const nloc = numberLocale(bg);
  const int = (n: number | null | undefined) =>
    n == null ? null : formatInt(n, lang);
  const eur = (n: number | null | undefined) =>
    n == null ? null : formatEurCompact(n, lang);
  // A DECIMAL COMMA in Bulgarian. `${49.3}%` renders „49.3%" whatever the page language is,
  // which is the one formatting slip a template literal makes silently.
  const pct = (n: number | null | undefined) =>
    n == null
      ? null
      : `${new Intl.NumberFormat(nloc, { maximumFractionDigits: 1 }).format(n)}%`;
  const m = (
    metric: string | null,
    metricCaption: string,
    metricSecondary?: string | null,
  ): Metric | undefined =>
    metric
      ? {
          metric,
          metricCaption,
          ...(metricSecondary ? { metricSecondary } : {}),
        }
      : undefined;

  switch (id) {
    // ── Band 1 ───────────────────────────────────────────────────────────────
    case "recipients":
      // EX-PAYER, like the page. ДФЗ's own ЕИК appears in the corpus as a recipient of
      // technical-assistance money; counting the paying agency among the recipients it pays
      // would put it at the top of its own ranking.
      return demoted
        ? m(
            eur(s?.entityEurExPayer),
            bg ? "към фирми с ЕИК" : "to companies with an EIK",
          )
        : m(
            int(s?.entityCountExPayer),
            t("subsidies_m_firms"),
            eur(s?.entityEurExPayer),
          );
    case "schemes":
      // The second figure NAMES the scheme. A bare „€382,7 млн" under „281 схеми" reads as the
      // money across all 281 — which is €1.59bn, a 4.2x understatement. `metricSecondary`'s own
      // doc says to pass a composed phrase, and every sibling tile here does.
      //
      // The label is truncated to its CODE. The full 2025 spelling is „I.А.1-1 oсновно
      // подпомагане на доходите за устойчивост" and the slot is `max-w-[13rem] truncate`, so the
      // prose would be cut mid-word anyway; the code is what the destination's own rows are
      // keyed on, so it is the half a reader can act on.
      return m(
        int(s?.schemeCount),
        t("subsidies_m_schemes"),
        s?.topSchemeEur != null && s?.topScheme
          ? `${bg ? "най-голяма" : "largest"}: ${s.topScheme.split(/\s+/)[0]} ${eur(s.topSchemeEur)}`
          : null,
      );
    case "places":
      // The LARGEST province's money, captioned with its name — not the corpus total, which
      // belongs to no place and is already the recipients tile's second figure.
      //
      // ⚠️ „ПО СЕДАЛИЩЕ" IS NOT DECORATION. ДФЗ publishes the RECIPIENT's oblast, so a company
      // registered in Sofia and farming in Добрич counts as Sofia — and at the default scope
      // the top oblast IS „София (столица)" at €128m. Without the qualifier the module's front
      // page opens by stating that the capital receives the most farm subsidy. The destination
      // says „по област на получателя" in six places; the tile that sends readers there cannot
      // be the one surface that drops it.
      return m(
        eur(s?.topOblastEur),
        s?.topOblast
          ? `${s.topOblast} · ${bg ? "по седалище" : "by seat"}`
          : t("subsidies_m_top_oblast"),
        s?.oblastCount != null
          ? `${int(s.oblastCount)} ${bg ? "области" : "provinces"}`
          : null,
      );
    case "untraceable":
      // Demoted, the money IS the figure and the existing caption still fits it.
      return demoted
        ? m(eur(s?.noEikEur), t("subsidies_m_no_eik"))
        : m(
            pct(s?.noEikPctOfTotalEur),
            t("subsidies_m_no_eik"),
            eur(s?.noEikEur),
          );

    // ── Band 2 ───────────────────────────────────────────────────────────────
    case "concentration":
      // OF LEGAL-ENTITY money, which is the basis the page uses and roughly double the
      // share-of-everything figure. The key names its basis for exactly this reason.
      return demoted
        ? m(
            pct(s?.top1000PctOfEntityEur),
            bg ? "за топ 1000" : "to the top 1000",
          )
        : m(
            pct(s?.top100PctOfEntityEur),
            t("subsidies_m_top100"),
            s?.top1000PctOfEntityEur != null
              ? `${pct(s.top1000PctOfEntityEur)} ${bg ? "за топ 1000" : "to the top 1000"}`
              : null,
          );
    case "political":
      // NULL, never 0, when the person layer had not been resolved when the cache was built —
      // „0 свързани фирми" is a claim, and an unbuilt basis cannot support it.
      return s?.politicalBasisBuilt
        ? m(int(s.politicalEiks), t("subsidies_m_linked"), eur(s.politicalEur))
        : undefined;
    case "crossProgramme":
      return m(
        int(s?.isunEiks),
        t("subsidies_m_also_isun"),
        s?.contractEiks != null
          ? `${int(s.contractEiks)} ${bg ? "и с поръчки" : "also with contracts"}`
          : null,
      );

    // ── Band 3 — annual, each names its year in the caption ───────────────────
    case "municipal":
      return m(
        eur(s?.crossStream.muniTransferEur),
        `${bg ? "трансфери" : "transfers"}, ${s?.crossStream.muniTransferYear ?? ""}`.trim(),
        s?.crossStream.muniCount != null
          ? `${int(s.crossStream.muniCount)} ${bg ? "общини" : "municipalities"}`
          : null,
      );
    case "rail":
      return m(
        eur(b3.railTotalEur),
        `${bg ? "за железници" : "for the railways"}, ${b3.railYear ?? ""}`.trim(),
        b3.railPerPassenger != null
          ? `${b3.railPerPassenger.toLocaleString(nloc, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} € ${bg ? "на пътник" : "per passenger"}`
          : null,
      );
    case "film":
      return m(
        eur(b3.filmEur),
        b3.filmFirstYear && b3.filmLastYear
          ? b3.filmFirstYear === b3.filmLastYear
            ? `НФЦ, ${b3.filmFirstYear}`
            : `НФЦ, ${b3.filmFirstYear}–${b3.filmLastYear}`
          : "НФЦ",
        b3.filmCount != null
          ? `${int(b3.filmCount)} ${bg ? "филма" : "films"}`
          : null,
      );
    case "party":
      // ⚠️ THE TWO CONSTANTS, never a division of the budget envelope. ЗДБРБ-2026 чл. 13 ал. 4
      // states „до 8 964,3 хил. евро", but чл. 63 sets TWO rates inside the one year (€4.09
      // to 29.04, €3.00 from 30.04) over TWO vote bases, because the 19.04 election changed
      // it — so 8 964 300 ÷ 3.00 = 2 988 100 is a vote count from no election that ever
      // happened. bgTaxPolicy.ts carries the same warning at the constants themselves.
      return m(
        eur(PARTY_SUBSIDY_VOTES * PARTY_SUBSIDY_RATE_EUR),
        // DATED, like its three band-3 siblings — and here the date carries more weight than
        // elsewhere, because BOTH inputs moved inside 2026 (the rate on 30.04, the vote base at
        // the 19.04 election). An undated €9.31m is a run-rate that no calendar year equals.
        `${bg ? "годишно по ЗПП, от" : "a year under the ЗПП, since"} ${PARTY_SUBSIDY_SINCE}`,
        // The RATE from the constant, not spelled out. The metric above is
        // votes x PARTY_SUBSIDY_RATE_EUR, so a literal „3,00 €" here is a second copy of a
        // number that already moved once inside 2026 (€4.09 → €3.00 on 30.04) — the two
        // halves of one tile would then disagree by construction at the next change.
        `${int(PARTY_SUBSIDY_VOTES)} ${bg ? "гласа" : "votes"} × ${PARTY_SUBSIDY_RATE_EUR.toLocaleString(
          nloc,
          { style: "currency", currency: "EUR", minimumFractionDigits: 2 },
        )}`,
      );

    // ── Band 4 ───────────────────────────────────────────────────────────────
    case "browse":
      // BOTH halves on the same scope. `paymentRows` is scope-keyed, so pairing it with the
      // constant „8 финансови години" said the corpus holds 230,214 payments across 8 years —
      // it holds 2,481,857. Only `all` (scopeYear null) makes that pairing true, and that is
      // the branch that keeps it.
      return m(
        int(s?.paymentRows),
        t("subsidies_m_payments"),
        s?.scopeYear != null
          ? `${bg ? "финансова година" : "financial year"} ${s.scopeYear}`
          : `${AGRI_FINANCIAL_YEARS.length} ${bg ? "финансови години" : "financial years"}`,
      );
    case "coverage": {
      // A COUNT OF YEARS, and the caption gives the denominator. „8" alone reads as a total of
      // something; the page's entire subject is that four years are absent.
      //
      // Both the denominator and the gap list are DERIVED from the same floor
      // /subsidies/coverage uses. Hardcoded („от 12 години", „2014 и 2018–2020 липсват") they
      // would go stale at a 200 the day ДФЗ publishes 2026 — the tile would read „9 от 12"
      // while the page it links to said 9 of 13.
      const span = AGRI_FINANCIAL_YEARS[0] - FIRST_POSSIBLE_YEAR + 1;
      const missing = Array.from(
        { length: span },
        (_, i) => FIRST_POSSIBLE_YEAR + i,
      ).filter((y) => !AGRI_FINANCIAL_YEARS.includes(y));
      return m(
        String(AGRI_FINANCIAL_YEARS.length),
        t("subsidies_m_years_covered", { count: span }),
        missing.length
          ? `${missing.join(", ")} ${bg ? "липсват" : "missing"}`
          : null,
      );
    }
    default:
      return undefined;
  }
};

export const SubsidiesDashboardScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  // Same time-scope machinery as the procurement pages: the `?pscope` URL param
  // (ns | all | y:YYYY), carried between the section and its sub-pages by
  // useScopedHref. Subsidies has no per-parliament slice, so "ns" resolves
  // to the latest financial year (the pill is relabelled accordingly).
  //
  // Read UNRESOLVED (no ScopeSupport), which is the second of the two contracts
  // in ScopeControl's header: this page answers a year it cannot serve with an
  // explicit "no data for this year", so the reader keeps seeing the year they
  // asked for in the pill instead of being silently moved to another one.
  // THE SHARED GATE, exactly as the seven sub-pages use it. This screen carried its own copy
  // of the four-state machine — ~55 lines including the empty-state copy — and the two had
  // already drifted: this one said „ДФЗ публикува следните финансови години" while
  // AgriScopeGate says „…публикува ДАННИ ЗА следните…" beside a comment explaining why the
  // second is the correct sentence (the Fund publishes payments FOR a financial year; it does
  // not publish the year). Two copies of a state machine is how one of them ends up wrong.
  const gate = useAgriScope();
  const { scope, data } = gate;
  const payloadKey = agriScopeToKey(scope);
  const { data: hub } = useAgriHubStats(payloadKey);

  /** The head's four figures — see `subsidiesHubFigures.ts` for why every caption is built
   *  from the same blob that carried its number. */
  const kpis: HubKpi[] = useMemo(
    () => subsidiesHubKpis(hub, AGRI_FINANCIAL_YEARS, L, bg, t),
    [hub, L, bg, t],
  );
  // ⚠️ Derived from the cells that RENDERED, never a constant list: this blob withholds a
  // figure rather than publishing a zero, so a cell can legitimately be absent and blanking
  // its tile anyway would take the number off the page entirely.
  // ⚠️ MEMOIZED. `promotedTiles` returns a new Set, and this value is a dependency of the
  // `sections` memo below — un-memoized it churns identity every render and rebuilds all 13
  // tiles (5 `t()` calls each plus scene lookups), which is exactly the work that memo
  // exists to avoid. /consumption gets away with the bare call only because its `sections`
  // is a plain array literal.
  const promoted = useMemo(() => promotedTiles(kpis), [kpis]);

  /** The largest recipients, by name — from the overview payload the scope gate already
   *  holds, so the aside costs no extra fetch. See `subsidiesHubEvidence` for why its
   *  caption has to disclaim the untraceable half. */
  const evidence = useMemo(
    () =>
      hub
        ? subsidiesHubEvidence(
            data?.topRecipients,
            hub.noEikPctOfTotalEur,
            subsidiesWindow(hub, AGRI_FINANCIAL_YEARS, L, t),
            L,
            bg,
            t,
          )
        : undefined,
    [hub, data?.topRecipients, L, bg, t],
  );

  // Band 3's two fetched sources. Both are small and both are ANNUAL — they do not take the
  // scope, and their tiles say which year they are for.
  const rail = useRailSubsidy();
  const { data: culture } = useCultureOverview();
  // The year /culture would land on for the scope this hub is carrying. `null` (the `ns`
  // and `all` scopes) means all years there too — CLAUDE.md's URL contract records that
  // /culture relabels `ns` as „Всички години".
  const cultureYear = scopeYear(scope);
  const band3: Band3 = useMemo(
    () => ({
      // The HOOK'S OWN `total`, not a re-derivation. `latest` is the newest year with a
      // ridership figure (2025, not the 2026 budget row) and the hook already sums PSO + НКЖИ
      // (operating AND capital) + БДЖ capital. The first draft of this file re-added those
      // three by hand and got a figure €109m lower by mis-modelling `nkzhi`; the second still
      // re-added them, which differs on an all-null year — the hook yields `null`, a hand sum
      // yields `0`, and `m()` treats „€0" as a real metric, printing „the state pays nothing
      // for the railway" where the destination prints nothing at all.
      railTotalEur: rail.latest?.total ?? null,
      railYear: rail.latest?.year ?? null,
      railPerPassenger: rail.latest?.perPassenger ?? null,
      // SCOPED THE WAY /culture SCOPES IT, which is the metric rule applied to the one
      // band-3 tile that could break it. InfographicTile carries `?pscope` forward and
      // CultureScreen does `useScope({years: cultureYears, allowAll: false})` and then
      // re-aggregates to that year — so an unscoped tile said „€94,9 млн · 944 филма" and
      // the page it opened said „€8,24 млн · 84" on eight of the ten scopes.
      //
      // Read from `overview.byYear`, NOT via scopeCultureOverview: that helper needs the
      // 285 KB film corpus, which is most of the payload this whole rework removed from the
      // hub. Verified equal for all twelve years — byYear IS the same aggregation, done
      // offline. When the scope resolves outside the register's span the all-years figure
      // stands, exactly as the helper's own fallback does.
      ...(() => {
        const y = culture?.byYear.find((r) => r.year === cultureYear);
        return {
          filmEur: y ? y.eur : (culture?.totalEur ?? null),
          filmCount: y ? y.count : (culture?.filmCount ?? null),
          filmFirstYear: y ? y.year : (culture?.firstYear ?? null),
          filmLastYear: y ? y.year : (culture?.lastYear ?? null),
        };
      })(),
    }),
    [rail.latest, culture, cultureYear],
  );

  const sections: TileHubSection[] = useMemo(
    () =>
      SUBSIDIES_BANDS.map((band) => ({
        heading: t(band.labelKey),
        description: t(band.descKey),
        tiles: band.tiles.map((tile) => ({
          to: tile.to,
          title: t(tile.titleKey),
          desc: t(tile.descKey),
          accent: tile.accent,
          scene: SUBSIDIES_SCENES[tile.id],
          // NO `cta`. „разгледай →" on every tile restates an affordance the card already has.
          //
          // ⚠️ §3.1 rule 5 — a figure is never in the band AND on a tile. Resolved by
          // demoting the TILE, which is the rule's own remedy: the band is where a figure
          // gets a stated basis, and on this page the basis is the whole difficulty (the
          // scope moves every number by up to 7×). A tile caption has no room for it.
          ...(tileMetric(
            tile.id,
            hub,
            band3,
            L,
            bg,
            t,
            promoted.has(tile.id),
          ) ?? {}),
        })),
      })),
    [t, hub, band3, L, bg, promoted],
  );

  // ⚠️ THE GATE WATCHES THE OVERVIEW PAYLOAD, NOT THE FIGURES. Every band-1/2/4 metric comes
  // from `useAgriHubStats`, which `AgriScopeFallback` never sees — so if /api/db/agri-hub-stats
  // 500s, or migration 162 has not reached the target and its matview raises 55000, the hook
  // returns `null` and the page renders the COMPLETE tile grid with no number on any of the
  // nine in-corpus tiles, indefinitely, with no message and nothing in the console.
  //
  // Deliberately NOT folded into the gate: the grid is still worth showing — every tile is a
  // working link and band 3 still has its figures — so blanking the page would be the larger
  // loss. It gets a line above the grid instead, and the tiles degrade to no-metric on their own.
  const hubFailed = hub === null && payloadKey !== null;
  // „Субсидии", not „Земеделски субсидии". The module widened at step 7: band 3 fronts the
  // municipal transfers, the railway subsidy, НФЦ film money and the ЗПП party envelope, so a
  // page headed „Земеделски" would be naming a quarter of its own tiles out of existence.
  // The farm corpus is still the bulk — 9 of 13 tiles — and band 1's own description says so
  // („Земеделските субсидии на ДФ „Земеделие" — по получател, схема и област…"), which is
  // where that scoping belongs: on the band, not on the page.
  //
  // The PRERENDERED title keeps „земеделски субсидии" at the front regardless — see the note
  // on the staticPage entry. That is the one surface where the specific term is worth more
  // than the accurate one, because it is the phrase people type.
  const title = bg ? "Субсидии" : "Subsidies";
  const description =
    "Bulgarian public subsidies: CAP farm money from the State Fund Agriculture by scheme, region, year and recipient — plus municipal transfers, the railway subsidy, film funding and the party envelope.";

  return (
    <>
      {/* `HubHead` renders the h1 AND the SEO tags, so `<Title>` is gone — a second
          <h1> is what the pattern's rendered gate exists to catch.

          ⚠️ THE BAND IS INSIDE THE HEAD AND THE SCOPE CONTROL IS ITS SLOT, which is the
          whole point on this page: every figure in the band moves by up to 7× with the
          scope (€1.59bn on the default year against €11.04bn all-time), so the control that
          changes them has to sit beside them rather than below a title. */}
      {/* GovernanceBreadcrumb, not SectorBreadcrumb — plan §7a.
          SectorBreadcrumb's trail is a FIXED „Управление › Обществени поръчки ›
          Държавни сектори › X", and all three levels were wrong here:

            • /subsidies is NOT in the sector registry (verified: zero matches for
              `/subsidies` in src/screens/governance/sectorRegistry.ts), so
              „Държавни сектори" named a parent that does not contain this page.
              Following it landed the reader on a hub whose agriculture tile goes to
              /sector/agri — a different page, about ДФЗ as a procurement BUYER
              rather than as the agency paying the subsidies out.
            • „Обществени поръчки" asserted that CAP subsidies are procurement. They
              are the opposite leg of the money map: no tender, no contract.
            • it has no section slot at all, so every sub-page below would have
              rendered „… › Държавни сектори › По област" and lost the one crumb a
              sub-page actually needs — the link back to this hub.

          The governance hub's money band, the header menu and governanceRegistry's
          own comment all already call this „a whole money vertical"; only the crumb
          disagreed. /budget and /funds use exactly this component. */}
      <GovernanceBreadcrumb sectionKey="subsidies_nav" sectionTo="/subsidies" />

      <HubHead
        eyebrow={t("subsidies_head_eyebrow")}
        title={title}
        seoDescription={description}
        // ⚠️ NOT „по Общата селскостопанска политика". The title note forty lines up
        // argues the h1 must stay „Субсидии" because band 3 fronts the municipal
        // transfers, the railway, НФЦ film money and the ЗПП party envelope — a quarter of
        // the page's own tiles. A deck naming only CAP does exactly what the title was
        // forbidden from doing, and the deck is the sentence a human reads.
        deck={t("subsidies_hub_deck")}
        scope={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
              <CalendarRange className="h-3.5 w-3.5" />
              {agriLabel.scope(bg)}
            </span>
            <ScopeControl
              years={AGRI_FINANCIAL_YEARS}
              nsLabelOverride={agriLabel.latestYear(bg)}
            />
          </div>
        }
        search={<SubsidiesSearchBox noEikPct={hub?.noEikPctOfTotalEur} />}
        kpis={kpis}
        // ⚠️ `kpisPending` RESERVES HEIGHT WHILE FIGURES ARE IN FLIGHT — it is not a default.
        // On this page the query can be permanently disabled: `agriScopeToKey` returns null
        // for a year the CAP corpus does not cover, so `useAgriHubStats` never runs and
        // `data` stays `undefined` for ever. Passed unconditionally, `?pscope=y:2019` stood
        // four skeleton cells that would never resolve DIRECTLY ABOVE the card saying „Няма
        // данни за субсидии за 2019" — measured, 12 pulse nodes inside the head. That is
        // verbatim the bug this screen's test file says it was written for. A route failure
        // (`hub === null`) is the same class, above the amber „не се заредиха" banner.
        //
        // The siblings pass it unconditionally and are right to: none of them has a scope
        // that can legitimately be un-servable.
        kpisPending={payloadKey !== null && hub === undefined ? 4 : undefined}
        kpiNote={kpis.length ? t("subsidies_kpi_note") : undefined}
        evidence={evidence}
      />

      {/* The skeleton is one block rather than four cards: the grid it stands in for is
          thirteen tiles, so four card-shaped pulses would misdescribe what is coming. */}
      <AgriScopeFallback
        gate={gate}
        loadingClassName="my-4 h-[560px] animate-pulse rounded-xl border bg-card shadow-sm"
      >
        <section
          aria-label={title}
          className="my-4"
          // ⚠️ THE OG CAPTURE'S ANCHOR. The old screen carried `data-og="subsidies-hero"` on
          // its KPI grid and `scripts/og/capture-screens.ts` still waits for that selector, so
          // removing it without a replacement left `capture-screens.ts subsidies` waiting for
          // an element that can never appear — a hang, not a failure, with the stale card
          // depicting the deleted dashboard still on disk and no coverage gate firing.
          //
          // Step 10 repointed that entry at `subsidies-hub` and re-shot. It kept the shared
          // 1280 viewport AGAINST the plan's sub-1280 advice: the bands are sized 4/3/4/2 for
          // the xl four-column grid, so three columns strand band 1's fourth tile and leave
          // the card a third empty. `main{max-width:1216px}` makes the four columns fit the
          // 1200 crop exactly instead — measured, the tile borders land on 0 and 1199.5.
          data-og="subsidies-hub"
        >
          {hubFailed && (
            <p className="mb-4 rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-sm text-muted-foreground dark:border-amber-800/50 dark:bg-amber-950/20">
              {bg
                ? "Числата по плочките не се заредиха — самите страници работят."
                : "The tile figures failed to load — the pages themselves still work."}
            </p>
          )}
          <TileHubGrid sections={sections} />
          {/* The source line stays on the hub even though the analysis has moved off it: this
              is the page a reader lands on, and „where is this from" is answered here or not
              at all. `generatedFrom` is the payload's own provenance string, so it moves with
              the corpus rather than being restated. */}
          {/* `data` is non-null inside AgriScopeFallback — it renders children only in the
              `ready` state — but that is a runtime guarantee the type system cannot see. */}
          {data && (
            <p className="mt-6 text-xs text-muted-foreground">
              {t("data_source")}: {data.generatedFrom}
              {data.scopeYear
                ? ` · ${bg ? "финансова година" : "financial year"} ${data.scopeYear}`
                : ""}{" "}
              ·{" "}
              {bg
                ? `общо изплатено ${formatEurCompact(data.headline.totalEur, L)}`
                : `total paid ${formatEurCompact(data.headline.totalEur, L)}`}
            </p>
          )}
        </section>
      </AgriScopeFallback>
    </>
  );
};
