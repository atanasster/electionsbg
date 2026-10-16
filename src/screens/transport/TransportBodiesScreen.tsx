// /sector/transport/bodies — the bodies that make up the sector: the ministry and
// the companies and agencies under it, grouped by mode, each with its own
// procurement in the page's window; the one body whose principal is unsettled
// (D3), shown apart and never summed; and the facility map at #map (D7).
// Plan: docs/plans/transport-hub-v1.md §3.
//
// It also carries what the generic /sector/:id shell gave this sector before the
// hub: the member finder (SectorMembersSearch) and the roster with its
// „whole group" link (SectorAwardersTile), both driven by the inert
// SECTOR_DASHBOARDS.transport entry.
//
// Counts are EX-MEMBER (awarder-group-rollup?exMembers=1), the basis the hub and
// the browse pack count on. Seats are a register fact and carry no period.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark, HelpCircle } from "lucide-react";
import { isBg } from "@/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { AwarderLink } from "@/screens/components/procurement/AwarderLink";
import { SectorMembersSearch } from "@/screens/sector/SectorMembersSearch";
import { SectorAwardersTile } from "@/screens/sector/SectorAwardersTile";
import { SECTOR_DASHBOARDS } from "@/screens/sector/sectorDashboards";
import {
  useTransportRollup,
  type TransportBodyAgg,
} from "@/data/transport/useTransportSector";
import {
  TRANSPORT_ENTITIES,
  TRANSPORT_SECTOR_EIKS,
  TRANSPORT_UNIVERSES,
  TRANSPORT_VERIFY,
  transportBodyName,
  transportUniverseLabel,
} from "@/lib/transportReferenceData";
import { TransportPageFrame } from "./TransportPageFrame";
import { TransportFacilityMap } from "./TransportFacilityMap";
import { bodiesWord, contractsWord } from "./transportCopy";

const ROLLUP_EIKS = [
  ...TRANSPORT_SECTOR_EIKS,
  ...TRANSPORT_VERIFY.map((v) => v.eik),
];

const pct = (v: number, bg: boolean) =>
  new Intl.NumberFormat(bg ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 0,
  }).format(v * 100) + "%";

const BodyRow: FC<{
  name: string;
  eik: string;
  agg: TransportBodyAgg | undefined;
}> = ({ name, eik, agg }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1 text-sm">
      <AwarderLink
        eik={eik}
        className="min-w-0 hover:text-primary hover:underline"
      >
        {name}
      </AwarderLink>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {agg && agg.contractCount > 0 ? (
          <>
            {formatEurCompact(agg.totalEur, lang)} ·{" "}
            {formatInt(agg.contractCount, lang)}{" "}
            {contractsWord(agg.contractCount, bg)}
            {agg.singleBidShare != null && agg.bidKnownN >= 3
              ? ` · ${pct(agg.singleBidShare, bg)} ${bg ? "с една оферта" : "single-bid"}`
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

export const TransportBodiesScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const config = SECTOR_DASHBOARDS.transport;
  const { bodies, isLoading, isError } = useTransportRollup(ROLLUP_EIKS);
  const byEik = useMemo(() => new Map(bodies.map((b) => [b.eik, b])), [bodies]);

  return (
    <TransportPageFrame
      title={{ bg: "Структурите в транспорта", en: "The transport bodies" }}
      description={{
        bg: "Министерството на транспорта и дружествата и агенциите към него — железници, пристанища и Дунав, въздушен и автомобилен транспорт — с поръчките на всяка структура и седалищата им на карта.",
        en: "The Ministry of Transport and the companies and agencies under it — railways, ports and the Danube, air and road transport — with each body's procurement and their seats on a map.",
      }}
      scoped
      ready={[bodies]}
      status={{ isLoading, isError }}
    >
      <SectorMembersSearch config={config} bg={bg} />
      <section id="bodies" className="scroll-mt-24 space-y-4">
        {TRANSPORT_UNIVERSES.map((u) => {
          const members = TRANSPORT_ENTITIES.filter((e) => e.universe === u);
          if (!members.length) return null;
          return (
            <Card key={u}>
              <CardHeader className="pb-1">
                <CardTitle className="text-base flex items-center gap-2">
                  <Landmark className="h-4 w-4" />
                  {transportUniverseLabel(u, lang)}
                  <span className="text-xs font-normal text-muted-foreground">
                    {formatInt(members.length, lang)}{" "}
                    {bodiesWord(members.length, bg)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 md:p-4 pt-0">
                <ul className="divide-y divide-border">
                  {members.map((m) => (
                    <BodyRow
                      key={m.eik}
                      eik={m.eik}
                      name={transportBodyName(m.eik, lang)}
                      agg={byEik.get(m.eik)}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </section>
      {TRANSPORT_VERIFY.length ? (
        <Card className="border-dashed">
          <CardHeader className="pb-1">
            <CardTitle className="text-base flex items-center gap-2">
              <HelpCircle className="h-4 w-4" />
              {bg
                ? "За проверка — извън сумите"
                : "To verify — outside the totals"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4 pt-0 space-y-2">
            <ul className="divide-y divide-border">
              {TRANSPORT_VERIFY.map((v) => (
                <BodyRow
                  key={v.eik}
                  eik={v.eik}
                  name={transportBodyName(v.eik, lang)}
                  agg={byEik.get(v.eik)}
                />
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground/80">
              {bg
                ? `Принципалът на тази структура не е потвърден (${TRANSPORT_VERIFY.map((v) => v.why).join("; ")}), затова поръчките ѝ се показват тук, но не се включват в сумите на сектора.`
                : "This body's principal is not confirmed (a mixed Bulgarian–Romanian structure), so its procurement is shown here but not counted in the sector's totals."}
            </p>
          </CardContent>
        </Card>
      ) : null}
      <section id="map" className="scroll-mt-24">
        <TransportFacilityMap />
      </section>
      <SectorAwardersTile config={config} />
    </TransportPageFrame>
  );
};
