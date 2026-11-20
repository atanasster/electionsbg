// /sector/edu/bodies — the institutions that make up the sector, grouped by
// universe, each with its own procurement in the page's window; then the three
// lists that are SHOWN and never summed: VERIFY (principal unsettled — every
// ЦСОП / РЦПППО, D3), ADJACENT (an education body under another principal, D4)
// and the state higher schools that sit in another sector (A2).
// Plan: docs/plans/edu-hub-v1.md §3.
//
// It also carries what the generic /sector/:id shell gave this sector before the
// hub: the member finder (SectorMembersSearch) and the roster with its „whole
// group" link (SectorAwardersTile), both driven by the inert
// SECTOR_DASHBOARDS.edu entry.
//
// ONE ROW PER INSTITUTION (A5/A6): a retired EIK's contracts are folded into its
// successor's row, never listed as a second body.
//
// Counts are EX-MEMBER (awarder-group-rollup?exMembers=1), the basis the hub
// counts on.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark, HelpCircle, ArrowUpRight } from "lucide-react";
import { isBg } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { SectorMembersSearch } from "@/screens/sector/SectorMembersSearch";
import { SectorAwardersTile } from "@/screens/sector/SectorAwardersTile";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import { useEduRollup } from "@/data/edu/useEduSector";
import {
  EDU_ADJACENT,
  EDU_ENTITIES,
  EDU_SECTOR_EIKS,
  EDU_UNIVERSES,
  EDU_VERIFY,
  EDUCATION_EXTERNAL_HIGHER_SCHOOLS,
  educationUniverseLabel,
} from "@/lib/educationReferenceData";
import { EduPageFrame } from "./EduPageFrame";
import { eduPct, foldRetired, type Agg } from "./eduSectorData";

const ROLLUP_EIKS = [
  ...EDU_SECTOR_EIKS,
  ...EDU_VERIFY.map((v) => v.eik),
  ...EDU_ADJACENT.map((a) => a.eik),
];

const BodyRow: FC<{
  name: string;
  eik: string;
  agg: Agg | undefined;
  note?: string;
}> = ({ name, eik, agg, note }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1 text-sm">
      <span className="min-w-0">
        <AwarderLink eik={eik} className="hover:text-primary hover:underline">
          {name}
        </AwarderLink>
        {note ? (
          <span className="ml-1.5 text-xs text-muted-foreground">{note}</span>
        ) : null}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {agg && agg.contractCount > 0 ? (
          <>
            {formatEurCompact(agg.totalEur, lang)} ·{" "}
            {formatInt(agg.contractCount, lang)}{" "}
            {bg
              ? agg.contractCount === 1
                ? "договор"
                : "договора"
              : agg.contractCount === 1
                ? "contract"
                : "contracts"}
            {agg.bidKnownN >= 3
              ? ` · ${eduPct(agg.singleBidN / agg.bidKnownN, bg)} ${bg ? "с една оферта" : "single-bid"}`
              : ""}
          </>
        ) : bg ? (
          "няма договори в периода"
        ) : (
          "no contracts in the window"
        )}
      </span>
    </li>
  );
};

const OutsideCard: FC<{
  title: string;
  icon: FC<{ className?: string }>;
  rows: { eik: string; name: string; note?: string }[];
  byEik: Map<string, Agg>;
  footer: string;
  /** Rows carry no awarder € (e.g. the external higher schools, whose money is
   *  counted on another sector's page) — render the link only. */
  noAgg?: boolean;
}> = ({ title, icon: Icon, rows, byEik, footer, noAgg }) => (
  <Card className="border-dashed">
    <CardHeader className="pb-1">
      <CardTitle className="text-base flex items-center gap-2">
        <Icon className="h-4 w-4" />
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent className="p-3 md:p-4 pt-0 space-y-2">
      <ul className="divide-y divide-border">
        {rows.map((r) =>
          noAgg ? (
            <li key={r.eik} className="py-1 text-sm">
              <AwarderLink
                eik={r.eik}
                className="hover:text-primary hover:underline"
              >
                {r.name}
              </AwarderLink>
              {r.note ? (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {r.note}
                </span>
              ) : null}
            </li>
          ) : (
            <BodyRow
              key={r.eik}
              eik={r.eik}
              name={r.name}
              note={r.note}
              agg={byEik.get(r.eik)}
            />
          ),
        )}
      </ul>
      <p className="text-[11px] text-muted-foreground/80">{footer}</p>
    </CardContent>
  </Card>
);

const SECTOR_NAME: Record<string, { bg: string; en: string }> = {
  defense: { bg: "отбрана", en: "defence" },
  security: { bg: "сигурност", en: "security" },
};

export const EduBodiesScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const config = SECTOR_DASHBOARDS.edu;
  const { bodies, isLoading, isError } = useEduRollup(ROLLUP_EIKS);
  const byEik = useMemo(() => foldRetired(bodies), [bodies]);
  const kind = (k: string) =>
    k === "csop"
      ? bg
        ? "ЦСОП"
        : "special-needs centre"
      : k === "rcpppo"
        ? bg
          ? "РЦПППО"
          : "inclusive-education centre"
        : "";

  return (
    <EduPageFrame
      title={{
        bg: "Институциите в образованието и науката",
        en: "The education and science institutions",
      }}
      description={{
        bg: "МОН и неговите агенции и дружества, държавните висши училища, БАН и Селскостопанската академия — с поръчките на всяка институция, и отделно тези, които не се включват в сумите.",
        en: "МОН and its agencies and companies, the state universities, the Academy of Sciences and the Agricultural Academy — with each institution's procurement, and apart from them the ones not counted in the totals.",
      }}
      scoped
      ready={[bodies]}
      status={{ isLoading, isError }}
    >
      <SectorMembersSearch config={config} bg={bg} />
      <section id="bodies" className="scroll-mt-24 space-y-4">
        {EDU_UNIVERSES.map((u) => {
          const members = EDU_ENTITIES.filter(
            (e) => e.universe === u && !e.retiredEikOf,
          ).sort(
            (a, b) =>
              (byEik.get(b.eik)?.totalEur ?? 0) -
              (byEik.get(a.eik)?.totalEur ?? 0),
          );
          if (!members.length) return null;
          return (
            <Card key={u} id={`universe-${u}`} className="scroll-mt-24">
              <CardHeader className="pb-1">
                <CardTitle className="text-base flex items-center gap-2">
                  <Landmark className="h-4 w-4" />
                  {educationUniverseLabel(u, lang)}
                  <span className="text-xs font-normal text-muted-foreground">
                    {formatInt(members.length, lang)}{" "}
                    {bg
                      ? members.length === 1
                        ? "институция"
                        : "институции"
                      : members.length === 1
                        ? "institution"
                        : "institutions"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 md:p-4 pt-0">
                <ul className="divide-y divide-border">
                  {members.map((m) => (
                    <BodyRow
                      key={m.eik}
                      eik={m.eik}
                      name={m.name}
                      agg={byEik.get(m.eik)}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </section>
      <section id="verify" className="scroll-mt-24 space-y-4">
        <OutsideCard
          title={
            bg ? "За проверка — извън сумите" : "To verify — outside the totals"
          }
          icon={HelpCircle}
          rows={EDU_VERIFY.map((v) => ({
            eik: v.eik,
            name: v.name,
            note: kind(v.kind),
          }))}
          byEik={byEik}
          footer={
            bg
              ? "Центровете за специална образователна подкрепа и за приобщаващо образование се финансират чрез МОН, но част от ЦСОП са общински, а регистърът на поръчките не позволява да се различат. Затова поръчките им са показани тук и не се включват в сумите на сектора."
              : "The special-needs and inclusive-education centres are financed through МОН, but some special-needs centres are municipal, and the procurement register cannot tell them apart. Their procurement is therefore shown here and not counted in the sector's totals."
          }
        />
        <OutsideCard
          title={
            bg
              ? "Образователни институции под друг принципал"
              : "Education bodies under another principal"
          }
          icon={ArrowUpRight}
          rows={EDU_ADJACENT.map((a) => ({
            eik: a.eik,
            name: a.name,
            note: bg ? `към ${a.principal}` : `under ${a.principal}`,
          }))}
          byEik={byEik}
          footer={
            bg
              ? "Тези институции са в образованието, но бюджетният им принципал не е МОН — показани са, не се включват в сумите."
              : "These bodies are in education, but their budget principal is not МОН — shown, not counted in the totals."
          }
        />
        <OutsideCard
          title={
            bg
              ? "Държавни висши училища в друг сектор"
              : "State higher schools in another sector"
          }
          icon={ArrowUpRight}
          rows={EDUCATION_EXTERNAL_HIGHER_SCHOOLS.map((e) => ({
            eik: e.eik,
            name: e.name,
            note: bg
              ? `сектор ${SECTOR_NAME[e.sector].bg}`
              : `${SECTOR_NAME[e.sector].en} sector`,
          }))}
          byEik={byEik}
          noAgg
          footer={
            bg
              ? "Бюджетният им принципал е друго министерство, затова поръчките им са в неговия сектор, а не тук."
              : "Their budget principal is another ministry, so their procurement is in that sector, not here."
          }
        />
      </section>
      <SectorAwardersTile config={config} />
    </EduPageFrame>
  );
};
