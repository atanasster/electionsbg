// Земеделие (ДФЗ/МЗХ) sector pack — the content of /sector/agri.
//
// ⚠ WHY IT EXISTS. The hub tile fronts Земеделие at €1.59bn („ИЗПЛАТЕНО 2025",
// basis='payout') and captions it „Субсидии · бенефициенти · САР". Before this pack
// the destination fell through to the generic contracts group model and rendered
// €2.9M over 15 contracts on the default scope — 0.18% of the sector's money, topped
// by a mobile-phone contract with А1, with the word „субсидия" appearing nowhere and
// no link to /subsidies, where the €1.59bn actually lives across nine pages. Both
// payout siblings (НОИ, НЗОК) already lead with their transfer money; agri was the
// only one that did not. See docs/plans/agri-sector-audit-v1.md §1.2-1.4.
//
// ⚠ EVERY FIGURE HERE IS ALREADY SERVED — no new ingest, no new route, no migration.
// `useAgriHubStats` (/api/db/agri-hub-stats, migration 162) and `useAgriScope`
// (agri_payloads) are the same two calls /subsidies makes.
//
// ⚠ TWO BASES ON ONE PAGE, AND THEY MUST NEVER BE ADDED. The payout bands answer
// „what did ДФЗ pay out to farmers"; the procurement band answers „what did the МЗХ
// family buy". The second is deliberately ALL-TIME and says so, because it does NOT
// follow the CAP-year pill: a CAP financial year and a contract-signing window are
// different clocks, and the default `ns` resolves to „latest CAP year" here but „this
// parliament" for contracts. Painting a 2025 pill over a parliament-windowed contract
// figure is the „show one window and count another" failure CLAUDE.md's URL contract
// names.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Sprout,
  Users,
  PieChart,
  MapPin,
  Landmark,
  Layers,
  ArrowRight,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Card, CardContent } from "@/ux/Card";
import { PackSection } from "@/screens/components/procurement/PackSection";
import { formatEurCompact } from "@/lib/currency";
import { useAgriScope, agriScopedHref } from "@/data/agri/useAgriScope";
import { useAgriHubStats } from "@/data/agri/useAgriHubStats";
import { agriScopeToKey } from "@/data/agri/constants";
import {
  AgriScopePicker,
  AgriScopeFallback,
} from "@/screens/subsidies/AgriScopeGate";
import { AGRI_SECTOR_EIKS } from "@/lib/agriReferenceData";
import { useAwarderGroupModel } from "@/data/procurement/useAwarderGroupModel";
import {
  buildAwarderModelFromAggregates,
  type GroupModelPayload,
  type SectorClassifier,
} from "@/lib/awarderModel";
import type { SectorPackProps } from "@/screens/components/procurement/sectorPacks";

// The procurement band needs headline money, not a CPV taxonomy — one bucket.
const ONE_BUCKET: SectorClassifier<"all"> = { categoryOf: () => "all" };

/** The whole corpus, explicitly — see the two-bases ⚠ above. */
const ALL_TIME = { from: null, to: null } as const;

const pct = (n: number | null | undefined): string | null =>
  n == null || !Number.isFinite(n) ? null : `${n.toFixed(1)}%`;

/** A share bar that is a TRUE PARTITION of `total`.
 *
 *  ⚠ IT TAKES THE DENOMINATOR EXPLICITLY, and that is the whole point. The first cut
 *  sized the two arms against `aEur + bEur` and called itself a partition — but the
 *  two arms are „money to recipients WITH an ЕИК" and „money to rows with none", and
 *  those do not sum to the scope total: ДФ „Земеделие"'s own receipts sit outside
 *  both (€0 on most scopes, €27.96M on `all`). So it printed 49.91% where the site's
 *  canonical „без ЕИК" share is 39.81% — the same quantity, two denominators, one
 *  page. Any remainder is rendered as its own labelled segment rather than silently
 *  inflating the two arms. */
const PartitionBar: FC<{
  total: number;
  arms: { eur: number; label: string; className: string }[];
  restLabel: string;
  locale: string;
}> = ({ total, arms, restLabel, locale }) => {
  const rest = Math.max(0, total - arms.reduce((n, a) => n + a.eur, 0));
  const seg = [
    ...arms,
    ...(rest > 0
      ? [{ eur: rest, label: restLabel, className: "bg-muted-foreground/40" }]
      : []),
  ];
  const share = (v: number) => (total > 0 ? (100 * v) / total : 0);
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {seg.map((a) => (
          <div
            key={a.label}
            className={a.className}
            style={{ width: `${share(a.eur)}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {seg.map((a) => (
          <span key={a.label} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${a.className}`} />
            {a.label} —{" "}
            <b className="tabular-nums">{formatEurCompact(a.eur, locale)}</b>
            <span className="text-muted-foreground">
              ({share(a.eur).toFixed(1)}%)
            </span>
          </span>
        ))}
      </div>
    </div>
  );
};

export const AgriPack: FC<SectorPackProps> = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const [params] = useSearchParams();

  // ⚠ The scope control renders ABOVE every early return below — the screen's
  // suppression is structural (packOwnsScope) while this pack's content waits on a
  // fetch, so returning a skeleton before it would leave the page with no time
  // control at all. See SectorDashboardConfig.packOwnsScope.
  const gate = useAgriScope();
  const { data: stats } = useAgriHubStats(agriScopeToKey(gate.scope));

  // The buy-side, over the whole 66-EIK МЗХ roster and the whole corpus.
  const build = useMemo(
    () => (p: GroupModelPayload) =>
      buildAwarderModelFromAggregates(p, ONE_BUCKET),
    [],
  );
  const { model: proc, byUnit } = useAwarderGroupModel(
    AGRI_SECTOR_EIKS,
    build,
    ALL_TIME,
  );
  const procAwarderN = byUnit.filter((u) => (u.totalEur ?? 0) > 0).length;

  const eur = (v: number | null | undefined) =>
    v == null ? "—" : formatEurCompact(v, locale);
  const num = (v: number | null | undefined) =>
    v == null ? "—" : v.toLocaleString(locale);

  // ⚠ THREE STATES, and the middle one is why this is not a ternary. `stats`
  // undefined = still loading, and a heading that reads „Изплатено по САР (всички
  // години)" while the fetch is in flight asserts a span nobody asked for — it
  // rendered exactly that under a „Последна година" pill before this. Only a
  // LOADED payload may name a period: a year when it has one, „всички години" only
  // for the `all` scope that genuinely spans them, and nothing at all until then.
  const scopeLabel = !stats
    ? null
    : stats.scopeYear
      ? String(stats.scopeYear)
      : bg
        ? "всички години"
        : "all years";
  const bandTitle = (base: string) =>
    scopeLabel ? `${base} (${scopeLabel})` : base;

  return (
    <div className="space-y-6">
      <AgriScopePicker />

      {/* ⚠ Only the PAYOUT bands sit inside the gate. Its four states are about the
          agri_payloads scope — „няма данни за 2019" must not blank the procurement
          band below, which reads a different corpus over the whole time span and is
          answerable in every scope. */}
      <AgriScopeFallback
        gate={gate}
        loadingClassName="h-[520px] animate-pulse rounded-xl border bg-card shadow-sm"
      >
        {/* ── Band 1: the payout the hub tile promised ─────────────────────── */}
        <PackSection
          icon={Sprout}
          id="agri-payout"
          title={bandTitle(bg ? "Изплатено по САР" : "CAP money paid out")}
          sub={
            bg
              ? "Директни плащания и мерки за развитие на селските райони, изплатени от ДФ „Земеделие“ на земеделски стопани. Това е числото на плочката „Земеделие“ — трансфери, не обществени поръчки."
              : "Direct payments and rural-development measures paid by the State Fund Agriculture to farmers. This is the figure on the „Земеделие“ hub tile — transfers, not public contracts."
          }
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label={bg ? "Изплатено" : "Paid out"}>
              <div className="text-2xl font-semibold tabular-nums">
                {eur(stats?.totalEur)}
              </div>
            </StatCard>
            <StatCard label={bg ? "Плащания" : "Payments"}>
              <div className="text-2xl font-semibold tabular-nums">
                {num(stats?.paymentRows)}
              </div>
            </StatCard>
            <StatCard label={bg ? "Схеми" : "Schemes"}>
              <div className="text-2xl font-semibold tabular-nums">
                {num(stats?.schemeCount)}
              </div>
            </StatCard>
            <StatCard label={bg ? "Области" : "Provinces"}>
              <div className="text-2xl font-semibold tabular-nums">
                {num(stats?.oblastCount)}
              </div>
            </StatCard>
          </div>
        </PackSection>

        {/* ── Band 2: who receives it ──────────────────────────────────────
           ⚠ „БЕЗ ЕИК" IS NOT „ФИЗИЧЕСКО ЛИЦЕ", AND THIS BAND SHIPPED THAT EXACT
           FALSEHOOD ONCE. Migration 162's header states the rule and names the
           counter-examples inside the bucket — Напоителни системи ЕАД (€47.8m) and
           Община Баните — which is why the cache key is `noEikEur` and never
           `individualEur`. /subsidies/untraceable says it in the same words. Label
           this bucket „без ЕИК"; never „физически лица".
           ⚠ And `noEikBeneficiaries` is a count of distinct NAME+province pairs,
           not of people: one person spelled several ways counts several times, two
           namesakes collapse into one. The sibling page labels it „Различни имена"
           with the hint „Не е брой хора". ─────────────────────────────────── */}
        <PackSection
          icon={Users}
          id="agri-who"
          title={bg ? "Кой получава парите" : "Who receives the money"}
          sub={
            bg
              ? "Част от плащанията ДФ „Земеделие“ публикува без ЕИК — само с име и област. Тези редове не могат да бъдат приписани на конкретен получател, затова не влизат в никоя класация на сайта. „Без ЕИК“ НЕ значи „физическо лице“: сред тях има безспорни фирми и общини."
              : "The fund publishes some payments with no EIK — a name and a province only. Those rows cannot be attributed to a specific recipient, so they enter no ranking on this site. „No EIK“ does NOT mean „natural person“: unmistakable companies and municipalities are among them."
          }
        >
          {stats && (
            <div className="space-y-4">
              <Card>
                <CardContent className="p-4">
                  <PartitionBar
                    total={stats.totalEur}
                    locale={locale}
                    restLabel={
                      bg
                        ? "Собствени постъпления на ДФЗ"
                        : "The fund's own receipts"
                    }
                    arms={[
                      {
                        eur: stats.entityEurExPayer,
                        className: "bg-primary",
                        label: bg
                          ? `С ЕИК — ${num(stats.entityCountExPayer)} организации`
                          : `With an EIK — ${num(stats.entityCountExPayer)} organisations`,
                      },
                      {
                        eur: stats.noEikEur,
                        className: "bg-amber-500",
                        label: bg
                          ? `Без ЕИК — ${num(stats.noEikBeneficiaries)} различни имена`
                          : `No EIK — ${num(stats.noEikBeneficiaries)} distinct names`,
                      },
                    ]}
                  />
                  <p className="mt-3 text-xs leading-snug text-muted-foreground">
                    {bg
                      ? "„Различни имена“ са двойки име + област, не брой хора: един и същ човек може да се изписва по няколко начина, а двама съименници се сливат в едно."
                      : "„Distinct names“ are name + province pairs, not a headcount: one person may be spelled several ways, and two namesakes collapse into one."}
                  </p>
                </CardContent>
              </Card>
              {stats.noEikCompanyShapedEurFloor != null && (
                <StatCard
                  label={
                    bg
                      ? "От тях безспорни фирми и общини (поне)"
                      : "Of those, unmistakable companies and municipalities (at least)"
                  }
                  to={agriScopedHref("/subsidies/untraceable", params)}
                >
                  <div className="text-2xl font-semibold tabular-nums">
                    {eur(stats.noEikCompanyShapedEurFloor)}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {bg
                      ? "…от парите без ЕИК отиват при получатели, чието име носи недвусмислена правна форма (ЕООД, ООД, ЕАД, ОБЩИНА, кооперация…). Това е ДОЛНА граница, не преброяване: фирма, изписана без такъв маркер, не се хваща, така че истинската сума е по-висока."
                      : "…of the no-EIK money goes to recipients whose name carries an unmistakable legal form (ЕООД, ООД, ЕАД, ОБЩИНА, a co-operative…). This is a FLOOR, not a census: a company spelled without such a marker is missed, so the true figure is higher."}
                  </p>
                </StatCard>
              )}
            </div>
          )}
        </PackSection>

        {/* ── Band 3: concentration ────────────────────────────────────────── */}
        <PackSection
          icon={PieChart}
          id="agri-concentration"
          title={bg ? "Колко концентрирани са" : "How concentrated it is"}
          sub={
            bg
              ? "Дяловете са от парите към ЮРИДИЧЕСКИ лица — единствената част от регистъра, в която получателят е проверим. Физическите лица не участват в знаменателя."
              : "Shares are of money to LEGAL ENTITIES — the only part of the register where the recipient is checkable. Individuals are not in the denominator."
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatCard
              label={bg ? "Топ 100 получатели" : "Top 100 recipients"}
              to={agriScopedHref("/subsidies/concentration", params)}
            >
              <div className="text-2xl font-semibold tabular-nums">
                {pct(stats?.top100PctOfEntityEur) ?? "—"}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {bg ? "от парите към фирми" : "of money to companies"}
              </p>
            </StatCard>
            <StatCard
              label={bg ? "Топ 1000 получатели" : "Top 1000 recipients"}
              to={agriScopedHref("/subsidies/concentration", params)}
            >
              <div className="text-2xl font-semibold tabular-nums">
                {pct(stats?.top1000PctOfEntityEur) ?? "—"}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {bg ? "от парите към фирми" : "of money to companies"}
              </p>
            </StatCard>
          </div>
        </PackSection>

        {/* ── Band 4: what and where ───────────────────────────────────────── */}
        <PackSection
          icon={MapPin}
          id="agri-what-where"
          title={bg ? "Какво и къде" : "What and where"}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatCard
              label={bg ? "Най-голяма схема" : "Largest scheme"}
              to={agriScopedHref("/subsidies/schemes", params)}
            >
              <div className="text-2xl font-semibold tabular-nums">
                {eur(stats?.topSchemeEur)}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {stats?.topScheme ?? "—"}
              </p>
            </StatCard>
            <StatCard
              label={bg ? "Водеща област" : "Leading province"}
              to={agriScopedHref("/subsidies/places", params)}
            >
              <div className="text-2xl font-semibold tabular-nums">
                {eur(stats?.topOblastEur)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {stats?.topOblast ?? "—"}
              </p>
              {/* ⚠ The declared basis, in the same words /subsidies/places uses. A
                province figure here is the RECIPIENT'S REGISTERED SEAT, not where
                the land is — without this sentence „София (столица) е водеща
                земеделска област" is a false claim built from a correct number. */}
              <p className="mt-2 text-xs leading-snug text-muted-foreground">
                {bg
                  ? "Областта е на ПОЛУЧАТЕЛЯ така, както я публикува ДФ „Земеделие“ — за фирма това е седалището по регистрация, а не мястото, където се обработва земята. Затова София (столица) е сред водещите: там са регистрирани дружества, чиито ниви са другаде."
                  : "The province is the RECIPIENT'S, as published by the fund — for a company that is its registered seat, not where the land is farmed. That is why Sofia ranks high: companies are registered there whose fields are elsewhere."}
              </p>
            </StatCard>
          </div>
        </PackSection>

        {/* ── Band 5: political links + cross-corpus ───────────────────────── */}
        <PackSection
          icon={Layers}
          id="agri-links"
          title={bg ? "Пресечни точки" : "Where it overlaps"}
          sub={
            bg
              ? "Връзките са по ЕИК, никога по име — съвпадение на имена не е самоличност."
              : "Links are by EIK, never by name — a name match is not an identity."
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* ⚠ `politicalBasisBuilt === false` means the person layer had not been
              resolved when the cache was built. That is „not built", never „none":
              rendering 0 would publish „no politically-linked recipients" about a
              question nobody asked. */}
            <StatCard
              label={bg ? "Политически свързани" : "Politically linked"}
              to={
                stats?.politicalBasisBuilt
                  ? agriScopedHref("/subsidies/political", params)
                  : undefined
              }
            >
              {stats && !stats.politicalBasisBuilt ? (
                <p className="text-sm text-muted-foreground">
                  {bg ? "Все още не е изчислено" : "Not computed yet"}
                </p>
              ) : (
                <>
                  <div className="text-2xl font-semibold tabular-nums">
                    {eur(stats?.politicalEur)}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {bg
                      ? `${num(stats?.politicalEiks)} фирми · ${num(stats?.politicalPeople)} лица`
                      : `${num(stats?.politicalEiks)} companies · ${num(stats?.politicalPeople)} people`}
                  </p>
                </>
              )}
            </StatCard>
            <StatCard
              label={
                bg ? "И с обществени поръчки" : "Also hold public contracts"
              }
              to={agriScopedHref("/subsidies/cross-programme", params)}
            >
              <div className="text-2xl font-semibold tabular-nums">
                {num(stats?.contractEiks)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {bg ? "стопанства" : "farms"}
              </p>
            </StatCard>
            <StatCard
              label={bg ? "И с проекти по ИСУН" : "Also hold ИСУН projects"}
              to={agriScopedHref("/subsidies/cross-programme", params)}
            >
              <div className="text-2xl font-semibold tabular-nums">
                {num(stats?.isunEiks)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {bg ? "стопанства" : "farms"}
              </p>
            </StatCard>
          </div>
        </PackSection>
      </AgriScopeFallback>

      {/* ── Band 6: the buy-side ─────────────────────────────────────────── */}
      <PackSection
        icon={Landmark}
        id="agri-procurement"
        title={bg ? "Какво купува секторът" : "What the sector buys"}
        // ⚠ AWARDERS ARE COUNTED IN EIKs, INSTITUTIONS IN BODIES, AND THE TWO MUST
        // NOT MEET IN A RATIO. They differ by the succeeded-body rows (НСРЗ still
        // holds a contract under its own EIK), so pairing them printed „Възложители
        // 66 … от 65 в сектора" — 66 of 65 — live on this page. Anything counting
        // awarder RECORDS uses AGRI_SECTOR_EIKS.length; AGRI_BODY_COUNT is for prose
        // about how many institutions exist, and the awarders-tile footnote owns it.
        // The education audit records the same distinction („34 държавни висши
        // училища" for 33).
        sub={
          bg
            ? `Обществените поръчки на ${AGRI_SECTOR_EIKS.length} възложителя под МЗХ — министерството, ДФЗ, БАБХ, горската администрация и агенциите. Различна основа от изплатеното по-горе: двете не се събират. Целият корпус (2011–2026), не избраната година.`
            : `Public contracts of the ${AGRI_SECTOR_EIKS.length} awarders under the agriculture ministry — the ministry, the paying agency, food safety, forestry and the agencies. A different basis from the payout above: the two do not add. Whole corpus (2011–2026), not the selected year.`
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label={bg ? "Общо възложени" : "Total awarded"}>
            <div className="text-2xl font-semibold tabular-nums">
              {eur(proc?.totalEur)}
            </div>
          </StatCard>
          <StatCard label={bg ? "Договори" : "Contracts"}>
            <div className="text-2xl font-semibold tabular-nums">
              {num(proc?.contractCount)}
            </div>
          </StatCard>
          <StatCard label={bg ? "Възложители" : "Awarders"}>
            <div className="text-2xl font-semibold tabular-nums">
              {procAwarderN || "—"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {bg
                ? `от ${AGRI_SECTOR_EIKS.length} в сектора`
                : `of ${AGRI_SECTOR_EIKS.length} in the sector`}
            </p>
          </StatCard>
          <StatCard label={bg ? "Изпълнители" : "Contractors"}>
            <div className="text-2xl font-semibold tabular-nums">
              {num(proc?.supplierCount)}
            </div>
          </StatCard>
        </div>
      </PackSection>

      {/* ── The two routes out. `packRendersOwnContractsLink` is set so the screen
             does not add a second contracts link beneath these. ─────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link to={agriScopedHref("/subsidies", params)} className="block">
          <Card className="h-full transition-colors hover:border-primary/50">
            <CardContent className="flex items-center justify-between gap-3 p-3 md:p-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {bg
                    ? "Всички получатели на субсидии"
                    : "Every subsidy recipient"}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {bg
                    ? "Търсене по стопанство, схеми, области, концентрация."
                    : "Search by farm, schemes, provinces, concentration."}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link to="/procurement/contracts?sector=agri" className="block">
          <Card className="h-full transition-colors hover:border-primary/50">
            <CardContent className="flex items-center justify-between gap-3 p-3 md:p-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {bg
                    ? "Обществените поръчки на сектора"
                    : "Public contracts in this sector"}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {bg
                    ? `Какво купуват ${AGRI_SECTOR_EIKS.length} възложители — договори, изпълнители и категории.`
                    : `What ${AGRI_SECTOR_EIKS.length} awarders buy — contracts, suppliers and categories.`}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
};
