// /sector/transport/procurement — what the transport bodies buy, how it is
// awarded and who wins it. Plan: docs/plans/transport-hub-v1.md §3.
//
// Sections carry the plan's ids and ONLY those (C6): #spine #modes #categories
// #competition #contractors #top-contracts #direct #risk. Each section OWNS its
// id and renders even when its source is empty or failed, so a hub link always
// lands. transportRegistry.test.ts fails a hub link to a fragment this page does
// not render.
//
// SCOPED (ScopeControl) and mode-filterable (?mode=, validated on read). Three
// blocks cannot follow a mode and say so — „за целия сектор": the mode split
// itself (it IS the split), and the whole-period lines read from the hub blob.
//
// Four bases are kept apart:
//   • € by function / year / supplier — the group model (members carry €0);
//   • per-body COUNTS and single-bid — the ex-member rollup (A2 / C1), never the
//     group model's member-inclusive byUnit;
//   • the mode split — re-attributed per D8, with the raw by-awarder split beside;
//   • „без обявление" — over the € whose method is KNOWN (A4), coverage named.

import { FC, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarRange, Repeat, ShieldAlert, Scale, Send } from "lucide-react";
import { isBg } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";
import { VikContractorHhiTile } from "@/screens/components/procurement/vik/VikContractorHhiTile";
import {
  nationalSingleBidExMembers,
  useNationalCompetition,
} from "@/data/procurement/useNationalCompetition";
import {
  useMinistryByCpv,
  useTransportGroupModel,
  useTransportRollup,
  type TransportBodyAgg,
} from "@/data/transport/useTransportSector";
import { useTransportHubStats } from "@/data/transport/hubStats";
import {
  TRANSPORT_EIK,
  TRANSPORT_GROUP_EIKS,
  TRANSPORT_INGROUP_CONTRACTORS,
  TRANSPORT_PUBLIC_CONTRACTORS,
  TRANSPORT_PUBLIC_CONTRACTOR_EIKS,
  TRANSPORT_SECTOR_EIKS,
  transportUniverseLabel,
  transportUniverseOf,
} from "@/lib/transportReferenceData";
import {
  directShareKnown,
  isPsoAward,
  reattributedModes,
  type TransportModel,
} from "@/lib/transportAttributes";
import type { GroupModelPayload } from "@/lib/awarderModel";
import { TransportPageFrame } from "./TransportPageFrame";
import { TransportModePicker } from "./TransportModePicker";
import { transportContractsHref, useTransportMode } from "./transportMode";
import { TransportModeSplitTile, type ModeRow } from "./TransportModeSplitTile";
import { TransportCategoryTile } from "./TransportCategoryTile";
import { TransportCompetitionTile } from "./TransportCompetitionTile";
import { TransportTopContractsTile } from "./TransportTopContractsTile";

const pctFmt = (v: number, bg: boolean, digits = 0) =>
  new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
    maximumFractionDigits: digits,
  }).format(v * 100) + "%";

/** A block whose source failed or is empty says so, rather than vanishing. */
const Note: FC<{ children: string }> = ({ children }) => (
  <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
    {children}
  </p>
);

/** The contracts browser for what the page shows — the mode's awarder set when
 *  ?mode is on (transportContractsHref), carrying the page's scope. */
const useContractsHref = () => {
  const [params] = useSearchParams();
  const { mode } = useTransportMode();
  return (extra: Record<string, string> = {}) =>
    transportContractsHref(params, mode, extra);
};

/** #spine — € by signing year, with the two things a reader cannot see in the
 *  bars: the corpus-wide 2020 hole (G1) and the multi-year PSO estimate (G2). */
const SpineTile: FC<{
  model: TransportModel;
  /** The rail PSO € IN THIS WINDOW (МТС + CPV 6021*), or 0 when the window holds
   *  none or ?mode leaves the ministry out — the note explains a peak only when
   *  that peak is on the chart. */
  psoEur: number;
}> = ({ model, psoEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: hub } = useTransportHubStats();
  const years = model.years.filter((y) => y.totalEur > 0);
  if (!years.length)
    return (
      <Note>
        {bg ? "Няма договори в периода." : "No contracts in the window."}
      </Note>
    );
  const max = Math.max(...years.map((y) => y.totalEur), 1);
  const has2020 = years.some((y) => y.year === 2020);
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarRange className="h-4 w-4" />
          {bg ? "Поръчките по години" : "Procurement by year"}
        </CardTitle>
      </CardHeader>
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
        <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground/90">
          {has2020 ? (
            <li>
              {bg
                ? "2020 г. е ниска в целия регистър, не само в транспорта — за годината са публикувани много по-малко договори."
                : "2020 is low across the whole register, not only for transport — far fewer contracts were published for that year."}
            </li>
          ) : null}
          {psoEur > 0 ? (
            <li>
              {bg
                ? `Договорите на МТС за обществена услуга в железопътния транспорт в периода (${formatEurCompact(psoEur, lang)}) са с прогнозна стойност за целия многогодишен срок — пикът в годината на подписването им не е годишен разход.`
                : `MTC's rail public-service contracts in the window (${formatEurCompact(psoEur, lang)}) carry an estimated value over their whole multi-year term — the peak in their signing year is not annual spend.`}
            </li>
          ) : null}
          {hub?.annexGrowthEur ? (
            <li>
              {bg
                ? `Анексите са добавили ${formatEurCompact(hub.annexGrowthEur, lang)} за целия период и за целия сектор (данните за анекси започват от 2020 г., затова това е долна граница). Сумите по години са текущата стойност след анекси.`
                : `Annexes added ${formatEurCompact(hub.annexGrowthEur, lang)} over the whole period, for the whole sector (annex data starts in 2020, so this is a floor). The yearly sums are the current value after annexes.`}
            </li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  );
};

/** #competition headline — the sector's ex-member rate beside the national one
 *  on the SAME window and basis, or no baseline at all. */
const CompetitionBaseline: FC<{
  bodies: TransportBodyAgg[];
  /** The national ex-member share for the same window, or null (see the screen). */
  natShare: number | null;
  contracts: number;
}> = ({ bodies, natShare, contracts }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const known = bodies.reduce((s, b) => s + b.bidKnownN, 0);
  const single = bodies.reduce((s, b) => s + b.singleBidN, 0);
  if (!known)
    return (
      <Note>
        {bg
          ? "В избрания период няма договори с известен брой оферти."
          : "No contracts with a known bid count in the selected window."}
      </Note>
    );
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          {bg ? "Конкуренция" : "Competition"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <p>
          <span className="text-2xl font-bold tabular-nums">
            {pctFmt(single / known, bg, 1)}
          </span>{" "}
          {bg
            ? `от ${formatInt(known, lang)} договора с известен брой оферти са с една оферта`
            : `of ${formatInt(known, lang)} contracts with a known bid count drew a single bid`}
          {natShare != null
            ? bg
              ? ` — при ${pctFmt(natShare, bg, 1)} за всички възложители в същия период.`
              : ` — against ${pctFmt(natShare, bg, 1)} for all buyers in the same window.`
            : "."}
        </p>
        {contracts > 0 ? (
          <p className="text-muted-foreground">
            {bg
              ? `Броят оферти е известен за ${pctFmt(known / contracts, bg)} от ${formatInt(contracts, lang)} договора.`
              : `The bid count is known for ${pctFmt(known / contracts, bg)} of ${formatInt(contracts, lang)} contracts.`}
          </p>
        ) : null}
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "И двете страни са без нулевите дялове на участниците в обединения. Договорите на МТС за обществена услуга в железопътния транспорт са с един участник по естеството си — превозвачът е един. Една оферта е сигнал за проверка, не доказателство."
            : "Both sides exclude the €0 shares of consortium members. MTC's rail public-service contracts have one bidder by their nature — there is one operator. A single bid is a flag for review, not proof."}
        </p>
      </CardContent>
    </Card>
  );
};

/** #contractors — the money that stays in the state group (D4) and the public
 *  bodies outside the sector that the group pays (D9), in the page's window,
 *  plus the whole-period figures from the hub blob. Disclosed, never netted (D5). */
const InGroupCard: FC<{
  suppliers: { eik: string; name: string; totalEur: number }[];
  totalEur: number;
}> = ({ suppliers, totalEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: hub } = useTransportHubStats();
  const eur = (n: number) => formatEurCompact(n, lang);
  const group = new Set(TRANSPORT_GROUP_EIKS);
  const inWindow = suppliers
    .filter((s) => group.has(s.eik))
    .reduce((a, s) => a + s.totalEur, 0);
  const publicRows = TRANSPORT_PUBLIC_CONTRACTORS.map((p) => ({
    ...p,
    eur: suppliers
      .filter((s) => s.eik === p.eik)
      .reduce((a, s) => a + s.totalEur, 0),
  }))
    .filter((p) => p.eur > 0)
    .sort((a, b) => b.eur - a.eur);
  const ingroupName = TRANSPORT_INGROUP_CONTRACTORS.map((c) =>
    bg ? c.name : c.nameEn,
  ).join(", ");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Repeat className="h-4 w-4" />
          {bg
            ? "Пари, които остават в държавната група"
            : "Money that stays inside the state group"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <p>
          <span className="text-2xl font-bold tabular-nums">
            {eur(inWindow)}
          </span>{" "}
          {bg
            ? `в избрания период са договори, при които изпълнителят е структура на МТС или ${ingroupName}${totalEur > 0 ? ` (${pctFmt(inWindow / totalEur, bg, 1)} от сумата)` : ""}.`
            : `in the selected window are contracts whose contractor is an MTC body or ${ingroupName}${totalEur > 0 ? ` (${pctFmt(inWindow / totalEur, bg, 1)} of the total)` : ""}.`}
        </p>
        {hub?.inGroup.contracts ? (
          <p className="text-muted-foreground">
            {bg
              ? `За целия период: ${eur(hub.inGroup.eur)} по ${formatInt(hub.inGroup.contracts, lang)} договора, от тях ${eur(hub.inGroup.contractorEur)} към ТСВ ЕАД — държавното дружество, наследник на ДП ТСВ, което получава поръчки, но не възлага.`
              : `Over the whole period: ${eur(hub.inGroup.eur)} across ${formatInt(hub.inGroup.contracts, lang)} contracts, of which ${eur(hub.inGroup.contractorEur)} to TSV EAD — the state company that succeeded the TSV state enterprise, which wins work but awards none.`}
            {/* T7 (audit 2026-10-17): most of the in-group € is ONE estimate. */}
            {hub.inGroup.psoEur
              ? bg
                ? ` От общата сума ${eur(hub.inGroup.psoEur)} е прогнозната стойност на договора за обществена услуга на МТС с „БДЖ — Пътнически превози“ за целия му многогодишен срок.`
                : ` Of the total, ${eur(hub.inGroup.psoEur)} is the estimated value of MTC's public-service contract with BDZ Passenger Services over its whole multi-year term.`
              : null}
          </p>
        ) : null}
        {publicRows.length ? (
          <div className="space-y-1 pt-1">
            <p className="text-xs font-medium">
              {bg
                ? "Други държавни и общински структури извън сектора, на които групата плаща"
                : "Other state and municipal bodies outside the sector that the group pays"}
            </p>
            <ul className="space-y-0.5 text-xs">
              {publicRows.map((p) => (
                <li key={p.eik} className="flex justify-between gap-2">
                  <CompanyLink
                    eik={p.eik}
                    className="min-w-0 truncate hover:text-primary hover:underline"
                  >
                    {bg ? p.name : p.nameEn}
                  </CompanyLink>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {eur(p.eur)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Тези суми са включени в общата стойност на поръчките и не се изваждат от нея. „Български пощи“ е дружество на МТС, но е извън сектора (той е за превоза на хора и товари), затова е в списъка на външните държавни структури, а не в групата. Стойността на обединенията, в които такава структура е участник, не е в тези суми."
            : "These sums are part of the procurement total and are not subtracted from it. Bulgarian Posts is an MTC company but outside the sector (which is about moving people and goods), so it is listed with the outside state bodies, not in the group. The value of consortia in which such a body is a member is not in these sums."}
        </p>
      </CardContent>
    </Card>
  );
};

/** #direct — „без обявление" over the € whose method is KNOWN (A4). */
const DirectCard: FC<{ payload: GroupModelPayload }> = ({ payload }) => {
  const { mode } = useTransportMode();
  // The sector-procedure clause names air navigation and ports, so it shows only when
  // those bodies are in the figure.
  const sectorProcs =
    mode == null || mode === "aviation" || mode === "maritime";
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const href = useContractsHref();
  const d = directShareKnown(payload.byMethod);
  // The coverage denominator is the WHOLE window's €: byMethod carries only the rows
  // whose method is stated, so its own total is the known € again (it read „100%").
  const totalEur = payload.totalEur;
  if (!totalEur)
    return (
      <Note>
        {bg ? "Няма договори в периода." : "No contracts in the window."}
      </Note>
    );
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-4 w-4" />
          {bg ? "Без предварително обявление" : "Without a prior notice"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        {d.knownEur > 0 ? (
          <p>
            <span className="text-2xl font-bold tabular-nums">
              {pctFmt(d.directEur / d.knownEur, bg)}
            </span>{" "}
            {bg
              ? `от стойността с известна процедура (${formatEurCompact(d.directEur, lang)}) е възложена без предварително обявление или чрез пряко договаряне.`
              : `of the value with a known procedure (${formatEurCompact(d.directEur, lang)}) was awarded without a prior notice or by direct negotiation.`}
          </p>
        ) : null}
        <p className="text-muted-foreground">
          {bg
            ? `Процедурата е известна за ${pctFmt(d.knownEur / totalEur, bg)} от стойността — за останалото регистърът не я посочва.`
            : `The procedure is known for ${pctFmt(d.knownEur / totalEur, bg)} of the value — the register does not state it for the rest.`}
        </p>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Тук влизат договарянето без обявление, прякото договаряне и процедурите само с покана${sectorProcs ? " — включително секторните поръчки на въздушната навигация и пристанищата, които законът допуска" : ""}. Законно основание и пропуск не се различават от тези данни: сигнал за проверка.`
            : `This covers negotiation without a notice, direct negotiation and invitation-only procedures${sectorProcs ? " — including the sector procedures that the law allows for air navigation and ports" : ""}. The data cannot tell a lawful ground from a lapse: a flag for review.`}
        </p>
        <Link
          to={href({ proc: "direct" })}
          className="inline-block text-xs font-medium text-primary hover:underline"
        >
          {bg ? "виж договорите →" : "see the contracts →"}
        </Link>
      </CardContent>
    </Card>
  );
};

/** #risk — the contracts the risk index grades D or E, for review (G6). */
const RiskCard: FC = () => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const href = useContractsHref();
  const { mode } = useTransportMode();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          {bg ? "Договори за проверка" : "Contracts to review"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <p>
          {bg
            ? "Индексът на риска събира сигнали като една оферта, кратък срок и обжалване. Оценките D и E значат „за проверка“, не нарушение."
            : 'The risk index combines signals such as a single bid, a short deadline and an appeal. Grades D and E mean "worth reviewing", not a violation.'}
        </p>
        {/* G6 was measured over the WHOLE corpus and the whole sector (88% of
            grade-D €). The page's grades are not in any payload it fetches, so the
            sentence is stated as whole-period and only where it can apply — with
            no mode, since a mode can leave both named bodies out. */}
        {mode ? null : (
          <p className="text-muted-foreground">
            {bg
              ? "За целия период по-голямата част от стойността с оценка D в сектора са договори вътре в групата или по закон с един изпълнител — договорът за обществена услуга с „БДЖ — Пътнически превози“ и поръчките към ТСВ ЕАД. В избран по-кратък период делът може да е различен."
              : "Over the whole period, most of the sector's value graded D is in-group or statutory single-supplier — the public-service contract with BDZ Passenger Services and the awards to TSV EAD. In a narrower window the share can differ."}
          </p>
        )}
        <Link
          to={href({ grade: "D,E" })}
          className="inline-block text-xs font-medium text-primary hover:underline"
        >
          {bg
            ? "виж договорите с оценка D и E →"
            : "see the contracts graded D and E →"}
        </Link>
      </CardContent>
    </Card>
  );
};

export const TransportProcurementScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { mode, eiks } = useTransportMode();
  const group = useTransportGroupModel(eiks);
  const rollup = useTransportRollup(eiks);
  const { data: national } = useNationalCompetition();
  // Ex-member on both sides, or no baseline at all — one decision for the headline
  // card and the per-unit tile.
  const natShare = rollup.exMembers
    ? nationalSingleBidExMembers(national)
    : null;
  // The mode split is the WHOLE sector by definition — it ignores ?mode.
  const whole = useTransportGroupModel(TRANSPORT_SECTOR_EIKS);
  const ministry = useMinistryByCpv();

  const modes = useMemo<ModeRow[] | null>(() => {
    if (!whole.payload || !ministry.byCpv) return null;
    const raw = new Map<string, number>();
    for (const u of whole.payload.byUnit) {
      const uni = transportUniverseOf(u.eik);
      if (uni) raw.set(uni, (raw.get(uni) ?? 0) + u.totalEur);
    }
    return reattributedModes(whole.payload.byUnit, ministry.byCpv).map((m) => ({
      ...m,
      rawEur: raw.get(m.universe) ?? 0,
    }));
  }, [whole.payload, ministry.byCpv]);

  // The PSO lots sit on the ministry, so they are in the bars only when the mode
  // keeps it; ministry.byCpv is on the page's window.
  const psoEur = eiks.includes(TRANSPORT_EIK)
    ? (ministry.byCpv ?? [])
        .filter((c) => isPsoAward(TRANSPORT_EIK, c.cpv))
        .reduce((a, c) => a + c.totalEur, 0)
    : 0;
  const contracts = rollup.bodies.reduce((s, b) => s + b.contractCount, 0);
  const model = group.model;
  const sectorWide = bg ? "за целия сектор" : "for the whole sector";
  const failed = bg
    ? "Данните за този раздел не можаха да се заредят."
    : "The data for this section could not be loaded.";

  return (
    <TransportPageFrame
      title={{
        bg: "Поръчките в транспорта",
        en: "Transport procurement",
      }}
      description={{
        bg: "Какво купуват министерството, железниците, пристанищата и въздушният транспорт, как го възлагат и кой го печели — по години, по вид транспорт, по функция и по изпълнител.",
        en: "What the ministry, the railways, the ports and air transport buy, how they award it and who wins it — by year, by mode, by function and by contractor.",
      }}
      scoped
      controls={<TransportModePicker />}
      // Every async section above a hub fragment: the watch restarts as each lands,
      // so a cold-load #risk / #direct link does not stop at a pre-layout offset.
      ready={[model, modes, rollup.bodies, whole.payload, ministry.byCpv]}
      // Failures are reported PER SECTION, not by the frame: every hub link
      // targets a fragment here, and an error frame would drop all eight ids.
      status={{
        isLoading: group.isLoading || rollup.isLoading,
        isError: false,
      }}
    >
      {mode ? (
        <p className="text-sm text-muted-foreground">
          {bg
            ? `Показани са поръчките на структурите от вида „${transportUniverseLabel(mode, lang)}“. Разпределението по вид транспорт е ${sectorWide}.`
            : `Showing the procurement of the ${transportUniverseLabel(mode, lang)} bodies. The split by mode is ${sectorWide}.`}
        </p>
      ) : null}
      <section id="spine" className="scroll-mt-24">
        {model ? (
          <SpineTile model={model} psoEur={psoEur} />
        ) : group.isError ? (
          <Note>{failed}</Note>
        ) : null}
      </section>
      <section id="modes" className="scroll-mt-24">
        {modes ? (
          <TransportModeSplitTile modes={modes} />
        ) : whole.isError || ministry.isError ? (
          <Note>
            {bg
              ? "Разпределението по вид транспорт не можа да се зареди."
              : "The split by mode could not be loaded."}
          </Note>
        ) : null}
      </section>
      <section id="categories" className="scroll-mt-24">
        {model ? (
          <TransportCategoryTile
            categories={model.categories}
            totalEur={model.totalEur}
            noCpvEur={(group.payload?.byCpv ?? [])
              .filter((c) => !c.cpv)
              .reduce((a, c) => a + c.totalEur, 0)}
          />
        ) : group.isError ? (
          <Note>{failed}</Note>
        ) : null}
      </section>
      <section id="competition" className="scroll-mt-24 space-y-4">
        {rollup.isError ? (
          <Note>{failed}</Note>
        ) : (
          <>
            <CompetitionBaseline
              bodies={rollup.bodies}
              natShare={natShare}
              contracts={contracts}
            />
            <TransportCompetitionTile
              units={rollup.bodies}
              national={natShare}
            />
          </>
        )}
      </section>
      <section id="contractors" className="scroll-mt-24 space-y-4">
        {model ? (
          <>
            <InGroupCard
              suppliers={model.suppliers}
              totalEur={model.totalEur}
            />
            <VikContractorHhiTile
              memberEiks={TRANSPORT_GROUP_EIKS}
              stateBodyEiks={TRANSPORT_PUBLIC_CONTRACTOR_EIKS}
              suppliers={model.suppliers}
              totalEur={model.totalEur}
            />
          </>
        ) : group.isError ? (
          <Note>{failed}</Note>
        ) : null}
      </section>
      <section id="top-contracts" className="scroll-mt-24">
        <TransportTopContractsTile eiks={eiks} />
      </section>
      <section id="direct" className="scroll-mt-24">
        {group.payload ? (
          <DirectCard payload={group.payload} />
        ) : group.isError ? (
          <Note>{failed}</Note>
        ) : null}
      </section>
      <section id="risk" className="scroll-mt-24">
        <RiskCard />
      </section>
    </TransportPageFrame>
  );
};
