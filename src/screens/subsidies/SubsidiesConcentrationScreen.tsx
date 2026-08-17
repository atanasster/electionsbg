// /subsidies/concentration — how unevenly the farm money is shared.
//
// Absorbs the hub's „Концентрация" tile (docs/plans/subsidies-hub-v1.md §6) and finally
// renders the LORENZ CURVE. Those 25 points have been computed by every ingest since
// the corpus landed, stored in every `agri_payloads` overview blob, and drawn nowhere:
// `ConcentrationBar` deliberately does not use them, because a Lorenz curve cannot
// separate „top 10 / 100 / 1000" inside a tile — on a linear axis the top 1,000 of
// ~16.7k firms is the last 6% of the x-range and every tier crushes into one edge.
// On a full page it has the room, and the tier bar keeps its job beside it.
//
// ═══════════════════════════════════════════════════════════════════════════════════
// THE DENOMINATOR IS LEGAL-ENTITY MONEY, AND THE PAGE SAYS SO IN EVERY SENTENCE.
//
// „Топ 100 взимат 12,6%" is a share of the €6.62bn that went to companies, not of the
// €11.04bn corpus — over the corpus the same numerator is 7.5%. Both are true and they
// are five points apart, which is exactly the „arithmetically correct, false as a
// sentence" defect the dashboard-hub skill is about. Every figure here is labelled with
// its denominator, and the payload's own `concentration.basis` field („legal-entities")
// is what the caption reads.
//
// The excluded half is not hidden either: rows with no ЕИК cannot be ranked at all, so
// concentration is unmeasurable over them. The page links to the page about that.
// ═══════════════════════════════════════════════════════════════════════════════════

import { type FC, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { AgriScopePicker, AgriScopeFallback } from "./AgriScopeGate";
import { useAgriScope, agriScopedHref } from "@/data/agri/useAgriScope";
import { formatEurCompact } from "@/lib/currency";

/** The tier bar: each segment is a tier's MARGINAL share of the money. */
const TierBar: FC<{
  tiers: {
    key: string;
    label: string;
    share: number;
    count: number;
    color: string;
  }[];
  bg: boolean;
  nloc: string;
}> = ({ tiers, bg, nloc }) => {
  // Through Intl, never a bare `{n}%`: a raw number renders „3.11%" with a DOT in
  // Bulgarian, where the decimal separator is a comma. The plan calls this out as
  // the one formatting slip an expression makes silently.
  const pct = (n: number) =>
    `${n.toLocaleString(nloc, { maximumFractionDigits: 2 })}%`;
  return (
    <>
      <div
        className="flex h-8 w-full gap-1"
        role="img"
        aria-label={
          bg
            ? "Дял на всяка група фирми от парите за юридически лица"
            : "Each tier's share of the legal-entity money"
        }
      >
        {tiers.map((t) => (
          <div
            key={t.key}
            className={`${t.color} rounded-sm first:rounded-l-md last:rounded-r-md`}
            style={{ width: `${Math.max(t.share, 0)}%` }}
            title={`${t.label}: ${pct(t.share)}`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {tiers.map((t) => (
          <li key={t.key} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`h-3 w-3 shrink-0 rounded-sm ${t.color}`}
                aria-hidden
              />
              <span>{t.label}</span>
              <span className="text-xs text-muted-foreground">
                {t.count.toLocaleString(nloc)} {bg ? "фирми" : "firms"}
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums">
              {pct(t.share)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
};

/** The Lorenz curve, as an inline SVG — 25 stored points plus the equality line. */
const LorenzCurve: FC<{
  points: { x: number; y: number }[];
  bg: boolean;
}> = ({ points, bg }) => {
  const W = 460;
  const H = 320;
  const P = 34;
  const sx = (x: number) => P + (x / 100) * (W - P * 2);
  // y grows DOWNWARD in SVG, so the curve is inverted to read the usual way round.
  const sy = (y: number) => H - P - (y / 100) * (H - P * 2);
  const path = points
    .map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full max-w-[460px]"
      role="img"
      aria-label={
        bg
          ? "Крива на Лоренц: колко от парите се падат на най-малките получатели"
          : "Lorenz curve: how much of the money the smallest recipients receive"
      }
    >
      <line
        x1={sx(0)}
        y1={sy(0)}
        x2={sx(100)}
        y2={sy(100)}
        className="stroke-muted-foreground/40"
        strokeDasharray="4 4"
        strokeWidth={1.5}
      />
      <path
        d={path}
        fill="none"
        className="stroke-emerald-600"
        strokeWidth={2.5}
      />
      <line
        x1={sx(0)}
        y1={sy(0)}
        x2={sx(100)}
        y2={sy(0)}
        className="stroke-border"
      />
      <line
        x1={sx(0)}
        y1={sy(0)}
        x2={sx(0)}
        y2={sy(100)}
        className="stroke-border"
      />
      <text
        x={W / 2}
        y={H - 6}
        textAnchor="middle"
        className="fill-muted-foreground text-[11px]"
      >
        {bg
          ? "% от фирмите (от най-малката нагоре)"
          : "% of firms (smallest first)"}
      </text>
      <text
        x={12}
        y={H / 2}
        textAnchor="middle"
        transform={`rotate(-90 12 ${H / 2})`}
        className="fill-muted-foreground text-[11px]"
      >
        {bg ? "% от парите" : "% of the money"}
      </text>
    </svg>
  );
};

export const SubsidiesConcentrationScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const nloc = bg ? "bg-BG" : "en-US";
  const [params] = useSearchParams();
  const gate = useAgriScope();
  const { data } = gate;

  const c = data?.concentration;
  const pct = (n: number) =>
    `${n.toLocaleString(nloc, { maximumFractionDigits: 2 })}%`;
  // COMPUTED, never a constant. „около 7,5%" is the all-years figure and is wrong
  // for 7 of the 10 scopes — 14.23% at 2016 — and every input is already in the
  // payload: rebasing the top-100 share from legal-entity money onto the corpus is
  // share × entityEur / totalEur.
  const overCorpus =
    c && data && data.headline.totalEur > 0
      ? (c.top100Share * c.entityEur) / data.headline.totalEur
      : null;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const clamp = (x: number) => Math.max(0, x);

  const tiers = useMemo(() => {
    if (!c) return [];
    const n = c.entityCount;
    return [
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
  }, [c, bg]);

  const title = bg ? "Концентрация на субсидиите" : "Subsidy concentration";
  const description = bg
    ? "Колко от земеделските субсидии отиват при най-големите получатели — по групи и с крива на Лоренц, върху парите за юридически лица."
    : "How much of the farm subsidy goes to the largest recipients — by tier and as a Lorenz curve, over the legal-entity money.";

  const scopeLabel = data?.scopeYear
    ? (bg ? "Финансова година " : "Financial year ") + data.scopeYear
    : bg
      ? "Всички години"
      : "All years";

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="agri_subsidies_nav"
        sectionTo="/subsidies"
        currentKey="subsidies_concentration_nav"
        className="mt-5"
      />
      <section aria-label={title} className="my-4">
        <p className="mb-2 max-w-3xl text-sm text-muted-foreground">
          {bg
            ? "Земеделската субсидия не се разпределя равномерно: малка група стопанства получава непропорционален дял. Тук е колко точно, по групи и като крива."
            : "Farm subsidy is not shared evenly: a small group of holdings receives a disproportionate share. Here is how much, by tier and as a curve."}
        </p>
        {/* The denominator, named before any number appears. */}
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          {/* The over-corpus comparison is COMPUTED, never the hard-coded „7,5%":
              that is the all-years figure and it is wrong for 7 of the 10 scopes
              (14,23% at 2016), while every input is already in the fetched payload. */}
          {bg ? (
            <>
              Всички дялове на тази страница са от парите за{" "}
              <strong>юридически лица</strong>, не от общата сума. Плащанията
              без ЕИК не могат да бъдат подредени по получател, така че
              концентрацията върху тях е неизмерима —{" "}
              <Link
                to={agriScopedHref("/subsidies/untraceable", params)}
                className="text-primary hover:underline"
              >
                колко са
              </Link>
              .
              {overCorpus !== null && c ? (
                <>
                  {" "}
                  За сравнение: същият числител, разделен на всичко изплатено
                  през периода, дава {pct(overCorpus)} вместо{" "}
                  {pct(c.top100Share)} за топ 100.
                </>
              ) : null}
            </>
          ) : (
            <>
              Every share on this page is out of the money paid to{" "}
              <strong>legal entities</strong>, not out of the total. Payments
              with no ЕИК cannot be attributed to a recipient, so concentration
              over them is unmeasurable —{" "}
              <Link
                to={agriScopedHref("/subsidies/untraceable", params)}
                className="text-primary hover:underline"
              >
                how much that is
              </Link>
              .
              {overCorpus !== null && c ? (
                <>
                  {" "}
                  For comparison: the same numerator over everything paid in the
                  period is {pct(overCorpus)} rather than {pct(c.top100Share)}{" "}
                  for the top 100.
                </>
              ) : null}
            </>
          )}
        </p>

        <AgriScopePicker className="mb-3" />

        <AgriScopeFallback gate={gate}>
          {c && (
            <>
              <DashboardSection
                id="subsidies-concentration-tiers"
                title={bg ? "По групи" : "By tier"}
                icon={Scale}
                subtitle={`${scopeLabel} · ${c.entityCount.toLocaleString(nloc)} ${
                  bg ? "фирми" : "firms"
                }`}
              >
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div
                    data-og="subsidies-concentration"
                    className="rounded-xl border bg-card p-4 shadow-sm"
                  >
                    <TierBar tiers={tiers} bg={bg} nloc={nloc} />
                    <p className="mt-3 text-xs text-muted-foreground">
                      {bg
                        ? `Всеки сегмент е дял от парите за юридически лица (${formatEurCompact(c.entityEur, L)}). Само 1000 фирми от ${c.entityCount.toLocaleString(nloc)} взимат ${pct(c.top1000Share)} от тях.`
                        : `Each segment is a share of the legal-entity money (${formatEurCompact(c.entityEur, L)}). Just 1,000 firms of ${c.entityCount.toLocaleString(nloc)} take ${pct(c.top1000Share)} of it.`}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <StatCard
                      label={bg ? "Топ 10 взимат" : "Top 10 take"}
                      hint={
                        bg
                          ? "Дял от парите за юридически лица, не от общата сума."
                          : "Share of the legal-entity money, not of the total."
                      }
                    >
                      <span className="text-2xl font-bold tabular-nums">
                        {pct(c.top10Share)}
                      </span>
                    </StatCard>
                    <StatCard
                      label={bg ? "Топ 100 взимат" : "Top 100 take"}
                      hint={
                        bg
                          ? `Дял от парите за юридически лица. Върху общата сума за този период същият числител е ${overCorpus !== null ? pct(overCorpus) : "по-малък"}.`
                          : `Share of the legal-entity money. Over this period's whole total the same numerator is ${overCorpus !== null ? pct(overCorpus) : "smaller"}.`
                      }
                    >
                      <span className="text-2xl font-bold tabular-nums">
                        {pct(c.top100Share)}
                      </span>
                    </StatCard>
                    <StatCard label={bg ? "Топ 1000 взимат" : "Top 1,000 take"}>
                      <span className="text-2xl font-bold tabular-nums">
                        {pct(c.top1000Share)}
                      </span>
                    </StatCard>
                    <StatCard
                      label={bg ? "Пари за фирми" : "Legal-entity money"}
                      hint={
                        bg
                          ? "Знаменателят на всички дялове на страницата."
                          : "The denominator of every share on this page."
                      }
                    >
                      <span className="text-xl font-bold tabular-nums">
                        {formatEurCompact(c.entityEur, L)}
                      </span>
                    </StatCard>
                  </div>
                </div>
              </DashboardSection>

              <DashboardSection
                id="subsidies-concentration-lorenz"
                title={bg ? "Крива на Лоренц" : "Lorenz curve"}
                icon={Scale}
                subtitle={scopeLabel}
              >
                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  {c.lorenz.length > 1 ? (
                    <>
                      <LorenzCurve points={c.lorenz} bg={bg} />
                      <p className="mt-3 max-w-2xl text-xs text-muted-foreground">
                        {bg
                          ? "Пунктирът е пълно равенство — там всяка фирма получава еднакво. Колкото по-надолу минава кривата, толкова по-концентрирани са парите. Фирмите са подредени от най-малкия получател към най-големия."
                          : "The dashed line is perfect equality — every firm receiving the same. The further the curve sags below it, the more concentrated the money. Firms are ordered from the smallest recipient to the largest."}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {bg
                        ? "За този период няма изчислена крива."
                        : "No curve was computed for this period."}
                    </p>
                  )}
                </div>
              </DashboardSection>

              <p className="mt-4 text-xs text-muted-foreground">
                {t("data_source")}: {data?.generatedFrom} ·{" "}
                {bg
                  ? `основа: ${c.basis === "legal-entities" ? "юридически лица" : c.basis}`
                  : `basis: ${c.basis}`}
              </p>
            </>
          )}
        </AgriScopeFallback>
      </section>
    </>
  );
};
