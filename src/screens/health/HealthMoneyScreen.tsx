// /sector/health/money — the money the health sector RUNS: НЗОК's execution,
// МЗ's budget, the EU funds of the roster's institutions and the activity the
// fund pays for. Plan: docs/plans/health-hub-v1.md §3 (T5 deepens it).
//
// „БЕЗ ПЕРИОД" — no ScopeControl: B1 execution, the budget law and ИСУН lifetime
// figures carry their own years.
//
// ⚠ BASES, NEVER SUMMED: НЗОК's cash execution (B1) and МЗ's appropriation are
// different instruments, and part of МЗ's line is the state transfer that funds
// НЗОК — adding them counts that money twice. ИСУН grant aid is a third basis.
//
// ⚠ A3: B1's „приходи" is ЕБК section А — the fund's OWN revenue. The state
// transfer is section В, and revenue − expenditure is NOT a balance: the form's
// own balance (section Г) is rendered where B1 states it.
//
// Fragment ids: #nzok-budget #mz-budget #funds #activity, and only those.

import { FC, ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Euro, Landmark, Wallet } from "lucide-react";
import { isBg } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { ChartGhost } from "@/ux/motion/ChartGhost";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { ministryEurSeries } from "@/data/budget/ministrySeries";
// Generic over a set of EIKs (ИСУН grant basis) — nothing in it is education's.
import { useEduFunds, type EduFundOp } from "@/data/edu/useEduSector";
import { useHealthHubStats, type HealthHubStats } from "@/data/health/hubStats";
import { ProgrammeList } from "@/screens/components/funds/ProgrammeList";
import { tidyDots } from "@/lib/tidyDots";
import { HEALTH_SECTOR_EIKS, MZ_BUDGET_NODE } from "@/lib/healthReferenceData";
import { NzokActivityTile } from "@/screens/components/procurement/nzok/NzokActivityTile";
import { NzokPathwayTreeTile } from "@/screens/components/procurement/nzok/NzokPathwayTreeTile";
import { HealthPageFrame } from "./HealthPageFrame";
import { HealthNote } from "./HealthNote";
import { healthEntityName, successorOf } from "./healthSectorData";

const head = (Icon: FC<{ className?: string }>, text: string) => (
  <CardHeader className="pb-2">
    <CardTitle className="text-base flex items-center gap-2">
      <Icon className="h-4 w-4" />
      {text}
    </CardTitle>
  </CardHeader>
);

const Bars: FC<{ rows: { key: string; label: string; eur: number }[] }> = ({
  rows,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const max = Math.max(...rows.map((r) => r.eur), 1);
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2 text-xs">
          <span className="w-10 tabular-nums text-muted-foreground">
            {r.label}
          </span>
          <div className="h-2 flex-1 rounded bg-muted">
            <div
              className="h-2 rounded bg-primary/70"
              style={{ width: `${(r.eur / max) * 100}%` }}
            />
          </div>
          <span className="w-20 text-right tabular-nums">
            {formatEurCompact(r.eur, lang)}
          </span>
        </li>
      ))}
    </ul>
  );
};

/** #nzok-budget — НЗОК's B1 cash expenditure by year, December YTD. */
const NzokBudgetCard: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: s, isLoading, isError } = useHealthHubStats();
  if (isLoading) return <ChartGhost className="h-[200px]" />;
  if (isError || !s?.nzokByYear.length)
    return (
      <HealthNote>
        {bg
          ? "Изпълнението на бюджета на НЗОК не можа да се зареди."
          : "НЗОК's budget execution could not be loaded."}
      </HealthNote>
    );
  const eur = (v: number) => formatEurCompact(v, lang);
  const n = s.nzok;
  return (
    <Card>
      {head(Wallet, bg ? "Бюджетът на касата" : "The fund's budget")}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <Bars
          rows={s.nzokByYear.map((y) => ({
            key: String(y.year),
            label: String(y.year),
            eur: y.expenditureEur,
          }))}
        />
        <p className="text-muted-foreground">
          {tidyDots(
            [
              bg
                ? `През ${s.year} г. касата е изразходвала ${eur(n.expenditureEur)}.`
                : `In ${s.year} the fund spent ${eur(n.expenditureEur)}.`,
              n.revenueEur != null
                ? bg
                  ? ` Собствените ѝ приходи — главно здравноосигурителните вноски — са ${eur(n.revenueEur)}`
                  : ` Its own revenue — mainly health-insurance contributions — was ${eur(n.revenueEur)}`
                : "",
              n.revenueEur != null && n.transfersEur != null
                ? bg
                  ? `, а трансферите от държавния бюджет — ${eur(n.transfersEur)}.`
                  : `, and the transfers from the state budget ${eur(n.transfersEur)}.`
                : n.revenueEur != null
                  ? "."
                  : "",
              n.balanceEur != null
                ? bg
                  ? ` Салдото по отчета е ${eur(n.balanceEur)}.`
                  : ` The report's own balance is ${eur(n.balanceEur)}.`
                : "",
            ].join(""),
          )}
        </p>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Касови разходи по месечния отчет B1 на НЗОК, към декември на всяка година. Собствените приходи не включват трансфера от държавата, затова „приходи минус разходи“ не е салдо — салдото е това, което отчетът сам посочва."
            : "Cash expenditure from НЗОК's monthly B1 report, as of December each year. Own revenue excludes the state transfer, so „revenue minus expenditure“ is not a balance — the balance is the one the report itself states."}
        </p>
      </CardContent>
    </Card>
  );
};

/** #mz-budget — МЗ's own appropriation by year. */
const MzBudgetCard: FC = () => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const { data, isLoading, isError } = useBudgetMinistryRollup(MZ_BUDGET_NODE);
  const years = ministryEurSeries(data?.years);
  if (isLoading) return <ChartGhost className="h-[200px]" />;
  if (isError || !years.length)
    return (
      <HealthNote>
        {bg
          ? "Данните за бюджета на МЗ не можаха да се заредят."
          : "The Ministry of Health budget data could not be loaded."}
      </HealthNote>
    );
  return (
    <Card>
      {head(
        Landmark,
        bg ? "Бюджетът на министерството" : "The ministry's budget",
      )}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <Bars
          rows={years.map((y) => ({
            key: String(y.fiscalYear),
            label: String(y.fiscalYear),
            eur: y.eur,
          }))}
        />
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Бюджетът на Министерството на здравеопазването по закона за държавния бюджет. Не се събира с бюджета на касата: част от него е трансферът, с който държавата финансира НЗОК, и би се отчел два пъти."
            : "The Ministry of Health's line in the State Budget Law. Never added to the fund's budget: part of it is the transfer by which the state funds НЗОК, and it would be counted twice."}
        </p>
      </CardContent>
    </Card>
  );
};

/** Folds a retired EIK's grants into its successor's: one row per institution. */
const foldFunds = (rows: readonly EduFundOp[]): EduFundOp[] => {
  const out = new Map<string, EduFundOp>();
  for (const r of rows) {
    const eik = successorOf(r.eik);
    const a = out.get(eik);
    out.set(
      eik,
      a
        ? {
            ...a,
            grantEur: a.grantEur + r.grantEur,
            paidEur: a.paidEur + r.paidEur,
            projectCount: a.projectCount + r.projectCount,
          }
        : { ...r, eik },
    );
  }
  return [...out.values()].sort(
    (x, y) => y.grantEur - x.grantEur || x.eik.localeCompare(y.eik),
  );
};

/** #funds — ИСУН grant aid to the roster's institutions, lifetime. */
const FundsCard: FC<{
  funds: EduFundOp[];
  grantBasis: boolean;
  programmes: HealthHubStats["fundsByProgramme"];
}> = ({ funds, grantBasis, programmes }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  if (!grantBasis)
    return (
      <HealthNote>
        {bg
          ? "Еврофондовете на базата на безвъзмездната помощ още не са публикувани на сървъра."
          : "EU funds on the grant basis are not published on the server yet."}
      </HealthNote>
    );
  const total = funds.reduce((a, f) => a + f.grantEur, 0);
  const paid = funds.reduce((a, f) => a + f.paidEur, 0);
  const projects = funds.reduce((a, f) => a + f.projectCount, 0);
  if (!projects)
    return (
      <HealthNote>
        {bg
          ? "Няма договори по еврофондове за институциите в сектора."
          : "No EU-funds contracts for the sector's institutions."}
      </HealthNote>
    );
  return (
    <Card>
      {head(Euro, bg ? "Еврофондове" : "EU funds")}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <p>
          <span className="text-2xl font-bold tabular-nums">
            {formatEurCompact(total, lang)}
          </span>{" "}
          {bg
            ? `безвъзмездна помощ по ${formatInt(projects, lang)} договора в ИСУН на ${formatInt(funds.length, lang)} институции; изплатени досега ${tidyDots(`${formatEurCompact(paid, lang)}.`)}`
            : `of grant aid on ${formatInt(projects, lang)} ИСУН contracts of ${formatInt(funds.length, lang)} institutions; ${formatEurCompact(paid, lang)} paid so far.`}
        </p>
        <ul className="space-y-0.5 text-xs">
          {funds.slice(0, 10).map((f) => (
            <li key={f.eik} className="flex justify-between gap-2">
              <AwarderLink
                eik={f.eik}
                className="min-w-0 truncate hover:text-primary hover:underline"
              >
                {healthEntityName(f.eik, bg)}
              </AwarderLink>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatEurCompact(f.grantEur, lang)} ·{" "}
                {formatInt(f.projectCount, lang)}
              </span>
            </li>
          ))}
        </ul>
        {programmes?.length ? (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              {bg ? "По програми" : "By programme"}
            </div>
            <ProgrammeList rows={programmes} />
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `За целия период на ИСУН. Безвъзмездната помощ е друга база от поръчките — част от нея се харчи чрез поръчки, затова двете не се събират.${programmes?.length ? " Регистърът носи и програмите на ЕИП и Норвегия — отбелязани са в списъка по програми." : ""} Болниците не са в сектора и техните проекти не са тук.`
            : `Over the whole ИСУН period. Grant aid is a different basis from procurement — part of it is spent through procurement, so the two are never added.${programmes?.length ? " The register also carries the EEA and Norway programmes — they are marked in the list by programme." : ""} Hospitals are not in the sector and their projects are not here.`}
        </p>
      </CardContent>
    </Card>
  );
};

const Section: FC<{ id: string; children: ReactNode }> = ({ id, children }) => (
  <section id={id} className="scroll-mt-24 space-y-4">
    {children}
  </section>
);

export const HealthMoneyScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const { funds, grantBasis, isLoading, isError } =
    useEduFunds(HEALTH_SECTOR_EIKS);
  const { data: hub } = useHealthHubStats();
  const folded = useMemo(() => foldFunds(funds), [funds]);
  return (
    <HealthPageFrame
      title={{ bg: "Бюджетът и дейността", en: "The budget and the activity" }}
      description={{
        bg: "Изпълнението на бюджета на здравната каса, бюджетът на министерството, еврофондовете и дейността, за която касата плаща — всяко на своя база.",
        en: "The health fund's budget execution, the ministry's budget, the EU funds and the activity the fund pays for — each on its own basis.",
      }}
      scoped={false}
      ready={[funds]}
    >
      <Section id="nzok-budget">
        <NzokBudgetCard />
      </Section>
      <Section id="mz-budget">
        <MzBudgetCard />
      </Section>
      <Section id="funds">
        {isError ? (
          <HealthNote>
            {bg
              ? "Данните за еврофондовете не можаха да се заредят."
              : "The EU-funds data could not be loaded."}
          </HealthNote>
        ) : isLoading ? (
          <ChartGhost className="h-[200px]" />
        ) : (
          <FundsCard
            funds={folded}
            grantBasis={grantBasis}
            programmes={hub?.fundsByProgramme}
          />
        )}
      </Section>
      <Section id="activity">
        <NzokActivityTile />
        <NzokPathwayTreeTile />
      </Section>
    </HealthPageFrame>
  );
};
