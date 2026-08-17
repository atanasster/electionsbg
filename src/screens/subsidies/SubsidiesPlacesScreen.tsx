// /subsidies/places — where the farm money lands, by oblast.
//
// Absorbs the „По област" choropleth off the hub (docs/plans/subsidies-hub-v1.md §6).
// That map was the single heaviest thing on /subsidies: measured on the dev server at
// 1280 px, the page fetched 426.8 KB of its own data and 407.6 KB of it — 95.5% — was
// `regions_map.json`, pulled to draw a preview nobody had asked for yet. It is served
// UNCOMPRESSED from GCS (`x-goog-stored-content-encoding: identity`), so that is the
// figure on prod too, not a dev-server artefact. Verified after the move: the hub now
// fetches 16.1 KB of page-specific data and no GeoJSON at all.
//
// ═══════════════════════════════════════════════════════════════════════════════════
// THE OBLAST IS THE RECIPIENT'S, NOT THE LAND'S — and every label has to say so.
//
// ДФ „Земеделие" publishes the oblast of the BENEFICIARY, which for a company is
// where it is registered rather than where it farms. The tell is in the ranking:
// „София (столица)" is among the largest oblasti by farm subsidy, which is a
// registered-seat artefact and not agriculture in the capital.
//
// So this page is captioned „по област на получателя" throughout, never „къде отиват
// парите" — including in the prerendered <description>, where the correcting clause
// must come FIRST because SERP truncation cuts the tail (plan §9).
// ═══════════════════════════════════════════════════════════════════════════════════

import { type FC } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { StatCard } from "@/screens/dashboard/StatCard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { AgriOblastMap } from "@/screens/components/subsidies/AgriOblastMap";
import { AgriScopePicker, AgriScopeFallback } from "./AgriScopeGate";
import { useAgriScope, agriScopedHref } from "@/data/agri/useAgriScope";
import { formatEur, formatEurCompact } from "@/lib/currency";

export const SubsidiesPlacesScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const nloc = bg ? "bg-BG" : "en-US";
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const gate = useAgriScope();
  const { data } = gate;

  const browseTo = (oblast: string): string =>
    agriScopedHref("/subsidies/browse", params, { oblast });

  const title = bg ? "Субсидии по област" : "Farm subsidies by province";
  // Localised: this string becomes the page's <meta name="description">, and a
  // Bulgarian page shipping an English description is what the SPA half of the SEO
  // contract is for. The prerendered half lives in scripts/prerender/routes.ts.
  const description = bg
    ? "Областта на получателя, не на земята: земеделските субсидии на ДФ „Земеделие“ по 28-те области — карта, класация и дялове."
    : "The recipient's province, not the land's: State Fund Agriculture farm subsidies across Bulgaria's 28 provinces — map, ranking and shares.";

  const rows = data?.byOblast ?? [];
  const top = rows[0];
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
        currentKey="subsidies_places_nav"
        className="mt-5"
      />
      <section aria-label={title} className="my-4">
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          {bg
            ? "Картата показва областта на ПОЛУЧАТЕЛЯ така, както я публикува ДФ „Земеделие“ — за фирма това е седалището по регистрация, а не мястото, където се обработва земята. Затова София (столица) е сред водещите области: там са регистрирани дружества, чиито ниви са другаде."
            : "The map shows the province of the RECIPIENT as published by the State Fund Agriculture — for a company that is its registered seat, not where the land is farmed. That is why Sofia (capital) ranks near the top: companies are registered there whose fields are elsewhere."}
        </p>

        <AgriScopePicker className="mb-3" />

        <AgriScopeFallback gate={gate}>
          {data && (
            <>
              <DashboardSection
                id="subsidies-places-headline"
                title={bg ? "Накратко" : "At a glance"}
                icon={MapPin}
                subtitle={scopeLabel}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <StatCard label={bg ? "Области" : "Provinces"}>
                    <span className="text-2xl font-bold tabular-nums">
                      {rows.length.toLocaleString(nloc)}
                    </span>
                  </StatCard>
                  <StatCard
                    label={bg ? "Най-голяма област" : "Largest province"}
                    hint={
                      bg
                        ? "По област на получателя, не по местоположение на земята."
                        : "By the recipient's province, not by where the land is."
                    }
                  >
                    <span className="text-lg font-bold">
                      {top?.oblast ?? "—"}
                    </span>
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {top ? formatEurCompact(top.totalEur, L) : ""}
                    </div>
                  </StatCard>
                  <StatCard
                    label={bg ? "Дял на първите три" : "Top three share"}
                    hint={
                      bg
                        ? "Сборът от дяловете на трите най-големи области, от изплатеното за периода."
                        : "The summed share of the three largest provinces, out of everything paid in the period."
                    }
                  >
                    <span className="text-2xl font-bold tabular-nums">
                      {rows.length
                        ? `${rows
                            .slice(0, 3)
                            .reduce((a, r) => a + r.share, 0)
                            .toLocaleString(nloc, {
                              maximumFractionDigits: 1,
                            })}%`
                        : "—"}
                    </span>
                  </StatCard>
                </div>
              </DashboardSection>

              <DashboardSection
                id="subsidies-places-map"
                title={bg ? "Карта" : "Map"}
                icon={MapPin}
                subtitle={
                  bg ? "по област на получателя" : "by the recipient's province"
                }
              >
                <div
                  data-og="subsidies-places-map"
                  className="rounded-xl border bg-card p-4 shadow-sm"
                >
                  <AgriOblastMap
                    rows={rows}
                    locale={L}
                    bg={bg}
                    onSelectOblast={(name) => navigate(browseTo(name))}
                  />
                  <p className="mt-3 text-xs text-muted-foreground">
                    {/* It NAVIGATES. The first draft said „за да видиш плащанията ѝ
                        в таблицата", which promises an in-page filter of the ranking
                        below — the click leaves the page for the payments browser. */}
                    {bg
                      ? "Кликни върху област, за да отвориш плащанията ѝ в таблицата с всички плащания."
                      : "Click a province to open its payments in the full payments table."}
                  </p>
                </div>
              </DashboardSection>

              <DashboardSection
                id="subsidies-places-table"
                title={bg ? "Класация" : "Ranking"}
                icon={MapPin}
                subtitle={scopeLabel}
              >
                {rows.length === 0 ? (
                  <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
                    {bg
                      ? "За този период ДФ „Земеделие“ не публикува разбивка по област."
                      : "The State Fund Agriculture publishes no province breakdown for this period."}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border bg-card">
                    <table className="w-full text-sm">
                      <caption className="sr-only">
                        {bg
                          ? "Изплатени земеделски субсидии по област на получателя, подредени по сума."
                          : "Farm subsidies paid, by the recipient's province, ordered by amount."}
                      </caption>
                      <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th scope="col" className="w-10 px-3 py-2 text-left">
                            #
                          </th>
                          <th scope="col" className="px-3 py-2 text-left">
                            {bg ? "Област" : "Province"}
                          </th>
                          <th scope="col" className="px-3 py-2 text-right">
                            {bg ? "Изплатено" : "Paid"}
                          </th>
                          <th scope="col" className="px-3 py-2 text-right">
                            {/* The denominator, named in the header rather than left
                                to the reader: this is a share of the period's total,
                                not of the corpus. */}
                            {bg ? "Дял от периода" : "Share of period"}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {rows.map((r, i) => (
                          <tr key={r.oblast}>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {i + 1}
                            </td>
                            <td className="px-3 py-2">
                              <Link
                                to={browseTo(r.oblast)}
                                className="font-medium hover:underline"
                              >
                                {r.oblast}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">
                              {formatEur(r.totalEur, L)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {r.share.toLocaleString(nloc, {
                                maximumFractionDigits: 1,
                              })}
                              %
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("data_source")}: {data.generatedFrom}
                </p>
              </DashboardSection>
            </>
          )}
        </AgriScopeFallback>
      </section>
    </>
  );
};
