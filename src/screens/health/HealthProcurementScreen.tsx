// /sector/health/procurement — what the health fund, the ministry and its bodies
// buy, how it is awarded and who wins it. Plan: docs/plans/health-hub-v1.md §3.
//
// SCOPED (ScopeControl) and universe-filterable (?universe=, validated on read
// against HEALTH_UNIVERSE_PARAMS — an unknown value is the whole sector, never an
// empty page). Fragment ids: #spine #frameworks #competition #contractors
// #top-contracts #bodies, and only those.
//
// ⚠ D3: МЗ's central framework agreements are CEILINGS, not money spent (087's
// joint_kind='framework', ceiling/N shares). Every request here asks the server
// to leave them out and reads its echo — a database whose 061 predates the
// switch returns totals WITH them, and the page then says so in #frameworks
// rather than pretend.
//
// Bases kept apart:
//   • € by year / supplier — the group model (consortium members carry €0);
//   • per-body COUNTS and single-bid — the ex-member rollup, beside the national
//     ex-member pair for the SAME window (sector-dashboard §3).

import { FC, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Building2,
  CalendarRange,
  Layers3,
  Repeat,
  Scale,
  Trophy,
} from "lucide-react";
import { isBg } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { useNationalCompetition } from "@/data/procurement/useNationalCompetition";
import { useHealthHubStats } from "@/data/health/hubStats";
import {
  useHealthGroupModel,
  useHealthRollup,
  useHealthTopContracts,
  type HealthModel,
} from "@/data/health/useHealthSector";
import {
  HEALTH_ENTITIES,
  HEALTH_SECTOR_EIKS,
  HEALTH_UNIVERSE_LABEL,
  type HealthUniverse,
} from "@/lib/healthReferenceData";
import {
  exMemberPair,
  othersShare,
  type CompetitionPair,
} from "@/screens/edu/eduSectorData";
import { HealthPageFrame } from "./HealthPageFrame";
import { HealthNote } from "./HealthNote";
import {
  foldBodies,
  healthEntityName,
  healthPct,
  parseUniverse,
  MIN_BID_KNOWN,
  universeCompetition,
  type HealthInstitutionRow,
} from "./healthSectorData";
import {
  BAND_TEXT as SHARED_BAND_TEXT,
  WELL_ABOVE,
  type Band,
} from "@/screens/transport/competitionBand";

/** The shared band colours; neutral inherits the muted line colour here. */
const BAND_TEXT: Record<Band, string> = { ...SHARED_BAND_TEXT, neutral: "" };

const sectionTitle = (Icon: FC<{ className?: string }>, text: string) => (
  <CardHeader className="pb-2">
    <CardTitle className="text-base flex items-center gap-2">
      <Icon className="h-4 w-4" />
      {text}
    </CardTitle>
  </CardHeader>
);

const uniLabel = (u: HealthUniverse, bg: boolean) =>
  bg ? HEALTH_UNIVERSE_LABEL[u].bg : HEALTH_UNIVERSE_LABEL[u].en;

/** #spine — € by signing year, framework ceilings excluded. */
const SpineTile: FC<{ model: HealthModel; exFramework: boolean }> = ({
  model,
  exFramework,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const years = model.years.filter((y) => y.totalEur > 0);
  if (!years.length)
    return (
      <HealthNote>
        {bg ? "Няма договори в периода." : "No contracts in the window."}
      </HealthNote>
    );
  const max = Math.max(...years.map((y) => y.totalEur), 1);
  return (
    <Card className="min-w-0">
      {sectionTitle(
        CalendarRange,
        bg ? "Поръчките по години" : "Procurement by year",
      )}
      <CardContent className="overflow-x-auto p-3 md:p-4 space-y-3">
        <div className="flex h-[180px] items-end gap-1.5">
          {years.map((y) => (
            <div
              key={y.year}
              className="flex min-w-[32px] flex-1 flex-col items-center justify-end gap-1"
              title={`${y.year}: ${formatEurCompact(y.totalEur, lang)}`}
            >
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {formatEurCompact(y.totalEur, lang)}
              </span>
              <div
                className="w-full rounded-t bg-primary/70"
                style={{ height: `${Math.max(3, (y.totalEur / max) * 140)}px` }}
              />
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {y.year}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          {exFramework
            ? bg
              ? "Сумите са текущата стойност на договорите след анекси, без тавана на рамковите споразумения — той е отделно, по-долу."
              : "The sums are the contracts' current value after annexes, without the framework agreements' ceilings — those are apart, below."
            : bg
              ? "Сумите са текущата стойност на договорите след анекси. Сървърът още не отделя рамковите споразумения, затова таванът им е включен."
              : "The sums are the contracts' current value after annexes. The server does not separate the framework agreements yet, so their ceiling is included."}
        </p>
      </CardContent>
    </Card>
  );
};

/** #frameworks — the ceilings on their own line: the window's, and by year for
 *  the whole period from the hub blob. */
const FrameworksCard: FC<{
  windowEur: number | undefined;
  windowCount: number | undefined;
  exFramework: boolean;
  /** The hub blob's by-year list is WHOLE-SECTOR, so it is hidden under a
   *  ?universe= filter rather than shown as if it were that group's. */
  wholeSector: boolean;
}> = ({ windowEur, windowCount, exFramework, wholeSector }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: hub } = useHealthHubStats();
  const years = wholeSector
    ? (hub?.byYear ?? []).filter((y) => y.frameworkCeilingEur > 0)
    : [];
  return (
    <Card>
      {sectionTitle(
        Layers3,
        bg ? "Рамковите споразумения" : "The framework agreements",
      )}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        {windowEur != null ? (
          <p>
            <span className="text-2xl font-bold tabular-nums">
              {formatEurCompact(windowEur, lang)}
            </span>{" "}
            {bg
              ? `таван на ${formatInt(windowCount ?? 0, lang)} дяла от рамкови споразумения в избрания период.`
              : `the ceiling of ${formatInt(windowCount ?? 0, lang)} framework-agreement shares in the selected window.`}
          </p>
        ) : null}
        {years.length ? (
          <>
            <p className="text-xs font-medium">
              {bg ? "За целия период, по години" : "Whole period, by year"}
            </p>
            <ul className="space-y-0.5 text-xs">
              {years.map((y) => (
                <li key={y.year} className="flex justify-between gap-2">
                  <span className="tabular-nums text-muted-foreground">
                    {y.year}
                  </span>
                  <span className="tabular-nums">
                    {formatEurCompact(y.frameworkCeilingEur, lang)}
                    <span className="text-muted-foreground">
                      {" "}
                      {bg ? "таван · " : "ceiling · "}
                      {formatEurCompact(y.eur, lang)}{" "}
                      {bg ? "договори" : "contracts"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Министерството сключва централни рамкови споразумения за лекарства и консумативи, по които после поръчват болниците. Регистърът записва всеки дял като равна част от тавана на споразумението — горна граница, не похарчени пари. Затова той не е в сумите на страницата."
            : "The ministry signs central framework agreements for medicines and consumables that the hospitals then order under. The register books each share as an equal part of the agreement's ceiling — an upper bound, not money spent. So it is not in this page's sums."}
          {exFramework
            ? ""
            : bg
              ? " Тази база данни още не ги отделя."
              : " This database does not separate them yet."}
        </p>
      </CardContent>
    </Card>
  );
};

/** #competition — the shown set's ex-member rate beside EVERY OTHER buyer's on
 *  the same window and basis, or no baseline at all. */
const CompetitionCard: FC<{
  rows: HealthInstitutionRow[];
  national: CompetitionPair | null;
  /** The rollup's own echo — never the page's request (D3). */
  exFramework: boolean;
}> = ({ rows, national, exFramework }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const known = rows.reduce((s, b) => s + b.bidKnownN, 0);
  const single = rows.reduce((s, b) => s + b.singleBidN, 0);
  const contracts = rows.reduce((s, b) => s + b.contractCount, 0);
  if (!known)
    return (
      <HealthNote>
        {bg
          ? "В избрания период няма договори с известен брой оферти."
          : "No contracts with a known bid count in the selected window."}
      </HealthNote>
    );
  const others = othersShare(national, single, known);
  const groups = universeCompetition(rows, others);
  return (
    <Card>
      {sectionTitle(Scale, bg ? "Конкуренция" : "Competition")}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <p>
          <span className="text-2xl font-bold tabular-nums">
            {healthPct(single / known, bg, 1)}
          </span>{" "}
          {bg
            ? `от ${formatInt(known, lang)} договора с известен брой оферти са с една оферта`
            : `of ${formatInt(known, lang)} contracts with a known bid count drew a single bid`}
          {others != null
            ? bg
              ? ` — при ${healthPct(others, bg, 1)} за всички останали възложители в същия период.`
              : ` — against ${healthPct(others, bg, 1)} for every other buyer in the same window.`
            : "."}
        </p>
        {groups.length > 1 ? (
          <ul className="space-y-0.5 text-xs">
            {groups.map((g) => (
              <li key={g.universe} className="flex justify-between gap-2">
                <span>{uniLabel(g.universe, bg)}</span>
                <span className="tabular-nums text-muted-foreground">
                  {g.share != null ? (
                    <>
                      <span className={`font-medium ${BAND_TEXT[g.band]}`}>
                        {healthPct(g.share, bg, 1)}
                      </span>{" "}
                      {bg ? "с една оферта" : "single-bid"} ·{" "}
                    </>
                  ) : null}
                  {formatInt(g.bidKnownN, lang)}{" "}
                  {bg ? "с известен брой оферти" : "with a known bid count"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-muted-foreground">
          {bg
            ? `Броят оферти е известен за ${healthPct(known / contracts, bg)} от ${formatInt(contracts, lang)} договора.`
            : `The bid count is known for ${healthPct(known / contracts, bg)} of ${formatInt(contracts, lang)} contracts.`}
        </p>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `И двете страни са без нулевите дялове на участниците в обединения; ${exFramework ? "страната на сектора е и без дяловете от рамкови споразумения" : "дяловете от рамкови споразумения са включени, защото базата данни още не ги отделя"}. Една оферта е сигнал за проверка, не доказателство — патентовани лекарства и ваксини често имат един възможен доставчик.`
            : `Both sides exclude the €0 shares of consortium members; ${exFramework ? "the sector's side also excludes framework-agreement shares" : "framework-agreement shares are included, because the database does not separate them yet"}. A single bid is a flag for review, not proof — patented medicines and vaccines often have one possible supplier.`}
        </p>
        {groups.length > 1 ? (
          <p className="text-[11px] text-muted-foreground/80">
            {others != null
              ? bg
                ? `Цветът на дела по групи сравнява с ${healthPct(others, bg, 1)} за всички останали възложители в същия период: зелено — до него, жълто — до ${Math.round(WELL_ABOVE * 100)} пункта над него, червено — повече. `
                : `The colour of each group's share compares with ${healthPct(others, bg, 1)} for every other buyer in the same window: green — at or below it, amber — up to ${Math.round(WELL_ABOVE * 100)} points above, red — further. `
              : ""}
            {bg
              ? `Група с по-малко от ${MIN_BID_KNOWN} договора с известен брой оферти не получава дял.`
              : `A group with fewer than ${MIN_BID_KNOWN} contracts with a known bid count gets no share.`}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};

/** #contractors — the top contractors, grouped by EIK (A4). */
const ContractorsCard: FC<{ model: HealthModel }> = ({ model }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const top = model.suppliers.slice(0, 15);
  if (!top.length)
    return (
      <HealthNote>
        {bg ? "Няма договори в периода." : "No contracts in the window."}
      </HealthNote>
    );
  return (
    <Card>
      {sectionTitle(Repeat, bg ? "Изпълнителите" : "The contractors")}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <ul className="space-y-0.5 text-xs">
          {top.map((s) => (
            <li key={s.eik} className="flex justify-between gap-2">
              <CompanyLink
                eik={s.eik}
                className="min-w-0 truncate hover:text-primary hover:underline"
              >
                {s.name}
              </CompanyLink>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatEurCompact(s.totalEur, lang)} ·{" "}
                {healthPct(s.totalEur / (model.totalEur || 1), bg)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "По ЕИК на изпълнителя — фирма, изписана по различен начин в различни договори, е един ред."
            : "By the contractor's ЕИК — a company spelled differently across contracts is one row."}
        </p>
      </CardContent>
    </Card>
  );
};

/** #top-contracts — the window's largest contracts, framework shares excluded. */
const TopContractsCard: FC<{ eiks: readonly string[] }> = ({ eiks }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { contracts, isLoading, isError } = useHealthTopContracts(eiks);
  if (isError)
    return (
      <HealthNote>
        {bg
          ? "Най-големите договори не можаха да се заредят."
          : "The largest contracts could not be loaded."}
      </HealthNote>
    );
  if (isLoading) return null;
  if (!contracts.length)
    return (
      <HealthNote>
        {bg ? "Няма договори в периода." : "No contracts in the window."}
      </HealthNote>
    );
  return (
    <Card>
      {sectionTitle(
        Trophy,
        bg ? "Най-големите договори" : "The largest contracts",
      )}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <ol className="space-y-1.5">
          {contracts.map((c) => (
            <li key={c.key} className="flex justify-between gap-3">
              <span className="min-w-0">
                <Link
                  to={`/procurement/contract/${c.key}`}
                  className="hover:text-primary hover:underline"
                >
                  {c.title}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  <AwarderLink
                    eik={c.awarderEik}
                    className="hover:text-primary hover:underline"
                  >
                    {healthEntityName(c.awarderEik, bg)}
                  </AwarderLink>
                  {" · "}
                  {c.contractorName} · {c.date.slice(0, 4)}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {formatEurCompact(c.amountEur, lang)}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
};

/** #bodies — every institution that awarded anything in the window, by group. */
const BodiesCard: FC<{
  rows: HealthInstitutionRow[];
  selected: HealthUniverse | null;
  /** The rollup's own echo — never the page's request (D3). */
  exFramework: boolean;
}> = ({ rows, selected, exFramework }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const [params] = useSearchParams();
  const hrefFor = (u: HealthUniverse | null) => {
    const p = new URLSearchParams(params);
    if (u) p.set("universe", u);
    else p.delete("universe");
    return `?${p.toString()}#bodies`;
  };
  const shown = rows.filter((r) => r.totalEur > 0 || r.contractCount > 0);
  return (
    <Card>
      {sectionTitle(Building2, bg ? "Институциите" : "The institutions")}
      <CardContent className="p-3 md:p-4 space-y-3 text-sm">
        <div className="flex flex-wrap gap-2 text-xs">
          {([null, "nzok", "mz", "mz_bodies"] as const).map((u) => (
            <Link
              key={u ?? "all"}
              to={hrefFor(u)}
              className={`rounded-full border px-2 py-0.5 hover:text-primary ${selected === u ? "border-primary font-semibold" : "border-border"}`}
            >
              {u ? uniLabel(u, bg) : bg ? "целият сектор" : "the whole sector"}
            </Link>
          ))}
        </div>
        {shown.length ? (
          <ul className="space-y-0.5 text-xs">
            {shown.map((r) => (
              <li key={r.eik} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  <AwarderLink
                    eik={r.eik}
                    className="hover:text-primary hover:underline"
                  >
                    {healthEntityName(r.eik, bg)}
                  </AwarderLink>
                  {r.universe ? (
                    <span className="ml-1.5 text-muted-foreground">
                      · {uniLabel(r.universe, bg)}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatEurCompact(r.totalEur, lang)} ·{" "}
                  {formatInt(r.contractCount, lang)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <HealthNote>
            {bg ? "Няма договори в периода." : "No contracts in the window."}
          </HealthNote>
        )}
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Сумите и броят договори са без нулевите дялове на участниците в обединения${exFramework ? " и без дяловете от рамкови споразумения" : "; дяловете от рамкови споразумения са включени, защото базата данни още не ги отделя"}. Болниците не са тук: те са дружества, на които касата плаща.`
            : `Sums and contract counts exclude the €0 shares of consortium members${exFramework ? " and the framework-agreement shares" : "; framework-agreement shares are included, because the database does not separate them yet"}. Hospitals are not here: they are companies the fund pays.`}
        </p>
      </CardContent>
    </Card>
  );
};

export const HealthProcurementScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const [params] = useSearchParams();
  const universe = parseUniverse(params.get("universe"));
  const eiks = useMemo(
    () =>
      universe
        ? HEALTH_ENTITIES.filter((e) => e.universe === universe).map(
            (e) => e.eik,
          )
        : HEALTH_SECTOR_EIKS,
    [universe],
  );
  const group = useHealthGroupModel(eiks);
  const rollup = useHealthRollup(eiks);
  const { data: national } = useNationalCompetition();
  const rows = useMemo(() => foldBodies(rollup.bodies), [rollup.bodies]);
  // Ex-member on both sides, or no baseline at all.
  const nationalPair = rollup.exMembers ? exMemberPair(national) : null;
  const model = group.model;
  const failed = bg
    ? "Данните за този раздел не можаха да се заредят."
    : "The data for this section could not be loaded.";

  return (
    <HealthPageFrame
      title={{
        bg: "Поръчките в здравеопазването",
        en: "Healthcare procurement",
      }}
      description={{
        bg: "Какво купуват здравната каса, Министерството на здравеопазването и неговите ведомства, как го възлагат и кой го печели — по години, с рамковите споразумения отделно.",
        en: "What the health fund, the Ministry of Health and its bodies buy, how they award it and who wins it — by year, with the framework agreements apart.",
      }}
      scoped
      ready={[model, rollup.bodies]}
      // Failures are reported PER SECTION: every hub link targets a fragment.
      status={{
        isLoading: group.isLoading || rollup.isLoading,
        isError: false,
      }}
    >
      {universe ? (
        <p className="text-sm text-muted-foreground">
          {bg
            ? `Показани са поръчките на групата „${uniLabel(universe, bg)}“.`
            : `Showing the procurement of the „${uniLabel(universe, bg)}“ group.`}
        </p>
      ) : null}
      <section id="spine" className="scroll-mt-24">
        {model ? (
          <SpineTile model={model} exFramework={group.exFramework} />
        ) : group.isError ? (
          <HealthNote>{failed}</HealthNote>
        ) : null}
      </section>
      <section id="frameworks" className="scroll-mt-24">
        <FrameworksCard
          windowEur={group.payload?.frameworkEur}
          windowCount={group.payload?.frameworkCount}
          exFramework={group.exFramework}
          wholeSector={universe === null}
        />
      </section>
      <section id="competition" className="scroll-mt-24">
        {rollup.isError ? (
          <HealthNote>{failed}</HealthNote>
        ) : (
          <CompetitionCard
            rows={rows}
            national={nationalPair}
            exFramework={rollup.exFramework}
          />
        )}
      </section>
      <section id="contractors" className="scroll-mt-24">
        {model ? (
          <ContractorsCard model={model} />
        ) : group.isError ? (
          <HealthNote>{failed}</HealthNote>
        ) : null}
      </section>
      <section id="top-contracts" className="scroll-mt-24">
        <TopContractsCard eiks={eiks} />
      </section>
      <section id="bodies" className="scroll-mt-24">
        {rollup.isError ? (
          <HealthNote>{failed}</HealthNote>
        ) : (
          <BodiesCard
            rows={rows}
            selected={universe}
            exFramework={rollup.exFramework}
          />
        )}
      </section>
    </HealthPageFrame>
  );
};
