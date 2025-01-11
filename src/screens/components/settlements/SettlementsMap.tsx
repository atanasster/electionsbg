import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useTooltip } from "@/ux/useTooltip";
import { useSettlementsMap } from "@/data/settlements/useSettlementsMap";
import { MunicipalityInfo } from "@/data/dataTypes";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { SettlementJSONProps } from "../maps/mapTypes";
import { useMapElements } from "../maps/useMapElements";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { LeafletMap } from "../maps/LeafletMap";
import { useSettlementsByMunicipality } from "@/data/settlements/useSettlementsByMunicipality";

export const SettlementsMap: React.FC<{
  municipality: MunicipalityInfo;
  size: MapCoordinates;
  withNames: boolean;
}> = ({ size, withNames, municipality }) => {
  const votes = useSettlementsByMunicipality(municipality.obshtina);
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useSettlementsMap(municipality.obshtina);
  const { findSettlement } = useSettlementsInfo();
  const findInfo = (props: SettlementJSONProps) => findSettlement(props.ekatte);
  const findVotes = (props: SettlementJSONProps) =>
    votes?.find((v) => props.ekatte === v.ekatte);

  const { maps, labels, markers, bounds, scale } =
    useMapElements<SettlementJSONProps>({
      findInfo,
      findVotes,
      mapGeo,
      size,
      votes,
      withNames,
      onClick: (props) => ({
        pathname: `/sections/${props.ekatte}`,
      }),
      ...tooltipEvents,
    });

  return (
    <div>
      <div className="relative">
        <LeafletMap size={size} bounds={bounds} scale={scale} />
        <SVGMapContainer size={size}>
          {maps}
          {markers}
          {labels}
        </SVGMapContainer>
      </div>
      {tooltip}
    </div>
  );
};
