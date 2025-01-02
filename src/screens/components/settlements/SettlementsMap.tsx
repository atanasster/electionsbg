import { MapCoordinates } from "@/layout/dataview/MapLayout";
import { useTooltip } from "@/ux/useTooltip";
import { useSettlementsMap } from "@/data/settlements/useSettlementsMap";
import { ElectionSettlement, MunicipalityInfo } from "@/data/dataTypes";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { SettlementJSONProps } from "../maps/mapTypes";
import { useMapElements } from "../maps/useMapElements";
import { SVGMapContainer } from "../maps/SVGMapContainer";
import { LeafletMap } from "../maps/LeafletMap";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined, string]>): Promise<
  ElectionSettlement[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(
    `/${queryKey[1]}/settlements/by/${queryKey[2]}.json`,
  );
  const data = await response.json();
  return data;
};

export const SettlementsMap: React.FC<{
  municipality: MunicipalityInfo;
  size: MapCoordinates;
  withNames: boolean;
}> = ({ size, withNames, municipality }) => {
  const { selected } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["settlements_by_municipality", selected, municipality.obshtina],
    queryFn,
    enabled: !!selected,
  });
  const { tooltip, ...tooltipEvents } = useTooltip();

  const mapGeo = useSettlementsMap(municipality.obshtina);
  const votes = data;
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
