import { MapCoordinates } from "@/layout/MapLayout";
import { SVGMapContainer } from "./maps/SVGMapContainer";
import { useTooltip } from "@/ux/useTooltip";
import { useMapElements } from "./maps/useMapElements";
import { SettlementJSONProps } from "./maps/mapTypes";
import { useSettlementsMap } from "@/data/useSettlementsMap";
import { MunicipalityInfo } from "@/data/dataTypes";
import { useSettlementVotes } from "@/data/useSettlementVotes";
import { useSettlementsInfo } from "@/data/useSettlements";

export const SettlementsMap: React.FC<{
  municipality: MunicipalityInfo;
  size: MapCoordinates;
  withNames: boolean;
}> = ({ size, withNames, municipality }) => {
  const { tooltip, ...tooltipEvents } = useTooltip();
  const mapGeo = useSettlementsMap(municipality.obshtina);
  const { settlementsByMunicipality } = useSettlementVotes();
  const votes = settlementsByMunicipality(municipality.obshtina);
  const { findSettlement } = useSettlementsInfo();
  const findInfo = (props: SettlementJSONProps) => findSettlement(props.ekatte);
  const findVotes = (props: SettlementJSONProps) =>
    votes?.find((v) => props.ekatte === v.ekatte);

  const { maps, labels, markers } = useMapElements<SettlementJSONProps>({
    findInfo,
    findVotes,
    mapGeo,
    size,
    votes,
    withNames,
    onClick: (props) => ({
      pathname: "/sections",
      search: {
        settlement: props.ekatte,
      },
    }),
    ...tooltipEvents,
  });

  return (
    <div>
      <div className="relative">
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
