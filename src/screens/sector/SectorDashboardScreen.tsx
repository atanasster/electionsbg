// /sector/:id — the generic sector dashboard. Gives every state sector a proper
// landing page (not a deep-link into one institution's awarder page): a group
// KPI overview rolled up over the sector's awarder EIK-set, an optional bespoke
// thematic-tiles slot, and the SectorAwardersTile listing the member
// institutions — each deep-linking to its own /awarder/:eik page.
//
// The anatomy mirrors WaterScreen (breadcrumb up to the sectors hub + the shared
// ?pscope control + tiles), but this shell is config-driven (SECTOR_DASHBOARDS)
// so a sector graduates by adding config, not a bespoke screen.

import { FC, Suspense, useCallback, useMemo } from "react";
import {
  useParams,
  Navigate,
  Link,
  useSearchParams,
  type To,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Title } from "@/ux/Title";
import { Card, CardContent } from "@/ux/Card";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { ScopeControl } from "@/screens/components/ScopeControl";
import {
  getSectorPack,
  getSectorBrowsePack,
} from "@/screens/components/procurement/sectorPacks";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { useAwarderGroupModel } from "@/data/procurement/useAwarderGroupModel";
import {
  buildAwarderModelFromAggregates,
  type GroupModelPayload,
  type SectorClassifier,
} from "@/lib/awarderModel";
import { formatEurCompact } from "@/lib/currency";
import { isConsortiumSupplier } from "@/lib/companyKey";
import {
  getSectorDashboard,
  sectorMemberEiks,
  type SectorDashboardConfig,
} from "./sectorDashboards";
import { SectorAwardersTile } from "./SectorAwardersTile";
import { SectorMembersSearch } from "./SectorMembersSearch";
import { MEMBER_SEARCH_MIN } from "./membersIndex";
import {
  SectorSpendByYearTile,
  SectorTopContractorsTile,
} from "./SectorCharts";
import { SECTORS_HUB_PATH } from "@/screens/components/procurement/SectorBreadcrumb";

// The generic dashboard needs headline money/competition, not a CPV taxonomy —
// fold every contract into one bucket.
const GENERIC_CLASSIFIER: SectorClassifier<"all"> = {
  categoryOf: () => "all",
};

/** The buy-side drill-down for a PACK-backed sector.
 *
 *  A pack IS the page — the branch below skips the KPI row, the top-contractors
 *  tile and the `/procurement/contracts?sector=` link that every non-pack sector
 *  gets from its KPI cards. (The awarders tile is NOT among them: it renders for
 *  every sector, outside this branch.) For the two collector packs
 *  that left the page with no route to the buy-side at all, while the hub tile
 *  promised „договори": Митници alone is €262.0M over 1,222 contracts, reachable
 *  only by typing the browse URL. Audit 2026-08-19 F3.
 *
 *  A LINK, not the KPI row: the row needs useAwarderGroupModel, which the pack
 *  branch disables (`enabled: !Pack`), so restoring it would add a group-model
 *  fetch to all twelve pack-backed sector pages to render four numbers the pack
 *  deliberately reframes. This costs nothing and makes the caption true. */
// Exported for SectorDashboardScreen.test.tsx only. A source scan can prove the
// link is wired into the right branch; only a render can prove the copy branches
// the right way — an inverted `single` names one institution over a table of 74
// buyers, which is a wrong claim rather than a layout slip.
export const PackContractsLink: FC<{
  to: To;
  /** The lead's own name — used ONLY on a single-member sector. */
  name: string;
  /** How many awarders the destination actually covers. */
  memberN: number;
  bg: boolean;
}> = ({ to, name, memberN, bg }) => {
  // ⚠ Name the LEAD only when it IS the whole set. `?sector=` filters the browse
  // table by the sector's entire EIK roster — 73 directorates for МВР, 11 bodies
  // for МТС — so „Обществените поръчки на МВР" over a table holding 72 other
  // buyers is a wrong claim about whose contracts the reader is looking at.
  const single = memberN === 1;
  return (
    <Link to={to} className="block">
      <Card className="transition-colors hover:border-primary/50">
        <CardContent className="flex items-center justify-between gap-3 p-3 md:p-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {single
                ? bg
                  ? `Обществените поръчки на ${name}`
                  : `Public contracts of ${name}`
                : bg
                  ? "Обществените поръчки на сектора"
                  : "Public contracts in this sector"}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {single
                ? bg
                  ? "Какво купува институцията — договори, изпълнители и категории."
                  : "What the institution buys — contracts, suppliers and categories."
                : bg
                  ? `Какво купуват ${memberN} възложители — договори, изпълнители и категории.`
                  : `What ${memberN} awarders buy — contracts, suppliers and categories.`}
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
};

const KpiCard: FC<{
  label: string;
  value: string;
  sub?: string;
  /** A short qualifier on `sub` — „в групата" / „консорциум" / „държавно". Kept
   *  OUT of `sub` on purpose: the row is `grid-cols-2` until `md`, so on a ~375px
   *  viewport the sub-label truncates, and appended to the end of one truncating
   *  string the qualifier is what gets dropped while the company name survives —
   *  i.e. „Столична община · държавно" renders as „Столична община", the exact
   *  reading the label exists to prevent. As a `shrink-0` sibling the NAME yields
   *  first, which is the priority SectorCharts.tsx's chip already uses. */
  tag?: string;
  /** Hover text for `tag`. The KPI carries no footnote of its own — the tile's
   *  note only renders when the tile does (≥2 suppliers) — so the qualifier has
   *  to explain itself wherever it appears. Pass the tile's own chip `title` so
   *  the two cannot drift. */
  tagTitle?: string;
  /** When set, the whole tile is a drill-down link. */
  to?: To;
}> = ({ label, value, sub, tag, tagTitle, to }) => {
  const body = (
    <CardContent className="p-3 md:p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {(sub || tag) && (
        <div className="mt-0.5 flex items-baseline gap-1 text-xs text-muted-foreground">
          {sub && <span className="min-w-0 truncate">{sub}</span>}
          {tag && (
            <span className="shrink-0" title={tagTitle}>
              · {tag}
            </span>
          )}
        </div>
      )}
    </CardContent>
  );
  return to ? (
    <Link to={to} className="block h-full">
      <Card className="h-full transition-colors hover:border-primary/50">
        {body}
      </Card>
    </Link>
  ) : (
    <Card className="h-full">{body}</Card>
  );
};

const Dashboard: FC<{ config: SectorDashboardConfig }> = ({ config }) => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const [params] = useSearchParams();

  // The sector's domain-specific pack (e.g. the НЗОК hospital-payments hero, the
  // roads km/delivery tiles) — the disbursement/delivery substance that used to
  // sit on the awarder page. When present it IS the dashboard's content, so the
  // generic ЗОП KPI row + top-contractors/by-year charts are skipped (the pack
  // leads with its own, richer framing) and the group-model fetch is disabled.
  const scopeWindow = useScopeWindow();
  // A registered pack normally IS the page, and disables the group model below.
  // `packIsThematic` says this one only illustrates the sector, so the generic
  // group dashboard runs and the pack drops to the thematic slot instead.
  const registeredPack = getSectorPack(config.leadEik);
  const Pack = config.packIsThematic ? null : registeredPack;
  const ThematicPack = config.packIsThematic ? registeredPack : null;

  const eiks = useMemo(() => sectorMemberEiks(config), [config]);
  const build = useCallback(
    (p: GroupModelPayload) =>
      buildAwarderModelFromAggregates(p, GENERIC_CLASSIFIER),
    [],
  );
  const { model, byUnit, isLoading } = useAwarderGroupModel(
    eiks,
    build,
    undefined,
    !Pack,
  );

  const top = model?.suppliers[0] ?? null;
  const awarderN = byUnit.filter((u) => (u.totalEur ?? 0) > 0).length;
  // The „Топ изпълнител" KPI names the top row, and the top row can be a public
  // body — on /sector/tourism's default scope it is Столична община. The
  // leaderboard tile below badges it; the KPI is the bigger number and is read
  // first, so it carries the same qualifier or the two disagree about the same
  // company. Order and wording come from the tile (SectorCharts.tsx): a member
  // takes the more specific „в групата", then „консорциум" (which needs no
  // curation — `isConsortiumSupplier` reads the row itself, so every sector gets
  // it), then „държавно".
  //
  // ⚠ Two deliberate differences from the tile. The KPI shows ONE qualifier where
  // the tile can show several, so a row that is both a consortium and a state
  // body reads „консорциум" here and carries two chips there — the narrower label
  // wins, and it is never a contradiction. And this is NOT gated on the tile
  // rendering: with a single supplier the tile (and its footnote) is absent, and
  // that is precisely when an unqualified public body most reads as a private
  // vendor winning the sector, so the qualifier stays and carries its own `title`
  // instead.
  const topIsMember = !!top && eiks.includes(top.eik);
  const topIsConsortium = !!top && !topIsMember && isConsortiumSupplier(top);
  const topIsStateBody =
    !!top &&
    !topIsMember &&
    !topIsConsortium &&
    !!config.stateBodyContractors?.includes(top.eik);
  const topTag = topIsMember
    ? bg
      ? "в групата"
      : "in-group"
    : topIsConsortium
      ? bg
        ? "консорциум"
        : "consortium"
      : topIsStateBody
        ? bg
          ? "държавно"
          : "state body"
        : undefined;
  // Verbatim from the tile's chip titles, so one place defines what each means.
  const topTagTitle = topIsMember
    ? bg
      ? "Изпълнителят е от същата група — парите остават в сектора"
      : "The contractor is one of this sector's own organisations — the money stays inside it"
    : topIsConsortium
      ? bg
        ? "Няколко фирми, спечелили заедно. Сумата е на целия договор и се брои веднъж."
        : "Several firms that won together. The figure is the whole contract and is counted once."
      : topIsStateBody
        ? bg
          ? "Изпълнителят е държавна или общинска структура — трансфер вътре в държавата, не спечелен на пазара договор"
          : "The contractor is a state or municipal body — a transfer inside government, not a contract won on a market"
        : undefined;

  // KPI drill-downs. Money/contracts → the sector-filtered browse table
  // (carrying the current scope forward); contractors → the lead awarder's full
  // contractors list; top contractor → that company's page.
  const contractsSearch = new URLSearchParams(params);
  // ⚠️ A packOwnsScope pack resolves `?pscope` against ITS OWN year list and
  // never writes the resolved value back, so the raw param can name a window the
  // page above never rendered: /sector/customs?pscope=y:2019 shows 2025 (the
  // corpus is 2022-2025) while this link would ship y:2019 to a browse page that
  // accepts it. `pscope` is in the usePreserveParams allowlist, so an ordinary
  // in-app link mints that state — and both sectors that RELY on this card own
  // their scope. Their year is a fiscal/revenue year besides, not a signing year,
  // so carrying it across is not meaningful even when it resolves.
  if (config.packOwnsScope) contractsSearch.delete("pscope");
  contractsSearch.set("sector", config.browsePackId ?? config.id);
  const contractsTo: To = {
    pathname: "/procurement/contracts",
    search: `?${contractsSearch.toString()}`,
  };
  // Only single-member sectors get a contractors drill-down: the awarder page's
  // list is per-awarder, so on a multi-EIK sector (energy) it would show just the
  // lead's contractors while the KPI counts the whole group — a misleading subset.
  const contractorsTo: To | undefined =
    config.members.length === 1
      ? `/awarder/${config.leadEik}/contractors`
      : undefined;
  const topContractorTo: To | undefined = top
    ? `/company/${top.eik}`
    : undefined;
  // The lead's own name for the buy-side link. `members` is lead-first by
  // convention, but resolve by EIK rather than trusting index 0 — a roster edit
  // that reorders it would otherwise put another body's name on this link.
  const lead =
    config.members.find((m) => m.eik === config.leadEik) ?? config.members[0];
  const leadName = lead ? (bg ? lead.name.bg : lead.name.en) : config.agency;
  // …and the COUNT comes from the destination, not from this page. The caption is
  // a claim about what the browse table holds, and `?sector=` filters on the
  // BROWSE pack's EIK set, which is a different array from `members` — they
  // diverge already in this registry (administration 1 vs 3, energy 10 vs 11).
  // Getting it from `members` would let a single-member config name its lead over
  // a table of three other buyers, which is the claim the branch exists to avoid.
  const browseEikN =
    getSectorBrowsePack(config.browsePackId ?? config.id)?.eiks.length ??
    config.members.length;
  const ThematicTiles = config.ThematicTiles;
  const SearchBox = config.SearchBox;
  // Each chart tile is built ONCE and then placed, so the branch below decides
  // LAYOUT only — a lone survivor (spend-by-year needs ≥2 years, absent on a
  // narrow scope) spans full width instead of leaving an empty grid half.
  //
  // ⚠ Build once, do not inline them into both arms. A per-arm copy of the prop
  // list is how a prop reaches one layout and not the other: `stateBodyEiks`
  // shipped in both copies but only the fallback arm was covered, and the grid
  // arm — which every sector with ≥2 years of spend renders, i.e. the one readers
  // actually see — could have lost it with the whole suite green.
  const spendTile =
    (model?.years.filter((y) => y.totalEur > 0).length ?? 0) >= 2 && model ? (
      <SectorSpendByYearTile model={model} />
    ) : null;
  const topTile =
    (model?.suppliers.length ?? 0) >= 2 && model ? (
      <SectorTopContractorsTile
        model={model}
        memberEiks={eiks}
        stateBodyEiks={config.stateBodyContractors}
      />
    ) : null;

  return (
    <div className="space-y-4" id="sector-dashboard">
      <Title description={t(config.descKey)}>{t(config.titleKey)}</Title>

      <SectorBreadcrumb currentKey={config.titleKey} />

      {/* A pack that owns its own scope renders the control itself, against a
          year list only its query knows (see SectorDashboardConfig.packOwnsScope).
          Rendering one here too would put a second, URL-backed picker above
          content that answers to the first — which is the state this replaced:
          the pill read „2022" over 2025 figures. */}
      {!(Pack && config.packOwnsScope) && (
        <div className="mb-3">
          <ScopeControl mode="toggle" />
        </div>
      )}

      {/* The sector's entity finder, above the first tile. Deliberately OUTSIDE
          the Pack/KPI branch below: the box is how a reader reaches a specific
          hospital or pathway, and it must not disappear when a narrow scope
          leaves the dashboard with no contracts to show. */}
      {SearchBox ? (
        <Suspense
          fallback={
            <div className="h-24 animate-pulse rounded-xl border bg-card" />
          }
        >
          <SearchBox />
        </Suspense>
      ) : (
        // No bespoke box, but a roster long enough to be a wall of chips: give
        // the members their own finder. Auto-enabled rather than per-sector
        // config, so a sector that grows past the floor gets one for free —
        // which is the case this exists for (МВР went from a handful to 73).
        config.members.length >= MEMBER_SEARCH_MIN && (
          <SectorMembersSearch config={config} bg={bg} />
        )
      )}

      {Pack ? (
        // Pack-backed sector: the disbursement/delivery pack is the content,
        // plus the one route to the buy-side it would otherwise swallow.
        <>
          <Suspense
            fallback={
              <div className="h-[280px] animate-pulse rounded-xl border bg-card" />
            }
          >
            <Pack eik={config.leadEik} scopeWindow={scopeWindow} />
          </Suspense>
          {/* …unless the pack already routes there itself — see
              SectorDashboardConfig.packRendersOwnContractsLink. */}
          {!config.packRendersOwnContractsLink && (
            <PackContractsLink
              to={contractsTo}
              name={leadName}
              memberN={browseEikN}
              bg={bg}
            />
          )}
        </>
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[86px] animate-pulse rounded-xl border bg-card"
            />
          ))}
        </div>
      ) : model && model.totalEur > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard
              label={bg ? "Общо възложени" : "Total awarded"}
              value={formatEurCompact(model.totalEur, locale)}
              to={contractsTo}
            />
            <KpiCard
              label={bg ? "Договори" : "Contracts"}
              value={model.contractCount.toLocaleString(locale)}
              to={contractsTo}
            />
            <KpiCard
              label={bg ? "Изпълнители" : "Contractors"}
              value={model.supplierCount.toLocaleString(locale)}
              sub={
                config.members.length > 1
                  ? bg
                    ? `${awarderN} възложители`
                    : `${awarderN} awarders`
                  : undefined
              }
              to={contractorsTo}
            />
            <KpiCard
              label={bg ? "Топ изпълнител" : "Top contractor"}
              value={top ? formatEurCompact(top.totalEur, locale) : "—"}
              sub={top?.name}
              tag={topTag}
              tagTitle={topTagTitle}
              to={topContractorTo}
            />
          </div>
          {spendTile && topTile ? (
            <div className="grid gap-4 md:grid-cols-2">
              {spendTile}
              {topTile}
            </div>
          ) : (
            <>
              {spendTile}
              {topTile}
            </>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {bg
            ? "Няма договори в избрания обхват."
            : "No contracts in the selected scope."}
        </p>
      )}

      {ThematicPack && (
        <Suspense
          fallback={
            <div className="h-[280px] animate-pulse rounded-xl border bg-card" />
          }
        >
          <ThematicPack eik={config.leadEik} scopeWindow={scopeWindow} />
        </Suspense>
      )}

      {ThematicTiles && (
        <Suspense
          fallback={
            <div className="h-[200px] animate-pulse rounded-xl border bg-card" />
          }
        >
          <ThematicTiles />
        </Suspense>
      )}

      <SectorAwardersTile config={config} />
    </div>
  );
};

export const SectorDashboardScreen: FC = () => {
  const { id } = useParams<{ id: string }>();
  const config = getSectorDashboard(id);
  if (!config) return <Navigate to={SECTORS_HUB_PATH} replace />;
  // Key on id so the hooks reset cleanly when navigating sector→sector.
  return <Dashboard key={config.id} config={config} />;
};
