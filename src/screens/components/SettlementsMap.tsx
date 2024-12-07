import { useSettlementsInfo } from "@/data/useSettlements";
import { useSettlementVotes } from "@/data/useSettlementVotes";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { MapCoordinates } from "@/layout/MapLayout";
import { useSettlementsMap } from "@/data/useSettlementsMap";
import { MunicipalityInfo, RegionInfo } from "@/data/dataTypes";
import { SettlementJSONProps } from "@/data/mapTypes";
import { GeoJSONMap } from "./maps/GeoJSONMap";

export const SettlementsMap: React.FC<
  React.PropsWithChildren<{
    municipality: MunicipalityInfo;
    region: RegionInfo;
    size: MapCoordinates;
  }>
> = ({ region, municipality, size, children }) => {
  const navigate = useNavigateParams();

  const { findSettlement } = useSettlementsInfo();
  const { votesBySettlement } = useSettlementVotes();
  const settlements = useSettlementsMap(municipality.obshtina);
  const findInfo = (props: SettlementJSONProps) => {
    return findSettlement(getName(props));
  };
  const findVotes = (props: SettlementJSONProps) => {
    return votesBySettlement(getName(props))?.results.votes;
  };
  const getName = (props: SettlementJSONProps) => {
    return props.ekatte;
  };
  const onClick = (props: SettlementJSONProps) => {
    navigate({
      pathname: "/sections",
      search: {
        region: region.oblast,
        municipality: municipality.obshtina,
        settlement: getName(props),
      },
    });
  };
  return (
    settlements && (
      <GeoJSONMap<SettlementJSONProps>
        mapJSON={settlements}
        size={size}
        onClick={onClick}
        findVotes={findVotes}
        findInfo={findInfo}
        getName={getName}
      >
        {children}
      </GeoJSONMap>
    )
  );
};
