// /culture/procurement — what the culture sector BUYS.
//
// The hub's procurement tile fronts this; §1.4 of
// docs/plans/culture-investigative-v1.md specifies it. Everything here runs on
// `awarder_group_model` (migration 061), the same server-side aggregate the six
// awarder sector packs use — so the page makes ONE call for an EIK set and never
// fetches contract rows into the browser.
//
// ═══════════════════════════════════════════════════════════════════════════════
// #contractors IS A REAL DESTINATION, NOT A CONVENIENCE ANCHOR. The /culture hub
// links it because /procurement/contractors CANNOT answer „who are culture's
// contractors": `contractor_rank` (122) aggregates contractors with no buyer
// dimension and refuses ?sector by design (§1.3-B). The section below is the
// answer, rendered from the per-contractor rollup this page already fetches.
//
// #network is the cross-buyer view, which no other surface offers: one supplier
// serving several independent buyers is the shape an investigation starts from.
// ═══════════════════════════════════════════════════════════════════════════════

import { FC, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Title } from "@/ux/Title";
import { StatCard } from "@/screens/dashboard/StatCard";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { useAwarderGroupModel } from "@/data/procurement/useAwarderGroupModel";
import {
  buildAwarderModelFromAggregates,
  type GroupModelPayload,
  type SectorClassifier,
} from "@/lib/awarderModel";
import { formatEurCompact, formatInt, formatPct } from "@/lib/currency";
import { useNationalCompetition } from "@/data/procurement/useNationalCompetition";
import {
  CULTURE_GROUP_EIKS,
  CULTURE_BODIES,
  STATE_CULTURE_INSTITUTES,
  ART_SCHOOLS,
  DKI_CONFIRMED_INSTITUTES,
} from "@/lib/kulturaReferenceData";
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";

/** Headline money and competition, not a CPV taxonomy — one bucket. */
const CLASSIFIER: SectorClassifier<"all"> = { categoryOf: () => "all" };

/** eik → display name, from the register. A buyer the register does not name
 *  renders as its EIK rather than as a blank: the roll-up is the definition of
 *  the set, so an unnamed member is a register gap worth seeing. */
const NAMES: Record<string, string> = Object.fromEntries([
  ...CULTURE_BODIES.map((b) => [b.eik, b.bg]),
  ...STATE_CULTURE_INSTITUTES.map((i) => [i.eik, i.bg]),
  ...ART_SCHOOLS.map((a) => [a.eik, a.bg]),
  ...DKI_CONFIRMED_INSTITUTES.map((t) => [t.eik, t.bg]),
]);

export const CultureProcurementScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);

  const eiks = useMemo(() => [...CULTURE_GROUP_EIKS], []);
  const build = useCallback(
    (p: GroupModelPayload) => buildAwarderModelFromAggregates(p, CLASSIFIER),
    [],
  );
  const { model, byUnit, isLoading } = useAwarderGroupModel(eiks, build);

  // The national baseline ON THE SAME WINDOW as the sector rate above it.
  //
  // The hub blob also carries a national rate, and using THAT here was a real
  // defect: the blob is whole-corpus while this page is scoped, so at the default
  // parliament window the page showed culture at 55.3% beside „40.9% nationally"
  // when the same-window national figure is 47.7% — and on 2023+ the comparison
  // inverted outright, rendering culture as worse than the country when it is
  // better. A baseline from a different window is not an approximation; it is a
  // different sentence.
  const { data: national } = useNationalCompetition();
  const nationalRate =
    national && national.bidKnown
      ? national.singleBid / national.bidKnown
      : null;

  const buyers = byUnit.filter((u) => (u.totalEur ?? 0) > 0);
  const title = bg ? "Поръчките на културата" : "Culture's public contracts";

  return (
    <>
      <Title
        description={
          bg
            ? "Обществените поръчки на държавните културни институти, националните училища по изкуствата и Министерството на културата — пари, конкуренция и изпълнители, с националната база до всяка цифра."
            : "The public contracts of Bulgaria's state cultural institutes, national art schools and Ministry of Culture — money, competition and contractors, each figure beside the national baseline."
        }
      >
        {title}
      </Title>
      <SectorBreadcrumb
        parent={{ label: bg ? "Култура" : "Culture", to: "/culture" }}
        current={bg ? "Обществени поръчки" : "Public contracts"}
      />

      <div className="mb-3 mt-3">
        <ScopeControl mode="toggle" />
      </div>

      {isLoading && (
        <div className="h-40 animate-pulse rounded-xl border bg-card" />
      )}

      {!isLoading && !model && (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {bg
            ? "Данните за поръчките не се заредиха."
            : "The contract data failed to load."}
        </div>
      )}

      {model && (
        <div className="space-y-6">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={bg ? "Договори" : "Contracts"}
              hint={
                bg
                  ? "Броят договори на институциите в регистъра, за избрания период."
                  : "Contracts awarded by the register's institutions in the selected window."
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {formatInt(model.contractCount ?? 0, lang)}
              </span>
            </StatCard>
            <StatCard
              label={bg ? "Стойност" : "Value"}
              hint={
                bg
                  ? "Сборът на договорите след анекси (текуща стойност)."
                  : "Contract value after amendments (current value)."
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {eur(model.totalEur ?? 0)}
              </span>
            </StatCard>
            <StatCard
              label={bg ? "Изпълнители" : "Contractors"}
              hint={
                bg
                  ? "Различни фирми с поне един договор."
                  : "Distinct companies with at least one contract."
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {formatInt(model.supplierCount, lang)}
              </span>
            </StatCard>
            <StatCard
              label={bg ? "С една оферта" : "Single-bidder"}
              hint={
                bg
                  ? "Дял от договорите с известен брой оферти, при които кандидатът е един. Националната база стои до него, защото сама по себе си тази цифра не значи нищо."
                  : "Share of bid-known contracts with a single bidder. The national baseline sits beside it, because on its own the figure means nothing."
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {model.singleBidShare == null
                  ? "—"
                  : formatPct(model.singleBidShare, lang)}
              </span>
              {nationalRate != null && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {bg
                    ? `при ${formatPct(nationalRate, lang)} за страната`
                    : `against ${formatPct(nationalRate, lang)} nationally`}
                </span>
              )}
            </StatCard>
          </div>

          <section id="contractors" className="scroll-mt-20 space-y-2">
            <h2 className="text-lg font-semibold">
              {bg ? "Изпълнители на културата" : "Culture's contractors"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {bg
                ? "Класацията за сектора. Националната класация на /procurement/contractors не може да бъде филтрирана по сектор — тя брои изпълнители, а секторът е свойство на възложителя."
                : "The sector's own leaderboard. The national list at /procurement/contractors cannot be filtered by sector — it counts contractors, and the sector is a property of the buyer."}
            </p>
            <ol className="divide-y rounded-xl border bg-card text-sm">
              {model.suppliers.slice(0, 20).map((s, i) => (
                <li
                  key={s.eik}
                  className="flex items-baseline justify-between gap-3 px-4 py-2"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="w-5 shrink-0 tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <CompanyLink
                      eik={s.eik}
                      className="truncate hover:underline"
                    >
                      {s.name}
                    </CompanyLink>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {eur(s.totalEur)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatInt(s.contractCount, lang)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section id="network" className="scroll-mt-20 space-y-2">
            <h2 className="text-lg font-semibold">
              {bg
                ? "Доставчици на повече от един възложител"
                : "Suppliers serving more than one buyer"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {bg
                ? "Културата е много малки, независими възложители. Един доставчик при няколко от тях е формата, от която тръгва проверка — не е нередност сама по себе си."
                : "Culture is many small, independent buyers. One supplier across several of them is the shape an investigation starts from — not, in itself, a finding."}
            </p>
            <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
              {bg
                ? "Този разрез още не се публикува. Групираният модел връща изпълнител-по-стойност и възложител-по-стойност, но не и коя фирма при кой възложител — за връзката трябва ребро доставчик×възложител, което заявката днес не носи."
                : "This cut is not published yet. The group model returns contractor-by-value and buyer-by-value, but not which company served which buyer — the link needs a supplier×buyer edge the query does not carry today."}
            </p>
          </section>

          <section id="buyers" className="scroll-mt-20 space-y-2">
            <h2 className="text-lg font-semibold">
              {bg ? "Кой купува" : "Who buys"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {bg
                ? `${formatInt(buyers.length, lang)} от ${formatInt(eiks.length, lang)} институции в регистъра са възлагали в избрания период.`
                : `${formatInt(buyers.length, lang)} of ${formatInt(eiks.length, lang)} institutions in the register awarded a contract in this window.`}
            </p>
            <ol className="divide-y rounded-xl border bg-card text-sm">
              {[...buyers]
                .sort((a, b) => b.totalEur - a.totalEur)
                .slice(0, 25)
                .map((u) => {
                  const rate = u.bidKnownN ? u.singleBidN / u.bidKnownN : null;
                  return (
                    <li
                      key={u.eik}
                      className="flex items-baseline justify-between gap-3 px-4 py-2"
                    >
                      <Link
                        to={`/awarder/${u.eik}`}
                        className="min-w-0 truncate hover:underline"
                      >
                        {NAMES[u.eik] ?? u.eik}
                      </Link>
                      <span className="shrink-0 tabular-nums">
                        {eur(u.totalEur)}
                        {rate != null && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {formatPct(rate, lang)}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
            </ol>
          </section>
        </div>
      )}
    </>
  );
};
