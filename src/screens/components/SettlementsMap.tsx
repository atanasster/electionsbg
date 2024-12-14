import { useSettlementsInfo } from "@/data/useSettlements";
import { useSettlementVotes } from "@/data/useSettlementVotes";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { MapCoordinates } from "@/layout/MapLayout";
import { useSettlementsMap } from "@/data/useSettlementsMap";
import { MunicipalityInfo } from "@/data/dataTypes";
import { SettlementJSONProps } from "@/data/mapTypes";
import { GeoJSONMap } from "./maps/GeoJSONMap";

export const SettlementsMap: React.FC<
  React.PropsWithChildren<{
    municipality: MunicipalityInfo;
    size: MapCoordinates;
    withNames: boolean;
  }>
> = ({ municipality, size, children, withNames }) => {
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
        withNames={withNames}
      >
        {children}
      </GeoJSONMap>
    )
  );
};
