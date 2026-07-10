// ДФ „Земеделие" (State Fund Agriculture) subsidy dashboard — /subsidies.
//
// The national view over the CAP paying-agency corpus: how much is paid, how
// concentrated it is (the "top 10% of farms take most of it" story), which
// schemes and oblasti it flows to, and who the biggest recipients are. Recipient
// rows deep-link to /farm/:eik, where the subsidy history sits beside the same
// entity's procurement + EU-funds record (the cross-program money map).
//
// Copies the homepage shell (no max-width cap); tiles, never tabs.

import { FC } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Sprout,
  Coins,
  Users,
  Scale,
  Layers,
  MapPin,
  Building2,
  Database,
  TrendingUp,
  CalendarRange,
} from "lucide-react";
import { Title } from "@/ux/Title";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./dashboard/StatCard";
import { DashboardSection } from "./dashboard/DashboardSection";
import { useAgriOverview } from "@/data/agri/useAgriOverview";
import { AgriOblastMap } from "./components/subsidies/AgriOblastMap";
import type { AgriIndexFile, AgriConcentration } from "@/data/agri/types";
import { AGRI_FINANCIAL_YEARS, agriScopeToKey } from "@/data/agri/constants";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { useProcurementScope } from "@/data/procurement/useProcurementScope";
import { ProcurementScopeControl } from "./components/procurement/ProcurementScopeControl";

const Tile: FC<{
  title: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  subtitle?: React.ReactNode;
  seeAllHref?: string;
  seeAllLabel?: string;
  children: React.ReactNode;
}> = ({ title, icon: Icon, subtitle, seeAllHref, seeAllLabel, children }) => (
  <div className="rounded-xl border bg-card p-4 shadow-sm">
    <div className="mb-3 flex items-center gap-2 flex-wrap">
      {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
      <span className="text-base font-semibold">{title}</span>
      {subtitle ? (
        <span className="text-xs text-muted-foreground font-normal">
          {subtitle}
        </span>
      ) : null}
      {seeAllHref ? (
        <Link
          to={seeAllHref}
          className="ml-auto text-xs text-primary hover:underline"
        >
          {seeAllLabel} →
        </Link>
      ) : null}
    </div>
    {children}
  </div>
);

// Horizontal bar-list row, share-scaled to the largest value in the set. When
// `desc` is set the label carries a tooltip (the full descriptive name); when
// `href` is set the label links through (e.g. to the scheme's beneficiaries).
const BarRow: FC<{
  label: React.ReactNode;
  value: number;
  max: number;
  locale: string;
  color?: string;
  desc?: string;
  href?: string;
}> = ({
  label,
  value,
  max,
  locale,
  color = "bg-emerald-500/70",
  desc,
  href,
}) => {
  const inner = href ? (
    <Link
      to={href}
      className="block truncate text-sm hover:underline hover:text-primary"
    >
      {label}
    </Link>
  ) : (
    <span className="block truncate text-sm">{label}</span>
  );
  const labelEl =
    desc && desc !== label ? (
      <Hint text={desc} underline={false}>
        {inner}
      </Hint>
    ) : (
      inner
    );
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between gap-2">
        {/* min-w-0 + flex-1 constrains the label so the inner block-truncate
            clips a long scheme name with an ellipsis (in both the plain and
            Hint-wrapped cases) instead of pushing the amount off the tile. */}
        <div className="min-w-0 flex-1">{labelEl}</div>
        <span className="text-sm tabular-nums font-medium shrink-0">
          {formatEurCompact(value, locale)}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded bg-muted overflow-hidden">
        <div
          className={`h-full rounded ${color}`}
          style={{
            width: `${max > 0 ? Math.max((value / max) * 100, 1) : 0}%`,
          }}
        />
      </div>
    </div>
  );
};

// Concentration as distinctly-separated tiers. A Lorenz curve can't visually
// separate "top 10 / 100 / 1000" on a linear axis (the top 1000 of ~10k firms is
// only ~10% of the x-range, so all tiers crush into one edge). Instead show each
// tier's MARGINAL share of the money as its own segment of a 100%-wide bar, with
// gaps + graduated shades so the tiers read at a glance.
const ConcentrationBar: FC<{ c: AgriConcentration; bg: boolean }> = ({
  c,
  bg,
}) => {
  const nloc = bg ? "bg-BG" : "en-US";
  const n = c.entityCount;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const clamp = (x: number) => Math.max(0, x);
  const tiers = [
    {
      key: "t10",
      label: bg ? "Топ 10" : "Top 10",
      share: r2(c.top10Share),
      count: Math.min(10, n),
      color: "bg-emerald-700",
    },
    {
      key: "t100",
      label: "11–100",
      share: r2(c.top100Share - c.top10Share),
      count: clamp(Math.min(100, n) - 10),
      color: "bg-emerald-500",
    },
    {
      key: "t1000",
      label: "101–1000",
      share: r2(c.top1000Share - c.top100Share),
      count: clamp(Math.min(1000, n) - 100),
      color: "bg-emerald-400",
    },
    {
      key: "rest",
      label: bg ? "Останалите" : "The rest",
      share: r2(100 - c.top1000Share),
      count: clamp(n - 1000),
      color: "bg-zinc-300 dark:bg-zinc-600",
    },
  ].filter((tier) => tier.count > 0);

  return (
    <>
      <div
        className="flex w-full gap-1 h-8"
        role="img"
        aria-label={
          bg
            ? "Дял на всяка група фирми от общата сума"
            : "Share of the total held by each tier of firms"
        }
      >
        {tiers.map((tier) => (
          <div
            key={tier.key}
            className={`${tier.color} rounded-sm first:rounded-l-md last:rounded-r-md`}
            style={{ width: `${tier.share}%` }}
            title={`${tier.label}: ${tier.share}%`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {tiers.map((tier) => (
          <li
            key={tier.key}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span
                className={`h-3 w-3 shrink-0 rounded-sm ${tier.color}`}
                aria-hidden
              />
              <span>{tier.label}</span>
              <span className="text-xs text-muted-foreground">
                {tier.count.toLocaleString(nloc)} {bg ? "фирми" : "firms"}
              </span>
            </span>
            <span className="tabular-nums font-semibold shrink-0">
              {tier.share}%
            </span>
          </li>
        ))}
      </ul>
    </>
  );
};

const SkeletonCard: FC = () => (
  <div className="rounded-xl border bg-card p-4 shadow-sm animate-pulse h-[130px]">
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded" />
  </div>
);

const Dashboard: FC<{ data: AgriIndexFile }> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const nloc = bg ? "bg-BG" : "en-US";
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Browse links carry the section scope (pscope) + election forward, so the
  // scope survives the click into the sub-page — same contract as the
  // procurement nav's useProcurementHref.
  const browseTo = (extra: Record<string, string>): string => {
    const p = new URLSearchParams();
    const ps = params.get("pscope");
    if (ps) p.set("pscope", ps);
    const el = params.get("elections");
    if (el) p.set("elections", el);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const s = p.toString();
    return `/subsidies/browse${s ? `?${s}` : ""}`;
  };
  const c = data.concentration;
  const schemeMax = Math.max(...data.byScheme.map((s) => s.totalEur), 1);
  const yearMax = Math.max(...data.totalsByYear.map((y) => y.totalEur), 1);
  const recipients = data.headline.entityCount + data.headline.individualCount;
  const scopeLabel = data.scopeYear
    ? (bg ? "Финансова година " : "Financial year ") + data.scopeYear
    : bg
      ? "Всички години"
      : "All years";
  const scopeYearLabel = data.scopeYear
    ? String(data.scopeYear)
    : bg
      ? "всички години"
      : "all years";

  return (
    <>
      {/* KPI row */}
      <DashboardSection
        id="subsidies-headline"
        title={bg ? "Накратко" : "At a glance"}
        icon={Sprout}
        subtitle={scopeLabel}
      >
        <div
          data-og="subsidies-hero"
          className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
        >
          <StatCard label={bg ? "Изплатено" : "Paid"}>
            <div className="flex items-baseline gap-2">
              <Coins className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-2xl font-bold tabular-nums">
                {formatEurCompact(data.headline.totalEur, L)}
              </span>
            </div>
          </StatCard>
          <StatCard label={bg ? "Получатели" : "Recipients"}>
            <div className="flex items-baseline gap-2">
              <Users className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-2xl font-bold tabular-nums">
                {recipients.toLocaleString(nloc)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {data.headline.entityCount.toLocaleString(nloc)}{" "}
              {bg ? "фирми" : "companies"} ·{" "}
              {data.headline.individualCount.toLocaleString(nloc)}{" "}
              {bg ? "физ. лица" : "individuals"}
            </div>
          </StatCard>
          <StatCard
            label={bg ? "Топ 100 фирми взимат" : "Top 100 firms take"}
            hint={
              bg
                ? "Дял на 100-те най-големи фирми от парите за юридически лица."
                : "Share of legal-entity money captured by the 100 largest firms."
            }
          >
            <div className="flex items-baseline gap-2">
              <Scale className="h-5 w-5 text-muted-foreground shrink-0" />
              <span className="text-2xl font-bold tabular-nums">
                {c.top100Share}%
              </span>
            </div>
          </StatCard>
          <StatCard label={bg ? "Най-голяма схема" : "Largest scheme"}>
            <div className="flex flex-col">
              <span className="text-lg font-bold">
                {data.headline.topScheme?.scheme ?? "—"}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {data.headline.topScheme
                  ? formatEurCompact(data.headline.topScheme.totalEur, L)
                  : ""}
              </span>
            </div>
          </StatCard>
        </div>
      </DashboardSection>

      {/* Distribution: concentration + schemes + oblasti + trend */}
      <DashboardSection
        id="subsidies-distribution"
        title={bg ? "Разпределение" : "Distribution"}
        icon={Layers}
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Tile
            title={bg ? "Концентрация" : "Concentration"}
            icon={Scale}
            subtitle={
              bg
                ? `сред ${c.entityCount.toLocaleString(nloc)} фирми, ${scopeYearLabel}`
                : `among ${c.entityCount.toLocaleString(nloc)} firms, ${scopeYearLabel}`
            }
          >
            <ConcentrationBar c={c} bg={bg} />
            <p className="mt-3 text-xs text-muted-foreground">
              {bg
                ? `Всеки сегмент е дял от общата сума. Само 1000 фирми (от ${c.entityCount.toLocaleString(nloc)}) взимат ${c.top1000Share}% от парите за юридически лица.`
                : `Each segment is a share of the total. Just 1000 firms (of ${c.entityCount.toLocaleString(nloc)}) take ${c.top1000Share}% of the legal-entity money.`}
            </p>
          </Tile>

          <Tile
            title={bg ? "По схема" : "By scheme"}
            icon={Layers}
            subtitle={scopeYearLabel}
          >
            <div>
              {data.byScheme.map((s) => (
                <BarRow
                  key={s.scheme}
                  label={s.scheme}
                  desc={s.desc}
                  href={browseTo({ scheme: s.scheme })}
                  value={s.totalEur}
                  max={schemeMax}
                  locale={L}
                />
              ))}
            </div>
          </Tile>

          <Tile
            title={bg ? "По област" : "By region"}
            icon={MapPin}
            subtitle={scopeYearLabel}
          >
            <AgriOblastMap
              rows={data.byOblast}
              locale={L}
              bg={bg}
              onSelectOblast={(name) => navigate(browseTo({ oblast: name }))}
            />
          </Tile>

          <Tile
            title={bg ? "По година" : "By year"}
            icon={TrendingUp}
            subtitle={
              bg ? "изплатено по финансова година" : "paid by financial year"
            }
          >
            <div>
              {data.totalsByYear.map((y) => (
                <BarRow
                  key={y.year}
                  label={String(y.year)}
                  value={y.totalEur}
                  max={yearMax}
                  locale={L}
                  color="bg-emerald-500/70"
                />
              ))}
            </div>
          </Tile>
        </div>
      </DashboardSection>

      {/* Top recipients */}
      <DashboardSection
        id="subsidies-recipients"
        title={bg ? "Най-големи получатели" : "Top recipients"}
        icon={Building2}
      >
        <Tile
          title={
            bg
              ? `Топ получатели (${scopeYearLabel})`
              : `Top recipients (${scopeYearLabel})`
          }
          icon={Building2}
          subtitle={
            bg
              ? "юридически лица; държавни интервенции са изключени"
              : "legal entities; state-intervention payees excluded"
          }
          seeAllHref={browseTo({})}
          seeAllLabel={bg ? "Всички" : "See all"}
        >
          <div className="rounded-md border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 w-10">#</th>
                  <th className="text-left px-3 py-2">
                    {bg ? "Получател" : "Recipient"}
                  </th>
                  <th className="text-left px-3 py-2 hidden sm:table-cell">
                    {bg ? "Област" : "Region"}
                  </th>
                  <th className="text-right px-3 py-2">
                    {bg ? "Общо" : "Total"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.topRecipients.slice(0, 25).map((r, idx) => (
                  <tr key={r.eik}>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/farm/${r.eik}`}
                        className="font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground">
                      {r.oblast || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatEur(r.totalEur, L)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tile>
      </DashboardSection>

      {/* Browse link */}
      <DashboardSection
        id="subsidies-data"
        title={bg ? "Данни" : "Data"}
        icon={Database}
      >
        <Tile
          title={bg ? "Разгледай всички плащания" : "Browse all payments"}
          icon={Database}
        >
          <p className="text-sm text-muted-foreground mb-3">
            {bg
              ? `${(data.concentration.entityCount + data.headline.individualCount).toLocaleString(nloc)} получатели, ~2 млн. плащания за ${data.years.length} години. Търсене и филтри по получател, схема, област и година.`
              : `Search and filter ~2M payments across ${data.years.length} years by recipient, scheme, region and year.`}
          </p>
          <Link
            to={browseTo({ pscope: "all" })}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {bg ? "Отвори таблицата" : "Open the table"} →
          </Link>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("data_source") || (bg ? "Източник" : "Source")}:{" "}
            {data.generatedFrom}
          </p>
        </Tile>
      </DashboardSection>
    </>
  );
};

export const SubsidiesDashboardScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  // Same time-scope machinery as the procurement pages: the `?pscope` URL param
  // (ns | all | y:YYYY), carried between the section and its sub-pages by
  // useProcurementHref. Subsidies has no per-parliament slice, so "ns" resolves
  // to the latest financial year (the pill is relabelled accordingly).
  const { scope } = useProcurementScope();
  const { data, isLoading } = useAgriOverview(agriScopeToKey(scope));
  const title = bg ? "Земеделски субсидии" : "Farm subsidies";
  const description =
    "Bulgarian CAP subsidies from the State Fund Agriculture (ДФЗ): who gets farm money, how concentrated it is, by scheme, region and year.";

  return (
    <>
      <Title description={description}>{title}</Title>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
          <CalendarRange className="h-3.5 w-3.5" />
          {bg ? "Обхват" : "Scope"}
        </span>
        <ProcurementScopeControl
          years={AGRI_FINANCIAL_YEARS}
          nsLabelOverride={bg ? "Последна година" : "Latest year"}
        />
      </div>
      {isLoading || !data ? (
        <section aria-label={title} className="my-4">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </section>
      ) : (
        <Dashboard data={data} />
      )}
    </>
  );
};
