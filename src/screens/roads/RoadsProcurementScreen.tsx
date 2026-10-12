// /sector/roads/procurement — the money over time and who receives it.
//
// Sections carry ids the hub links to: #contractors, #inhouse, #regions,
// #annexes, #pipeline. roadsRegistry.test.ts fails a hub link to a fragment this
// page does not render.
//
// The page is SCOPED (ScopeControl) except two blocks that say so: the option
// cluster (#annexes) and the tender pipeline (#pipeline), which are whole-corpus
// and current respectively.

import { FC } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { CompanyLink } from "@/screens/components/procurement/CompanyLink";
import { RoadTimeSpineTile } from "@/screens/components/procurement/roads/RoadTimeSpineTile";
import { RoadTopContractorsTile } from "@/screens/components/procurement/roads/RoadTopContractorsTile";
import { RoadRegionCompetitionTile } from "@/screens/components/procurement/roads/RoadRegionCompetitionTile";
import { RoadRepeatWinnersTile } from "@/screens/components/procurement/roads/RoadRepeatWinnersTile";
import { RoadPlannedTendersTile } from "@/screens/components/procurement/roads/RoadPlannedTendersTile";
import { RoadAnnexOptionsTile } from "@/screens/components/procurement/roads/RoadAnnexOptionsTile";
import { useRoadsHubStats } from "@/data/roads/hubStats";
import { ROADS_INHOUSE_CONTRACTORS } from "@/lib/roadsReferenceData";
import type { RoadsModel } from "@/lib/roadAttributes";
import { RoadsPageFrame } from "./RoadsPageFrame";

/** The state in-house contractor, in the page's window (D7). */
const InhouseCard: FC<{ model: RoadsModel }> = ({ model }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = isBg(lang);
  const body = ROADS_INHOUSE_CONTRACTORS[0];
  const rows = model.rows.filter((r) => r.c.contractorEik === body.eik);
  const eur = rows.reduce((s, r) => s + r.amountEur, 0);
  const known = rows.filter((r) => r.c.numberOfTenderers != null);
  const single = known.filter((r) => r.c.numberOfTenderers === 1).length;
  const share = model.totalEur > 0 ? eur / model.totalEur : 0;
  return (
    <Card id="inhouse" className="scroll-mt-24">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          <CompanyLink eik={body.eik} className="hover:underline">
            {bg ? body.name.bg : body.name.en}
          </CompanyLink>
          <span className="text-xs font-normal text-muted-foreground">
            {bg ? "държавно дружество" : "state company"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-2 text-sm">
        {rows.length ? (
          <p>
            {bg
              ? `${formatEurCompact(eur, lang)} по ${formatInt(rows.length, lang)} договора в избрания период — ${Math.round(share * 100)}% от стойността в сектора.`
              : `${formatEurCompact(eur, lang)} over ${formatInt(rows.length, lang)} contracts in the selected window — ${Math.round(share * 100)}% of the sector's value.`}
            {known.length
              ? bg
                ? ` ${single} от ${known.length} с известен брой оферти са с една оферта.`
                : ` ${single} of ${known.length} with a known bid count had a single bid.`
              : null}
          </p>
        ) : (
          <p className="text-muted-foreground">
            {bg
              ? "Няма договори с дружеството в избрания период."
              : "No contracts with the company in the selected window."}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Изпълнител, не възложител: дружеството получава поръчки от АПИ чрез вътрешно възлагане (чл. 14 ЗОП) и вътрешен конкурентен избор по рамково споразумение. Затова една оферта тук не означава неуспял търг. Сумите му вече са част от поръчките на АПИ и не се броят втори път."
            : "A contractor, not a buyer: the company receives work from АПИ by in-house award (ЗОП Art. 14) and by internal competitive selection under a framework. A single bid here is therefore not a failed market. Its sums are already part of АПИ's procurement and are not counted twice."}
        </p>
      </CardContent>
    </Card>
  );
};

const ProcurementBody: FC<{ model: RoadsModel }> = ({ model }) => {
  const { data: stats } = useRoadsHubStats();
  return (
    <>
      <RoadTimeSpineTile years={model.years} />
      <section id="contractors" className="scroll-mt-24">
        <RoadTopContractorsTile contractors={model.contractors} />
      </section>
      <InhouseCard model={model} />
      <section id="regions" className="scroll-mt-24 grid gap-4 xl:grid-cols-2">
        <RoadRegionCompetitionTile regions={model.regions} />
        <RoadRepeatWinnersTile rows={model.rows} />
      </section>
      {stats ? <RoadAnnexOptionsTile options={stats.annexOptions} /> : null}
      <section id="pipeline" className="scroll-mt-24">
        <RoadPlannedTendersTile />
      </section>
    </>
  );
};

export const RoadsProcurementScreen: FC = () => (
  <RoadsPageFrame
    title={{ bg: "Пътните поръчки", en: "Road contracts" }}
    description={{
      bg: "Обществените поръчки за пътища по години — кой ги печели, конкуренцията по областни пътни управления, държавното дружество „Автомагистрали“, анексите за точно +50% и планираните процедури.",
      en: "Road procurement by year — who wins it, competition by regional road directorate, the state company Avtomagistrali, the annexes of exactly +50% and the planned procedures.",
    }}
  >
    {(model) => <ProcurementBody model={model} />}
  </RoadsPageFrame>
);
