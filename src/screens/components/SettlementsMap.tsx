import { MapCoordinates } from "@/layout/MapLayout";
import { SVGMapContainer } from "./maps/SVGMapContainer";
import { useTooltip } from "@/ux/useTooltip";
import { useMapElements } from "./maps/useMapElements";
import { SettlementJSONProps } from "./maps/mapTypes";
import { useSettlementsMap } from "@/data/useSettlementsMap";
import { ElectionSettlement, MunicipalityInfo } from "@/data/dataTypes";
import { useSettlementsInfo } from "@/data/useSettlements";
import { useElectionContext } from "@/data/ElectionContext";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";

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

  const { maps, labels, markers } = useMapElements<SettlementJSONProps>({
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
