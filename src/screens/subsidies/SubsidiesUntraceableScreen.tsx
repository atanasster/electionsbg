// /subsidies/untraceable — the money that cannot be attributed to a recipient.
//
// docs/plans/subsidies-hub-v1.md §4.3. This page exists because of a correction: the
// plan originally specified it as „/subsidies/individuals — 39,8% от парите отиват при
// физически лица", and that premise is FALSE.
//
// ═══════════════════════════════════════════════════════════════════════════════════
// „NO ЕИК" IS NOT „ФИЗИЧЕСКО ЛИЦЕ".
//
// Measured on the corpus: €345.9m of the no-ЕИК money carries an unmistakable company
// name — Напоителни системи ЕАД at €47.8m, Община Баните, dozens of ЕООД. And that is
// a FLOOR, not a census: it matches only explicit legal-form markers, so a company
// spelled without one is missed and the true figure is higher.
//
// So the honest headline is the one this page leads with: 39.8% of the money sits on
// rows the register published WITHOUT AN IDENTIFIER. That is unattributable — no
// /farm page, no ownership, no cross-programme join, no political link — and it is a
// fact about the register rather than about farmers. How much of it is a person and
// how much a company is exactly what cannot be known from this corpus.
//
// The rising trend is therefore a claim about ATTRIBUTION COVERAGE falling, never
// about who farms.
// ═══════════════════════════════════════════════════════════════════════════════════
//
// NO RANKING OF INDIVIDUALS, deliberately (§4.2). Aggregates only: share by year, by
// oblast, by scheme. A „топ физически лица" leaderboard would be a new editorial act
// rather than a re-presentation of the browse, and the „never name individuals on an
// arbitrary tie-break" rule applies with more force to private persons than to MPs.

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { AgriScopePicker, AgriScopeFallback } from "./AgriScopeGate";
import { useAgriScope } from "@/data/agri/useAgriScope";
import { useAgriHubStats } from "@/data/agri/useAgriHubStats";
import { agriScopeToKey } from "@/data/agri/constants";
import { agriLabel, formatScopeLabel, numberLocale } from "@/data/agri/labels";
import { useScope } from "@/data/scope/useScope";
import { formatEur, formatEurCompact } from "@/lib/currency";

export const SubsidiesUntraceableScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const nloc = numberLocale(bg);
  const gate = useAgriScope();
  const { data } = gate;
  const { scope } = useScope();
  const { data: hub } = useAgriHubStats(agriScopeToKey(scope));

  const pct = (n: number) =>
    `${n.toLocaleString(nloc, { maximumFractionDigits: 1 })}%`;

  const title = bg ? "Непроследими получатели" : "Untraceable recipients";
  const description = bg
    ? "Около 40% от земеделските субсидии стоят на редове без ЕИК — без стабилен идентификатор, така че не могат да бъдат приписани на получател."
    : "Around 40% of Bulgaria's farm subsidy sits on rows with no ЕИК — no stable identifier, so it cannot be attributed to a recipient.";

  const scopeLabel = formatScopeLabel(data?.scopeYear, bg);

  // The by-year series comes from the payload the page already fetches — no second
  // request. `individualEur` is the payload's name for the no-ЕИК money; it is
  // renamed on the way out for the reason the file header gives.
  const byYear = data?.totalsByYear ?? [];
  const maxShare = Math.max(
    ...byYear.map((y) =>
      y.totalEur > 0 ? (y.individualEur / y.totalEur) * 100 : 0,
    ),
    1,
  );

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="agri_subsidies_nav"
        sectionTo="/subsidies"
        currentKey="subsidies_untraceable_nav"
        className="mt-5"
      />
      <section aria-label={title} className="my-4">
        <p className="mb-2 max-w-3xl text-sm text-muted-foreground">
          {bg
            ? "ДФ „Земеделие“ публикува част от плащанията без ЕИК — само с име и област. Тези редове не могат да бъдат приписани на конкретен получател: сливането на двама съименници е предположение, а разделянето им подценява. Затова те не се появяват в никоя класация на сайта."
            : "The State Fund Agriculture publishes some payments with no ЕИК — a name and a province only. Those rows cannot be attributed to a specific recipient: merging two namesakes is a guess and splitting them understates. That is why they appear in no ranking on this site."}
        </p>
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          {bg
            ? "Не приемайте „без ЕИК“ за „физическо лице“. Сред тези редове има безспорни фирми и общини — виж по-долу колко."
            : "“No ЕИК” does not mean “natural person”. These rows include unmistakable companies and municipalities — see how much below."}
        </p>

        <AgriScopePicker className="mb-3" />

        <AgriScopeFallback gate={gate}>
          {data && (
            <>
              <DashboardSection
                id="subsidies-untraceable-headline"
                title={agriLabel.atAGlance(bg)}
                icon={HelpCircle}
                subtitle={scopeLabel}
              >
                <div
                  data-og="subsidies-untraceable"
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
                >
                  <StatCard
                    label={bg ? "Без ЕИК" : "With no ЕИК"}
                    hint={
                      bg
                        ? "Дял от всичко изплатено през периода."
                        : "Share of everything paid in the period."
                    }
                  >
                    {/* From the HUB CACHE, like the two cards to the right — not
                        from agri_payloads. The cache is built FROM that payload, so
                        the two agree, but reading one card from each source is how a
                        headline row starts describing two vintages. */}
                    <span className="text-2xl font-bold tabular-nums">
                      {hub?.noEikPctOfTotalEur != null
                        ? pct(Number(hub.noEikPctOfTotalEur))
                        : "—"}
                    </span>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {hub?.noEikEur != null
                        ? formatEurCompact(Number(hub.noEikEur), L)
                        : ""}
                    </div>
                  </StatCard>
                  <StatCard
                    label={bg ? "Различни имена" : "Distinct names"}
                    hint={
                      bg
                        ? "Различни двойки име + област. Не е брой хора: един и същ човек може да се изписва по няколко начина, а двама съименници се сливат."
                        : "Distinct name + province pairs. NOT a headcount: one person may be spelled several ways, and two namesakes collapse into one."
                    }
                  >
                    <span className="text-2xl font-bold tabular-nums">
                      {hub?.noEikBeneficiaries != null
                        ? Number(hub.noEikBeneficiaries).toLocaleString(nloc)
                        : "—"}
                    </span>
                  </StatCard>
                  <StatCard
                    label={agriLabel.payments(bg)}
                    hint={
                      bg
                        ? "Брой редове без ЕИК — не получатели."
                        : "Rows with no ЕИК — not recipients."
                    }
                  >
                    <span className="text-2xl font-bold tabular-nums">
                      {hub?.noEikRows != null
                        ? Number(hub.noEikRows).toLocaleString(nloc)
                        : "—"}
                    </span>
                  </StatCard>
                  <StatCard
                    label={
                      bg ? "От тях явни фирми" : "Of that, plainly companies"
                    }
                    hint={
                      bg
                        ? "ДОЛНА ГРАНИЦА: брои само имена с недвусмислена правна форма (ЕООД, ООД, ЕАД, АД, кооперация, община, сдружение, фондация, читалище, ЕТ). Фирма, изписана без такъв маркер, не се брои, така че истинската сума е по-голяма."
                        : "A FLOOR: it counts only names carrying an unmistakable legal form. A company spelled without one is missed, so the true figure is higher."
                    }
                  >
                    <span className="text-2xl font-bold tabular-nums">
                      {hub?.noEikCompanyShapedEurFloor != null
                        ? formatEurCompact(
                            Number(hub.noEikCompanyShapedEurFloor),
                            L,
                          )
                        : "—"}
                    </span>
                    <div className="text-xs text-muted-foreground">
                      {bg ? "поне" : "at least"}
                    </div>
                  </StatCard>
                </div>
              </DashboardSection>

              <DashboardSection
                id="subsidies-untraceable-trend"
                title={bg ? "По година" : "By year"}
                icon={HelpCircle}
                subtitle={
                  bg
                    ? "дял на плащанията без ЕИК"
                    : "share of payments with no ЕИК"
                }
              >
                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  {byYear.map((y) => {
                    const share =
                      y.totalEur > 0 ? (y.individualEur / y.totalEur) * 100 : 0;
                    return (
                      <div key={y.year} className="py-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm tabular-nums">{y.year}</span>
                          <span className="text-sm font-medium tabular-nums">
                            {pct(share)}{" "}
                            <span className="text-xs font-normal text-muted-foreground">
                              {formatEurCompact(y.individualEur, L)}
                            </span>
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                          <div
                            className="h-full rounded bg-amber-500/70"
                            style={{
                              width: `${Math.max((share / maxShare) * 100, 1)}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {/* The break, named rather than smoothed. It sits exactly on the
                      source change, and the company-shaped floor is what makes that
                      more than a coincidence. */}
                  <div className="mt-4 rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-sm dark:border-amber-800/50 dark:bg-amber-950/20">
                    {bg
                      ? "Скокът между 2023 и 2024 съвпада точно със смяната на източника: 2015-2023 идват от портала за отворени данни, 2024-2025 — от системата за електронни услуги на ДФЗ. Променя се и съставът: до 2023 явните фирми без ЕИК са под 4 хил. евро годишно, а през 2024 и 2025 са €149 млн. и €196 млн. Тоест поне част от „новите“ непроследими пари са фирми, които по-старият източник е публикувал с ЕИК. Каква част от останалото е реална промяна в получателите не е установено."
                      : "The jump between 2023 and 2024 sits exactly on the source change: 2015-2023 come from the open-data portal, 2024-2025 from the Fund's e-services register. The composition changes too: until 2023 the plainly-corporate no-ЕИК money is under €4k a year, while in 2024 and 2025 it is €149m and €196m. So at least part of the “new” untraceable money is companies the older source published with an ЕИК. How much of the remainder is a real change in recipients is not established."}
                  </div>
                </div>
              </DashboardSection>

              <p className="mt-4 text-xs text-muted-foreground">
                {t("data_source")}: {data.generatedFrom} ·{" "}
                {bg
                  ? `общо изплатено за периода ${formatEur(data.headline.totalEur, L)}`
                  : `total paid in the period ${formatEur(data.headline.totalEur, L)}`}
              </p>
            </>
          )}
        </AgriScopeFallback>
      </section>
    </>
  );
};
