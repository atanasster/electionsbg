// /subsidies/coverage — what this corpus does and does not contain.
//
// docs/plans/subsidies-hub-v1.md §6 and §9. The one page whose job is to stop the
// rest of the module being read as more complete than it is. Four things it states
// plainly, each measured rather than asserted:
//
//   1. FOUR YEARS ARE MISSING AT SOURCE. 2014, 2018 and 2019 have no sheet on the
//      open-data portal and 2020 serves zero rows. A „по година" chart that plots
//      eight bars with no gap invites the reader to conclude the money stopped.
//   2. TWO PROVENANCES, ONE SERIES. 2015-2023 come from the egov portal, 2024-2025
//      from the Fund's СЕУ register, and the no-ЕИК share breaks across exactly
//      that seam.
//   3. THE PAYING AGENCY IS EXCLUDED from every ranking — its „subsidies" are
//      technical assistance and public storage, not farm money received.
//   4. „ALL" MEANS DIFFERENT THINGS on different pages of this site, and the one
//      place that can say so is here.

import { type FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Database } from "lucide-react";
import { Title } from "@/ux/Title";
import { GovernanceBreadcrumb } from "@/screens/components/GovernanceBreadcrumb";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { useAgriOverview } from "@/data/agri/useAgriOverview";
import { AGRI_FINANCIAL_YEARS } from "@/data/agri/constants";
import { agriLabel } from "@/data/agri/labels";
import { formatEur } from "@/lib/currency";

/** Every financial year the CAP corpus could in principle cover, 2014 onward. */
/** Exported so the /subsidies coverage TILE derives its denominator and its gap list from the
 *  same floor this page does. Hardcoding „от 12 години" on the tile meant that the day ДФЗ
 *  publishes 2026 it would read „9 от 12" while this page said 9 of 13. */
export const FIRST_POSSIBLE_YEAR = 2014;

export const SubsidiesCoverageScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;

  // ALWAYS the all-years payload: this page is about the corpus, not about a window,
  // so it deliberately ignores `?pscope` and carries no scope picker. A coverage page
  // that changed its answer with the pill would be describing the pill.
  //
  // ⚠️ BUT IT STILL NEEDS THE FOUR-STATE DISTINCTION, and having no picker is exactly
  // why it nearly went without one. The seven sibling sub-pages inherit it from
  // `AgriScopeFallback`; this page has no scope, so it fell outside that arrangement —
  // and outside `scopeContract.test.ts`, whose consumer set is „files rendering the
  // shared picker".
  //
  // What that cost: `data?.years ?? AGRI_FINANCIAL_YEARS` and `(data?.years ?? []).length`
  // turn a FAILED or PAUSED fetch into assertions about the corpus. The footer read
  // „0 покрити финансови години" and the year grid rendered a coverage picture invented
  // from a client constant — on the one page whose stated job is to stop the rest of the
  // module being read as more complete than it is. Absence of a payload is not evidence
  // about ДФЗ.
  const { data, isError, isSuccess, fetchStatus, refetch } =
    useAgriOverview("all");
  const paused = fetchStatus === "paused";
  // No `noData` arm: the 'all' key always exists while the corpus does, so a 200-null here
  // means the loader never ran — which is a failure to report, not a corpus with no years.
  const failed = !data && (isError || paused || isSuccess);

  const covered = new Set(data?.years ?? AGRI_FINANCIAL_YEARS);
  const lastCovered = Math.max(...(data?.years ?? AGRI_FINANCIAL_YEARS));
  const allYears: number[] = [];
  for (let y = FIRST_POSSIBLE_YEAR; y <= lastCovered; y++) allYears.push(y);
  const missing = allYears.filter((y) => !covered.has(y));
  const byYear = new Map(
    (data?.totalsByYear ?? []).map((r) => [r.year, r] as const),
  );

  const title = bg ? "Обхват и източници" : "Coverage and sources";
  const description = bg
    ? "Кои години покрива корпусът със земеделски субсидии, кои липсват в източника и къде минава смяната на регистъра."
    : "Which years the farm-subsidy corpus covers, which are missing at source, and where the register changes.";

  return (
    <>
      <Title description={description}>{title}</Title>
      <GovernanceBreadcrumb
        sectionKey="agri_subsidies_nav"
        sectionTo="/subsidies"
        currentKey="subsidies_coverage_nav"
        className="mt-5"
      />
      <section aria-label={title} className="my-4">
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
          {bg
            ? "Всички числа в раздела „Земеделски субсидии“ идват от два публични регистъра на ДФ „Земеделие“. Тази страница казва какво има в тях и какво няма — за да не се чете липса в източника като липса на плащания."
            : "Every figure in the farm-subsidies section comes from two public registers of the State Fund Agriculture. This page says what is in them and what is not — so a gap in the source is not read as a gap in the payments."}
        </p>

        {/* The failure card comes BEFORE the year grid, and replaces it. Rendering the grid
            from `AGRI_FINANCIAL_YEARS` when the payload never arrived would draw a coverage
            picture from a client constant — a claim about ДФЗ's registers sourced from this
            repo. The one page that must not do that is this one. */}
        {failed && (
          <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground shadow-sm">
            <p className={paused ? "" : "mb-3"}>
              {paused
                ? bg
                  ? "Данните за обхвата още не са заредени — изчакваме връзката. Ще опитаме отново автоматично."
                  : "The coverage data hasn't loaded yet — waiting for the connection. It will retry automatically."
                : bg
                  ? "Обхватът не се зареди, така че не можем да кажем кои години ги има. Обикновено е временно."
                  : "The coverage data failed to load, so we cannot say which years exist. This is usually temporary."}
            </p>
            {/* No retry while paused — React Query refuses to run one and resumes by itself.
                Same rule as AgriScopeFallback, which this page cannot use (it has no scope). */}
            {!paused && (
              <button
                type="button"
                onClick={() => void refetch()}
                className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
              >
                {agriLabel.tryAgain(bg)}
              </button>
            )}
          </div>
        )}

        {!failed && (
          <>
            <DashboardSection
              id="subsidies-coverage-years"
              title={bg ? "Покрити години" : "Years covered"}
              icon={Database}
            >
              <div
                data-og="subsidies-coverage"
                className="overflow-x-auto rounded-md border bg-card"
              >
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left">
                        {agriLabel.financialYear(bg)}
                      </th>
                      <th scope="col" className="px-3 py-2 text-left">
                        {bg ? "Източник" : "Source"}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right">
                        {agriLabel.paid(bg)}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {allYears.map((y) => {
                      const row = byYear.get(y);
                      const isMissing = !covered.has(y);
                      return (
                        <tr key={y} className={isMissing ? "opacity-70" : ""}>
                          <td className="px-3 py-2 tabular-nums">{y}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {isMissing
                              ? bg
                                ? "няма данни в източника"
                                : "no data in the source"
                              : y >= 2024
                                ? bg
                                  ? "СЕУ на ДФЗ"
                                  : "Fund e-services register"
                                : bg
                                  ? "Портал за отворени данни"
                                  : "Open-data portal"}
                          </td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">
                            {row ? formatEur(row.totalEur, L) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
                {bg
                  ? `Липсват ${missing.join(", ")}. Това е празнота В ИЗТОЧНИКА, не в плащанията: порталът за отворени данни няма таблици за ${missing.slice(0, -1).join(", ")}, а за ${missing[missing.length - 1]} връща нула редове. Затова графиките по година показват прекъсване, а не непрекъсната поредица.`
                  : `Missing: ${missing.join(", ")}. That is a gap IN THE SOURCE, not in the payments: the open-data portal has no tables for ${missing.slice(0, -1).join(", ")}, and returns zero rows for ${missing[missing.length - 1]}. That is why the by-year charts show a break rather than a continuous series.`}
              </p>
            </DashboardSection>

            <DashboardSection
              id="subsidies-coverage-sources"
              title={bg ? "Двата регистъра" : "The two registers"}
              icon={Database}
            >
              <div className="space-y-3 rounded-xl border bg-card p-4 text-sm shadow-sm">
                <p>
                  {bg
                    ? "Поредицата е съшита от два източника и те не се държат еднакво. Най-видимата разлика е в идентификаторите: до 2023 фирмите почти винаги идват с ЕИК, а от 2024 значителна част от корпоративните плащания се публикуват без него."
                    : "The series is stitched from two sources and they do not behave alike. The most visible difference is in identifiers: until 2023 companies almost always carry an ЕИК, while from 2024 a substantial share of corporate payments is published without one."}
                </p>
                <p className="text-muted-foreground">
                  {bg
                    ? "Измерено: явните фирми без ЕИК са под 4 хил. евро годишно до 2023 и €149 млн. / €196 млн. през 2024 и 2025. Затова ръстът на непроследимите пари не бива да се чете направо като промяна в получателите — "
                    : "Measured: plainly-corporate payments with no ЕИК are under €4k a year until 2023, and €149m / €196m in 2024 and 2025. So the rise in untraceable money must not be read directly as a change in who receives it — "}
                  <Link
                    to="/subsidies/untraceable"
                    className="text-primary hover:underline"
                  >
                    {bg ? "виж разбивката" : "see the breakdown"}
                  </Link>
                  .
                </p>
              </div>
            </DashboardSection>

            <DashboardSection
              id="subsidies-coverage-caveats"
              title={bg ? "Какво още да знаете" : "Other things to know"}
              icon={Database}
            >
              <ul className="space-y-3 rounded-xl border bg-card p-4 text-sm shadow-sm">
                <li>
                  <strong>
                    {bg ? "Изплатено, не договорено." : "Paid, not contracted."}
                  </strong>{" "}
                  {bg
                    ? "Един ред е плащане по една схема за една финансова година, а не годишен доход на стопанството — един получател може да има десетки редове за една година."
                    : "A row is one payment under one scheme for one financial year, not a farm's annual income — one recipient can hold dozens of rows in a single year."}
                </li>
                <li>
                  <strong>
                    {bg
                      ? "Самият Фонд е изключен от класациите."
                      : "The Fund itself is excluded from the rankings."}
                  </strong>{" "}
                  {bg
                    ? "ДФ „Земеделие“ (ЕИК 121100421) се появява в корпуса като получател по мерки за техническа помощ и публично складиране. Това не е получена земеделска подкрепа и той няма страница, на която да се стигне, затова е извън всяка класация — но редовете му остават в пълната таблица."
                    : "The State Fund Agriculture (ЕИК 121100421) appears in the corpus as a payee under technical-assistance and public-storage measures. That is not farm support received and it has no page to land on, so it is outside every ranking — though its rows remain in the full table."}
                </li>
                <li>
                  <strong>
                    {bg
                      ? "Областта е на получателя, не на земята."
                      : "The province is the recipient's, not the land's."}
                  </strong>{" "}
                  {bg
                    ? "За фирма това е седалището по регистрация. Затова София (столица) е сред водещите области по земеделска субсидия."
                    : "For a company that is its registered seat. That is why Sofia (capital) ranks among the leading provinces for farm subsidy."}
                </li>
                <li>
                  <strong>
                    {bg
                      ? "„Всички години“ тук не значи същото като на други страници."
                      : "“All years” here does not mean what it means elsewhere."}
                  </strong>{" "}
                  {bg
                    ? "В този раздел „всички години“ е целият корпус (осемте покрити финансови години). На хъба „Държавни сектори“ същата дума показва изплатеното през ПОСЛЕДНАТА година, защото там показателят е годишен. И двете са верни; не са едно и също число."
                    : "In this section “all years” is the whole corpus (the eight covered financial years). On the “State sectors” hub the same word shows the LATEST year's payout, because that headline is an annual figure. Both are correct; they are not the same number."}
                </li>
              </ul>
            </DashboardSection>
          </>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          {t("data_source")}: {data?.generatedFrom ?? "ДФ „Земеделие“"} ·{" "}
          {bg
            ? `${data ? `${data.years.length} покрити финансови години, ${formatEur(data.headline.totalEur, L)} общо` : "обхватът не е зареден"}`
            : `${data ? `${data.years.length} financial years covered, ${formatEur(data.headline.totalEur, L)} in total` : "coverage not loaded"}`}{" "}
          ·{" "}
          <a
            href="https://data.egov.bg/"
            target="_blank"
            rel="noreferrer nofollow"
            className="text-primary hover:underline"
          >
            data.egov.bg
          </a>{" "}
          ·{" "}
          <a
            href="https://seu.dfz.bg/"
            target="_blank"
            rel="noreferrer nofollow"
            className="text-primary hover:underline"
          >
            seu.dfz.bg
          </a>
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {bg
            ? `Селекторът за обхват липсва на тази страница нарочно: тя описва корпуса, а не прозорец в него. Годините, които останалите страници предлагат, са ${AGRI_FINANCIAL_YEARS.join(", ")}.`
            : `This page carries no scope picker on purpose: it describes the corpus rather than a window into it. The years the other pages offer are ${AGRI_FINANCIAL_YEARS.join(", ")}.`}
        </p>
      </section>
    </>
  );
};
