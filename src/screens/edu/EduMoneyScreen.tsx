// /sector/edu/money — the money OUTSIDE public procurement: МОН's budget, the EU
// funds of the sector's institutions on the grant basis, and the research arm.
// Plan: docs/plans/edu-hub-v1.md §3 (T5 deepens each section).
//
// „БЕЗ ПЕРИОД" — no ScopeControl: the budget law and ИСУН lifetime figures carry
// their own years and are not filtered by parliament.
//
// ⚠ THREE BASES, NEVER SUMMED: the budget is МОН's own ЗДБ line (not the
// universities' subsidies, not the schools' delegated budgets); EU funds are
// ИСУН грант (БФП) to the same institutions; the research arm states БАН / ССА
// procurement and EU funds side by side, each labelled.
//
// Fragment ids: #budget #funds #research, and only those.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FlaskConical, Landmark, Euro } from "lucide-react";
import { isBg } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { ChartGhost } from "@/ux/motion/ChartGhost";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { ministryEurSeries } from "@/data/budget/ministrySeries";
import { useEduFunds, type EduFundOp } from "@/data/edu/useEduSector";
import { useEduHubStats } from "@/data/edu/hubStats";
import {
  EDU_BUDGET_NODE,
  EDU_SECTOR_EIKS,
  educationEntityByEik,
  educationUniverseOf,
} from "@/lib/educationReferenceData";
import { EduPageFrame } from "./EduPageFrame";
import { EduNote } from "./EduNote";
import { foldRetiredFunds } from "./eduSectorData";

const head = (Icon: FC<{ className?: string }>, text: string) => (
  <CardHeader className="pb-2">
    <CardTitle className="text-base flex items-center gap-2">
      <Icon className="h-4 w-4" />
      {text}
    </CardTitle>
  </CardHeader>
);

/** #budget — МОН's own budget line by year. */
const BudgetCard: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data, isLoading, isError } = useBudgetMinistryRollup(EDU_BUDGET_NODE);
  const years = ministryEurSeries(data?.years);
  if (isLoading) return <ChartGhost className="h-[200px]" />;
  if (isError || !years.length)
    return (
      <EduNote>
        {bg
          ? "Данните за бюджета на МОН не можаха да се заредят."
          : "The МОН budget data could not be loaded."}
      </EduNote>
    );
  const max = Math.max(...years.map((y) => y.eur), 1);
  return (
    <Card>
      {head(Landmark, bg ? "Бюджетът на МОН" : "МОН's budget")}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <ul className="space-y-1">
          {years.map((y) => (
            <li key={y.fiscalYear} className="flex items-center gap-2 text-xs">
              <span className="w-10 tabular-nums text-muted-foreground">
                {y.fiscalYear}
              </span>
              <div className="h-2 flex-1 rounded bg-muted">
                <div
                  className="h-2 rounded bg-primary/70"
                  style={{ width: `${(y.eur / max) * 100}%` }}
                />
              </div>
              <span className="w-20 text-right tabular-nums">
                {formatEurCompact(y.eur, lang)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Само бюджетът на министерството по закона за държавния бюджет — без субсидиите на държавните университети (те са отделни разпоредители) и без делегираните бюджети на общинските училища. Не се събира с поръчките."
            : "The ministry's own line in the State Budget Law alone — without the state universities' subsidies (separate spending units) and without the municipal schools' delegated budgets. Not added to procurement."}
        </p>
      </CardContent>
    </Card>
  );
};

const FundsList: FC<{ rows: EduFundOp[]; limit: number }> = ({
  rows,
  limit,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <ul className="space-y-0.5 text-xs">
      {rows.slice(0, limit).map((f) => (
        <li key={f.eik} className="flex justify-between gap-2">
          <AwarderLink
            eik={f.eik}
            className="min-w-0 truncate hover:text-primary hover:underline"
          >
            {educationEntityByEik(f.eik)?.name ?? f.eik}
          </AwarderLink>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {formatEurCompact(f.grantEur, lang)} ·{" "}
            {formatInt(f.projectCount, lang)}
          </span>
        </li>
      ))}
    </ul>
  );
};

/** #funds — ИСУН grant aid to the sector's institutions, lifetime. */
const FundsCard: FC<{
  funds: EduFundOp[];
  grantBasis: boolean;
}> = ({ funds, grantBasis }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  if (!grantBasis)
    return (
      <EduNote>
        {bg
          ? "Еврофондовете на базата на безвъзмездната помощ още не са публикувани на сървъра."
          : "EU funds on the grant basis are not published on the server yet."}
      </EduNote>
    );
  const total = funds.reduce((a, f) => a + f.grantEur, 0);
  const paid = funds.reduce((a, f) => a + f.paidEur, 0);
  const projects = funds.reduce((a, f) => a + f.projectCount, 0);
  if (!projects)
    return (
      <EduNote>
        {bg
          ? "Няма договори по еврофондове за институциите в сектора."
          : "No EU-funds contracts for the sector's institutions."}
      </EduNote>
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
            ? `безвъзмездна помощ по ${formatInt(projects, lang)} договора в ИСУН на ${formatInt(funds.length, lang)} институции; изплатени досега ${formatEurCompact(paid, lang)}.`
            : `of grant aid on ${formatInt(projects, lang)} ИСУН contracts of ${formatInt(funds.length, lang)} institutions; ${formatEurCompact(paid, lang)} paid so far.`}
        </p>
        <FundsList rows={funds} limit={10} />
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "За целия период на ИСУН. Безвъзмездната помощ е друга база от поръчките — част от нея се харчи чрез поръчки, затова двете не се събират."
            : "Over the whole ИСУН period. Grant aid is a different basis from procurement — part of it is spent through procurement, so the two are never added."}
        </p>
      </CardContent>
    </Card>
  );
};

/** #research — БАН and the Agricultural Academy, procurement and EU funds side
 *  by side, each on its own basis. */
const ResearchCard: FC<{ funds: EduFundOp[]; grantBasis: boolean }> = ({
  funds,
  grantBasis,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: hub } = useEduHubStats();
  const arms = (["research_ban", "research_ssa"] as const).map((u) => {
    const proc = hub?.universes.find((x) => x.universe === u);
    const f = funds.filter((x) => educationUniverseOf(x.eik) === u);
    return {
      u,
      label:
        u === "research_ban"
          ? bg
            ? "БАН"
            : "Academy of Sciences (БАН)"
          : bg
            ? "Селскостопанска академия"
            : "Agricultural Academy",
      procEur: proc?.eur ?? null,
      procContracts: proc?.contracts ?? null,
      grantEur: grantBasis ? f.reduce((a, x) => a + x.grantEur, 0) : null,
      projects: f.reduce((a, x) => a + x.projectCount, 0),
    };
  });
  return (
    <Card>
      {head(FlaskConical, bg ? "Науката" : "Research")}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <ul className="space-y-2">
          {arms.map((a) => (
            <li key={a.u}>
              <p className="font-medium">{a.label}</p>
              <p className="text-xs text-muted-foreground">
                {a.procEur != null
                  ? bg
                    ? `Поръчки за целия период: ${formatEurCompact(a.procEur, lang)} по ${formatInt(a.procContracts ?? 0, lang)} договора.`
                    : `Procurement over the whole period: ${formatEurCompact(a.procEur, lang)} over ${formatInt(a.procContracts ?? 0, lang)} contracts.`
                  : null}{" "}
                {a.grantEur != null
                  ? bg
                    ? `Еврофондове: ${formatEurCompact(a.grantEur, lang)} безвъзмездна помощ по ${formatInt(a.projects, lang)} договора.`
                    : `EU funds: ${formatEurCompact(a.grantEur, lang)} of grant aid on ${formatInt(a.projects, lang)} contracts.`
                  : null}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Поръчките и еврофондовете са на различна база и не се събират. Националното финансиране на научни проекти (Фонд „Научни изследвания“) не е в тези данни."
            : "Procurement and EU funds sit on different bases and are not added. National research-project funding (the Science Fund) is not in these data."}
        </p>
      </CardContent>
    </Card>
  );
};

export const EduMoneyScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const { funds, grantBasis, isLoading, isError } =
    useEduFunds(EDU_SECTOR_EIKS);
  const sorted = useMemo(
    () => foldRetiredFunds(funds).sort((a, b) => b.grantEur - a.grantEur),
    [funds],
  );
  const failed = bg
    ? "Данните за еврофондовете не можаха да се заредят."
    : "The EU-funds data could not be loaded.";
  return (
    <EduPageFrame
      title={{
        bg: "Парите извън поръчките",
        en: "The money outside procurement",
      }}
      description={{
        bg: "Бюджетът на МОН, европейските средства на институциите и науката — всяко на своя база, не се събират с поръчките.",
        en: "МОН's budget, the institutions' EU funds and research — each on its own basis, never added to procurement.",
      }}
      scoped={false}
      ready={[funds]}
    >
      <section id="budget" className="scroll-mt-24">
        <BudgetCard />
      </section>
      <section id="funds" className="scroll-mt-24">
        {isError ? (
          <EduNote>{failed}</EduNote>
        ) : isLoading ? (
          <ChartGhost className="h-[200px]" />
        ) : (
          <FundsCard funds={sorted} grantBasis={grantBasis} />
        )}
      </section>
      <section id="research" className="scroll-mt-24">
        {isError ? (
          <EduNote>{failed}</EduNote>
        ) : isLoading ? (
          <ChartGhost className="h-[160px]" />
        ) : (
          <ResearchCard funds={sorted} grantBasis={grantBasis} />
        )}
      </section>
    </EduPageFrame>
  );
};
