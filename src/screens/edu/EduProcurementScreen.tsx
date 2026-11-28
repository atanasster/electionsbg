// /sector/edu/procurement — what the education and science institutions buy,
// how it is awarded and who wins it.
//
// Sections carry the plan's ids and ONLY those: #spine #universes #competition
// #contractors #top-contracts #buses #textbooks #direct. Each section OWNS its id
// and renders even when its source is empty or failed, so a hub link always
// lands; eduRegistry.test.ts fails a hub link to a fragment this page does not
// render.
//
// SCOPED (ScopeControl) and universe-filterable (?universe=, validated on read
// against EDU_UNIVERSE_PARAMS — an unknown value is the whole sector, never an
// empty page). Three blocks are whole-period and say so — the top procurements,
// the school buses and the in-group / transfer totals read from the hub blob.
//
// Bases kept apart:
//   • € by year / supplier — the group model (consortium members carry €0);
//   • per-body COUNTS and single-bid — the ex-member rollup, beside the national
//     ex-member pair for the SAME window (sector-dashboard §3), never the group
//     model's member-inclusive counts;
//   • „без обявление" — over the € whose method is KNOWN, coverage named.

import { FC, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bus,
  CalendarRange,
  Layers,
  Repeat,
  Scale,
  Send,
  Trophy,
} from "lucide-react";
import { isBg } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { VikContractorHhiTile } from "@/screens/components/procurement/vik/VikContractorHhiTile";
import { MonPack } from "@/screens/components/procurement/mon/MonPack";
import { useNationalCompetition } from "@/data/procurement/useNationalCompetition";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import {
  useEduGroupModel,
  useEduRollup,
  type EduBodyAgg,
  type EduModel,
} from "@/data/edu/useEduSector";
import { useEduHubStats } from "@/data/edu/hubStats";
import {
  EDU_ENTITIES,
  EDU_LEAD_EIK,
  EDU_SECTOR_EIKS,
  EDU_STATE_TRANSFER_CONTRACTORS,
  educationEntityByEik,
  educationUniverseLabel,
  type EducationUniverse,
} from "@/lib/educationReferenceData";
import { directShareKnown } from "@/lib/transportAttributes";
import type { GroupModelPayload } from "@/lib/awarderModel";
import { EduPageFrame } from "./EduPageFrame";
import {
  eduPct,
  exMemberPair,
  othersShare,
  parseUniverse,
  universeRows,
  type CompetitionPair,
  type UniverseRow,
} from "./eduSectorData";
import {
  bandOf,
  BAND_TEXT as SHARED_BAND_TEXT,
  WELL_ABOVE,
  type Band,
} from "@/screens/transport/competitionBand";
import { EduNote } from "./EduNote";

/** Below this many bid-known contracts a group's share is not shown. */
const MIN_BID_KNOWN = 3;

const TRANSFER_EIKS = EDU_STATE_TRANSFER_CONTRACTORS.map((c) => c.eik);
const SECTOR_SET = new Set(EDU_SECTOR_EIKS);

/** Network-supply share at or above which a top contractor is labelled a
 *  regulated supply rather than a market win (A12). */
const UTILITY_MARK = 0.5;

const sectionTitle = (Icon: FC<{ className?: string }>, text: string) => (
  <CardHeader className="pb-2">
    <CardTitle className="text-base flex items-center gap-2">
      <Icon className="h-4 w-4" />
      {text}
    </CardTitle>
  </CardHeader>
);

/** #spine — € by signing year, with the corpus-wide 2020 hole named (A8). */
const SpineTile: FC<{ model: EduModel }> = ({ model }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const years = model.years.filter((y) => y.totalEur > 0);
  if (!years.length)
    return (
      <EduNote>
        {bg ? "Няма договори в периода." : "No contracts in the window."}
      </EduNote>
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
        <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground/90">
          {years.some((y) => y.year === 2020) ? (
            <li>
              {bg
                ? "2020 г. е ниска в целия регистър, не само в образованието — за годината са публикувани много по-малко договори."
                : "2020 is low across the whole register, not only for education — far fewer contracts were published for that year."}
            </li>
          ) : null}
          <li>
            {bg
              ? "Сумите по години са текущата стойност на договорите след анекси."
              : "The yearly sums are the contracts' current value after annexes."}
          </li>
        </ul>
      </CardContent>
    </Card>
  );
};

/** The shared band colours; neutral inherits the muted line colour here. */
const BAND_TEXT: Record<Band, string> = { ...SHARED_BAND_TEXT, neutral: "" };

/** #universes — the split of the sector's € and competition by group. Each
 *  group's single-bid share is coloured against `others`. */
export const UniversesTile: FC<{
  rows: UniverseRow[];
  selected: EducationUniverse | null;
  /** Every OTHER buyer's single-bid share on the same window and ex-member
   *  basis (national − whole sector), or null: then nothing is coloured. */
  others: number | null;
}> = ({ rows, selected, others }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const [params] = useSearchParams();
  const total = rows.reduce((a, r) => a + r.totalEur, 0);
  if (!total)
    return (
      <EduNote>
        {bg ? "Няма договори в периода." : "No contracts in the window."}
      </EduNote>
    );
  const hrefFor = (u: EducationUniverse | null) => {
    const p = new URLSearchParams(params);
    if (u) p.set("universe", u);
    else p.delete("universe");
    const s = p.toString();
    return `?${s}#universes`;
  };
  return (
    <Card>
      {sectionTitle(
        Layers,
        bg ? "По групи институции" : "By group of institution",
      )}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.universe} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Link
                  to={hrefFor(r.universe)}
                  className={`hover:text-primary hover:underline ${selected === r.universe ? "font-semibold" : ""}`}
                >
                  {educationUniverseLabel(r.universe, lang)}
                </Link>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatEurCompact(r.totalEur, lang)} ·{" "}
                  {eduPct(r.totalEur / total, bg)} ·{" "}
                  {formatInt(r.contractCount, lang)}{" "}
                  {bg ? "договора" : "contracts"}
                  {r.bidKnownN >= MIN_BID_KNOWN ? (
                    <>
                      {" · "}
                      <span
                        className={`font-medium ${BAND_TEXT[bandOf(r.singleBidN / r.bidKnownN, others)]}`}
                      >
                        {eduPct(r.singleBidN / r.bidKnownN, bg, 1)}
                      </span>{" "}
                      {bg ? "с една оферта" : "single-bid"}
                    </>
                  ) : null}
                </span>
              </div>
              <div className="h-1.5 rounded bg-muted">
                <div
                  className="h-1.5 rounded bg-primary/70"
                  style={{ width: `${(r.totalEur / total) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
        {selected ? (
          <Link
            to={hrefFor(null)}
            className="inline-block text-xs font-medium text-primary hover:underline"
          >
            {bg ? "покажи целия сектор →" : "show the whole sector →"}
          </Link>
        ) : null}
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Броят договори и делът с една оферта са без нулевите дялове на участниците в обединения. ${
                others != null
                  ? `Цветът на дела сравнява с ${eduPct(others, bg, 1)} за всички останали възложители в същия период: зелено — до него, жълто — до ${Math.round(WELL_ABOVE * 100)} пункта над него, червено — повече. Сигнал за проверка, не присъда.`
                  : "Средното за останалите възложители за този период не е налично, затова делът не е оцветен."
              }`
            : `Contract counts and the single-bid share exclude the €0 shares of consortium members. ${
                others != null
                  ? `The share's colour compares with ${eduPct(others, bg, 1)} for every other buyer in the same window: green — at or below it, amber — up to ${Math.round(WELL_ABOVE * 100)} points above, red — further. A flag for review, not a verdict.`
                  : "The rate for the other buyers in this window is unavailable, so the share is not coloured."
              }`}
        </p>
      </CardContent>
    </Card>
  );
};

/** #competition — the shown set's ex-member rate beside EVERY OTHER buyer's on
 *  the same window and basis (national − shown set), or no baseline at all. */
const CompetitionCard: FC<{
  bodies: EduBodyAgg[];
  /** National ex-member pair for the window, or null when the server cannot
   *  state it on the ex-member basis (or the rollup did not drop members). */
  national: CompetitionPair | null;
}> = ({ bodies, national }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const known = bodies.reduce((s, b) => s + b.bidKnownN, 0);
  const single = bodies.reduce((s, b) => s + b.singleBidN, 0);
  const contracts = bodies.reduce((s, b) => s + b.contractCount, 0);
  if (!known)
    return (
      <EduNote>
        {bg
          ? "В избрания период няма договори с известен брой оферти."
          : "No contracts with a known bid count in the selected window."}
      </EduNote>
    );
  const others = othersShare(national, single, known);
  return (
    <Card>
      {sectionTitle(Scale, bg ? "Конкуренция" : "Competition")}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <p>
          <span className="text-2xl font-bold tabular-nums">
            {eduPct(single / known, bg, 1)}
          </span>{" "}
          {bg
            ? `от ${formatInt(known, lang)} договора с известен брой оферти са с една оферта`
            : `of ${formatInt(known, lang)} contracts with a known bid count drew a single bid`}
          {others != null
            ? bg
              ? ` — при ${eduPct(others, bg, 1)} за всички останали възложители в същия период.`
              : ` — against ${eduPct(others, bg, 1)} for every other buyer in the same window.`
            : "."}
        </p>
        {contracts > 0 ? (
          <p className="text-muted-foreground">
            {bg
              ? `Броят оферти е известен за ${eduPct(known / contracts, bg)} от ${formatInt(contracts, lang)} договора.`
              : `The bid count is known for ${eduPct(known / contracts, bg)} of ${formatInt(contracts, lang)} contracts.`}
          </p>
        ) : null}
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "И двете страни са без нулевите дялове на участниците в обединения. Една оферта е сигнал за проверка, не доказателство — абонаменти за научни бази данни и доставки по закон имат един възможен изпълнител."
            : "Both sides exclude the €0 shares of consortium members. A single bid is a flag for review, not proof — scientific database subscriptions and statutory supplies have one possible supplier."}
        </p>
      </CardContent>
    </Card>
  );
};

/** #contractors — the money that stays in the sector (A11) and the financing
 *  transfers booked as contracts (A10), disclosed and never netted, then the
 *  top contractors with the network-supply marker (A12). */
const ContractorsCard: FC<{ model: EduModel }> = ({ model }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: hub } = useEduHubStats();
  const eur = (n: number) => formatEurCompact(n, lang);
  const inGroup = model.suppliers
    .filter((s) => SECTOR_SET.has(s.eik))
    .reduce((a, s) => a + s.totalEur, 0);
  const transfer = model.suppliers
    .filter((s) => TRANSFER_EIKS.includes(s.eik))
    .reduce((a, s) => a + s.totalEur, 0);
  const utility = new Set(
    (hub?.topContractors ?? [])
      .filter((c) => c.utilityShare >= UTILITY_MARK)
      .map((c) => c.eik),
  );
  const top = model.suppliers.slice(0, 10);
  return (
    <Card>
      {sectionTitle(Repeat, bg ? "Изпълнителите" : "The contractors")}
      <CardContent className="p-3 md:p-4 space-y-3 text-sm">
        <ul className="space-y-0.5 text-xs">
          {top.map((s) => (
            <li key={s.eik} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                <CompanyLink
                  eik={s.eik}
                  className="hover:text-primary hover:underline"
                >
                  {s.name}
                </CompanyLink>
                {utility.has(s.eik) ? (
                  <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {bg ? "мрежова доставка" : "network supply"}
                  </span>
                ) : null}
                {SECTOR_SET.has(s.eik) ? (
                  <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {bg ? "в сектора" : "in the sector"}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {eur(s.totalEur)}
              </span>
            </li>
          ))}
        </ul>
        {utility.size ? (
          <p className="text-[11px] text-muted-foreground/80">
            {bg
              ? "„Мрежова доставка“ — за целия период поне половината от парите на този изпълнител от сектора са за ток, топлинна енергия, газ, комунални или телекомуникационни услуги: регулирана доставка, не спечелен пазар."
              : "„Network supply“ — over the whole period at least half this contractor's money from the sector is for electricity, heat, gas, utilities or telecoms: a regulated supply, not a market won."}
          </p>
        ) : null}
        <div className="space-y-1 border-t border-border pt-2">
          <p>
            <span className="font-semibold tabular-nums">{eur(inGroup)}</span>{" "}
            {bg
              ? "в избрания период са договори, при които изпълнителят е институция от сектора."
              : "in the selected window are contracts whose contractor is a body of the sector."}
            {transfer > 0
              ? bg
                ? ` Още ${eur(transfer)} са финансиране към Фонда на фондовете, записано като договор.`
                : ` A further ${eur(transfer)} is financing to the Fund of Funds booked as a contract.`
              : null}
          </p>
          {hub ? (
            <p className="text-muted-foreground">
              {bg
                ? `За целия период: ${eur(hub.inGroup.eur)} вътре в сектора (${formatInt(hub.inGroup.contracts, lang)} договора) и ${eur(hub.stateTransfers.eur)} финансиране, записано като договор.`
                : `Over the whole period: ${eur(hub.inGroup.eur)} inside the sector (${formatInt(hub.inGroup.contracts, lang)} contracts) and ${eur(hub.stateTransfers.eur)} of financing booked as a contract.`}
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground/80">
            {bg
              ? "Тези суми са включени в общата стойност на поръчките и не се изваждат от нея."
              : "These sums are part of the procurement total and are not subtracted from it."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

/** #top-contracts — whole-period, the lots of one УНП folded into one row (A14). */
const TopProcurementsCard: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: hub, isError } = useEduHubStats();
  if (isError || hub === null)
    return (
      <EduNote>
        {bg
          ? "Най-големите поръчки не можаха да се заредят."
          : "The largest procurements could not be loaded."}
      </EduNote>
    );
  if (!hub) return null;
  return (
    <Card>
      {sectionTitle(
        Trophy,
        bg
          ? "Най-големите поръчки — за целия период"
          : "The largest procurements — whole period",
      )}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <ol className="space-y-1.5">
          {hub.topProcurements.map((p) => (
            <li key={p.key} className="flex justify-between gap-3">
              <span className="min-w-0">
                <Link
                  to={`/procurement/contract/${p.key}`}
                  className="hover:text-primary hover:underline"
                >
                  {p.title}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  <AwarderLink
                    eik={p.awarderEik}
                    className="hover:text-primary hover:underline"
                  >
                    {educationEntityByEik(p.awarderEik)?.name ?? p.awarderEik}
                  </AwarderLink>
                  {" · "}
                  {p.contractorName} · {p.date.slice(0, 4)}
                  {p.lots > 1
                    ? bg
                      ? ` · ${formatInt(p.lots, lang)} позиции`
                      : ` · ${formatInt(p.lots, lang)} lots`
                    : ""}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {formatEurCompact(p.eur, lang)}
              </span>
            </li>
          ))}
        </ol>
        {hub.procurement.nullAmountContracts > 0 ? (
          <p className="text-[11px] text-muted-foreground/80">
            {bg
              ? `${formatInt(hub.procurement.nullAmountContracts, lang)} договора нямат посочена стойност и не участват в никоя сума и класация.`
              : `${formatInt(hub.procurement.nullAmountContracts, lang)} contracts state no value and are in no sum or ranking.`}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};

/** #buses — МОН's school buses (A13), whole-period, worded for review. */
const BusesCard: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const { data: hub, isError } = useEduHubStats();
  if (isError || hub === null)
    return (
      <EduNote>
        {bg
          ? "Данните за училищните автобуси не можаха да се заредят."
          : "The school-bus data could not be loaded."}
      </EduNote>
    );
  if (!hub) return null;
  const b = hub.buses;
  if (!b.contracts)
    return (
      <EduNote>
        {bg
          ? "Няма договори за училищни автобуси."
          : "No school-bus contracts."}
      </EduNote>
    );
  const span =
    b.firstDate && b.lastDate
      ? `${b.firstDate.slice(0, 4)}–${b.lastDate.slice(0, 4)}`
      : "";
  return (
    <Card>
      {sectionTitle(
        Bus,
        bg
          ? "Училищните автобуси — за проверка"
          : "The school buses — worth reviewing",
      )}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        <p>
          <span className="text-2xl font-bold tabular-nums">
            {formatEurCompact(b.eur, lang)}
          </span>{" "}
          {bg
            ? `по ${formatInt(b.contracts, lang)} договора на МОН за автобуси${span ? `, ${span}` : ""}`
            : `over ${formatInt(b.contracts, lang)} МОН bus contracts${span ? `, ${span}` : ""}`}
          {b.bidKnown > 0
            ? bg
              ? `; ${eduPct(b.singleBid / b.bidKnown, bg)} от тези с известен брой оферти са с една оферта.`
              : `; ${eduPct(b.singleBid / b.bidKnown, bg)} of those with a known bid count drew a single bid.`
            : "."}
        </p>
        <ul className="space-y-0.5 text-xs">
          {b.suppliers.map((s) => (
            <li key={s.eik} className="flex justify-between gap-2">
              <CompanyLink
                eik={s.eik}
                className="min-w-0 truncate hover:text-primary hover:underline"
              >
                {s.name}
              </CompanyLink>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatEurCompact(s.eur, lang)} · {formatInt(s.contracts, lang)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Малко доставчици и много договори с една оферта са сигнал за проверка, не доказателство за нарушение."
            : "Few suppliers and many single-bid contracts are a flag for review, not proof of wrongdoing."}
        </p>
      </CardContent>
    </Card>
  );
};

/** #direct — „без обявление" over the € whose method is KNOWN. */
const DirectCard: FC<{ payload: GroupModelPayload }> = ({ payload }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const d = directShareKnown(payload.byMethod);
  // The coverage denominator is the WHOLE window's €: byMethod carries only the
  // rows whose method is stated.
  const totalEur = payload.totalEur;
  if (!totalEur)
    return (
      <EduNote>
        {bg ? "Няма договори в периода." : "No contracts in the window."}
      </EduNote>
    );
  return (
    <Card>
      {sectionTitle(
        Send,
        bg ? "Без предварително обявление" : "Without a prior notice",
      )}
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        {d.knownEur > 0 ? (
          <p>
            <span className="text-2xl font-bold tabular-nums">
              {eduPct(d.directEur / d.knownEur, bg)}
            </span>{" "}
            {bg
              ? `от стойността с известна процедура (${formatEurCompact(d.directEur, lang)}) е възложена без предварително обявление или чрез пряко договаряне.`
              : `of the value with a known procedure (${formatEurCompact(d.directEur, lang)}) was awarded without a prior notice or by direct negotiation.`}
          </p>
        ) : null}
        <p className="text-muted-foreground">
          {bg
            ? `Процедурата е известна за ${eduPct(Math.min(1, d.knownEur / totalEur), bg)} от стойността — за останалото регистърът не я посочва.`
            : `The procedure is known for ${eduPct(Math.min(1, d.knownEur / totalEur), bg)} of the value — the register does not state it for the rest.`}
        </p>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Законно основание и пропуск не се различават от тези данни: сигнал за проверка."
            : "The data cannot tell a lawful ground from a lapse: a flag for review."}
        </p>
      </CardContent>
    </Card>
  );
};

export const EduProcurementScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const [params] = useSearchParams();
  const universe = parseUniverse(params.get("universe"));
  const eiks = useMemo(
    () =>
      universe
        ? EDU_ENTITIES.filter((e) => e.universe === universe).map((e) => e.eik)
        : EDU_SECTOR_EIKS,
    [universe],
  );
  const { from, to } = useScopeWindow();
  const group = useEduGroupModel(eiks);
  const rollup = useEduRollup(eiks);
  // The universe split is the WHOLE sector by definition — it ignores ?universe.
  const whole = useEduRollup(EDU_SECTOR_EIKS);
  const { data: national } = useNationalCompetition();
  // Ex-member on both sides, or no baseline at all — ONE pair for both cards.
  const exPair = useMemo(() => exMemberPair(national), [national]);
  const nationalPair = rollup.exMembers ? exPair : null;
  const uniRows = useMemo(() => universeRows(whole.bodies), [whole.bodies]);
  // Per-universe baseline: national minus the WHOLE sector — every body of the
  // rollup, not only the ones a universe resolved — whatever ?universe says.
  const uniOthers = useMemo(
    () =>
      whole.exMembers
        ? othersShare(
            exPair,
            whole.bodies.reduce((a, b) => a + b.singleBidN, 0),
            whole.bodies.reduce((a, b) => a + b.bidKnownN, 0),
          )
        : null,
    [whole.exMembers, whole.bodies, exPair],
  );
  const model = group.model;
  const failed = bg
    ? "Данните за този раздел не можаха да се заредят."
    : "The data for this section could not be loaded.";

  return (
    <EduPageFrame
      title={{
        bg: "Поръчките в образованието и науката",
        en: "Education and science procurement",
      }}
      description={{
        bg: "Какво купуват министерството, университетите и БАН, как го възлагат и кой го печели — по години, по групи институции, по изпълнител, с училищните автобуси и учебниците.",
        en: "What the ministry, the universities and the Academy of Sciences buy, how they award it and who wins it — by year, by group of institution and by contractor, with the school buses and the textbooks.",
      }}
      scoped
      ready={[model, rollup.bodies, whole.bodies]}
      // Failures are reported PER SECTION: every hub link targets a fragment
      // here, and an error frame would drop all eight ids.
      status={{
        isLoading: group.isLoading || rollup.isLoading,
        isError: false,
      }}
    >
      {universe ? (
        <p className="text-sm text-muted-foreground">
          {bg
            ? `Показани са поръчките на групата „${educationUniverseLabel(universe, lang)}“. Разпределението по групи, автобусите, учебниците и най-големите поръчки са за целия сектор.`
            : `Showing the procurement of the „${educationUniverseLabel(universe, lang)}“ group. The split by group, the buses, the textbooks and the largest procurements are for the whole sector.`}
        </p>
      ) : null}
      <section id="spine" className="scroll-mt-24">
        {model ? (
          <SpineTile model={model} />
        ) : group.isError ? (
          <EduNote>{failed}</EduNote>
        ) : null}
      </section>
      <section id="universes" className="scroll-mt-24">
        {whole.isError ? (
          <EduNote>{failed}</EduNote>
        ) : whole.isLoading ? null : (
          <UniversesTile
            rows={uniRows}
            selected={universe}
            others={uniOthers}
          />
        )}
      </section>
      <section id="competition" className="scroll-mt-24">
        {rollup.isError ? (
          <EduNote>{failed}</EduNote>
        ) : (
          <CompetitionCard bodies={rollup.bodies} national={nationalPair} />
        )}
      </section>
      <section id="contractors" className="scroll-mt-24 space-y-4">
        {model ? (
          <>
            <ContractorsCard model={model} />
            <VikContractorHhiTile
              memberEiks={EDU_SECTOR_EIKS}
              stateBodyEiks={TRANSFER_EIKS}
              suppliers={model.suppliers}
              totalEur={model.totalEur}
            />
          </>
        ) : group.isError ? (
          <EduNote>{failed}</EduNote>
        ) : null}
      </section>
      <section id="top-contracts" className="scroll-mt-24">
        <TopProcurementsCard />
      </section>
      <section id="buses" className="scroll-mt-24">
        <BusesCard />
      </section>
      <section id="textbooks" className="scroll-mt-24">
        <MonPack eik={EDU_LEAD_EIK} scopeWindow={{ from, to }} />
      </section>
      <section id="direct" className="scroll-mt-24">
        {group.payload ? (
          <DirectCard payload={group.payload} />
        ) : group.isError ? (
          <EduNote>{failed}</EduNote>
        ) : null}
      </section>
    </EduPageFrame>
  );
};
