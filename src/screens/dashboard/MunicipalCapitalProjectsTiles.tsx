// The per-município capital-programme tiles, one per oblast-centre município
// that has an ingested programme (see the update-budget skill). Each tile
// self-hides unless its hard-coded obshtinaCode matches, so rendering the full
// set for any município surfaces exactly the one that applies (or none).
//
// Extracted so the parliamentary município dashboard and the local-elections
// município page share one list — adding a new município's programme is a
// single-file change here.

import { FC } from "react";
import { SofiaCapitalProjectsTile } from "./SofiaCapitalProjectsTile";
import { PlovdivCapitalProjectsTile } from "./PlovdivCapitalProjectsTile";
import { VarnaCapitalProjectsTile } from "./VarnaCapitalProjectsTile";
import { BurgasCapitalProjectsTile } from "./BurgasCapitalProjectsTile";
import { StaraZagoraCapitalProjectsTile } from "./StaraZagoraCapitalProjectsTile";
import { RuseCapitalProjectsTile } from "./RuseCapitalProjectsTile";
import { PlevenCapitalProjectsTile } from "./PlevenCapitalProjectsTile";
import { SlivenCapitalProjectsTile } from "./SlivenCapitalProjectsTile";
import { DobrichCapitalProjectsTile } from "./DobrichCapitalProjectsTile";
import { AsenovgradCapitalProjectsTile } from "./AsenovgradCapitalProjectsTile";
import { ShumenCapitalProjectsTile } from "./ShumenCapitalProjectsTile";
import { VidinCapitalProjectsTile } from "./VidinCapitalProjectsTile";
import { VelikoTarnovoCapitalProjectsTile } from "./VelikoTarnovoCapitalProjectsTile";
import { PernikCapitalProjectsTile } from "./PernikCapitalProjectsTile";
import { HaskovoCapitalProjectsTile } from "./HaskovoCapitalProjectsTile";
import { GabrovoCapitalProjectsTile } from "./GabrovoCapitalProjectsTile";
import { YambolCapitalProjectsTile } from "./YambolCapitalProjectsTile";
import { KardzhaliCapitalProjectsTile } from "./KardzhaliCapitalProjectsTile";
import { LovechCapitalProjectsTile } from "./LovechCapitalProjectsTile";
import { DupnitsaCapitalProjectsTile } from "./DupnitsaCapitalProjectsTile";
import { VelingradCapitalProjectsTile } from "./VelingradCapitalProjectsTile";
import { SamokovCapitalProjectsTile } from "./SamokovCapitalProjectsTile";
import { KarlovoCapitalProjectsTile } from "./KarlovoCapitalProjectsTile";
import { KazanlakCapitalProjectsTile } from "./KazanlakCapitalProjectsTile";
import { KyustendilCapitalProjectsTile } from "./KyustendilCapitalProjectsTile";
import { MontanaCapitalProjectsTile } from "./MontanaCapitalProjectsTile";

export const MunicipalCapitalProjectsTiles: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => (
  <>
    <SofiaCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <PlovdivCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <VarnaCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <BurgasCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <StaraZagoraCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <RuseCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <PlevenCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <SlivenCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <DobrichCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <AsenovgradCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <ShumenCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <VidinCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <VelikoTarnovoCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <PernikCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <HaskovoCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <GabrovoCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <YambolCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <KardzhaliCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <LovechCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <DupnitsaCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <VelingradCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <SamokovCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <KarlovoCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <KazanlakCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <KyustendilCapitalProjectsTile obshtinaCode={obshtinaCode} />
    <MontanaCapitalProjectsTile obshtinaCode={obshtinaCode} />
  </>
);
