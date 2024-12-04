import { useTranslation } from "react-i18next";

import { MapLayout } from "@/layout/MapLayout";
import { Title } from "@/ux/Title";
import { useRegionVotes } from "@/data/useRegionVotes";
import { ProtocolSummary } from "./components/ProtocolSummary";
import { useMemo } from "react";
import { TopParties } from "./components/TopParties";
import { usePrevElectionRegionVotes } from "@/data/usePrevElectionRegionVotes";
import { useMunicipalitydVotes } from "@/data/useMunicipalityVotes";
import { useContinentsMap } from "@/data/useContinentsMap";
import { usePartyInfo } from "@/data/usePartyInfo";
import { useMunicipalities } from "@/data/useMunicipalities";
import { PartyVotesXS } from "./components/PartyVotesXS";
import { useTooltip } from "@/ux/useTooltip";
import { useNavigateParams } from "@/ux/useNavigateParams";

export const WorldScreen = () => {
  const { t } = useTranslation();
  const navigate = useNavigateParams();
  const { continents } = useContinentsMap();
  const { votesWorld } = useRegionVotes();
  const { findMunicipality } = useMunicipalities();
  const { topVotesParty } = usePartyInfo();
  const { votesByRegion, votesByMunicipality } = useMunicipalitydVotes();
  const { prevVotesByRegion } = usePrevElectionRegionVotes();
  const { i18n } = useTranslation();
  const { onMouseEnter, onMouseMove, onMouseLeave, tooltip } = useTooltip();
  const results = useMemo(() => votesWorld(), [votesWorld]);
  const votesByContinent = useMemo(() => votesByRegion("32"), [votesByRegion]);
  const prevResults = useMemo(
    () => prevVotesByRegion("32"),
    [prevVotesByRegion],
  );
  return (
    <>
      <Title description="Interactive country map  of the elections in Bulgaria">
        {t("abroad")}
      </Title>
      <ProtocolSummary
        protocol={results?.results.protocol}
        votes={results?.results.votes}
      />
      {continents && (
        <>
          <MapLayout>
            {(size) => (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox={continents.viewBox}
                version="1.0"
                width={size[0]}
                height={size[1]}
              >
                {continents.paths.map((c) => {
                  const info = findMunicipality(c.key);
                  const votes =
                    (info && votesByMunicipality(info.obshtina)) || null;
                  return (
                    <g
                      className={`stroke-black stroke-[2] ${info ? "cursor-pointer" : "cursor-default"}`}
                      onMouseEnter={(e) => {
                        onMouseEnter(
                          e,
                          info ? (
                            <div className="text-left">
                              <div className="text-lg text-center pb-2">{`${i18n.language === "bg" ? info.long_name || info.name : info.long_name_en || info.name_en}`}</div>
                              {!!votes?.results.votes && (
                                <PartyVotesXS votes={votes?.results.votes} />
                              )}
                            </div>
                          ) : (
                            c.key
                          ),
                        );
                      }}
                      onMouseMove={(e) => {
                        onMouseMove(e);
                      }}
                      onMouseLeave={() => {
                        onMouseLeave();
                      }}
                      onClick={() => {
                        if (info) {
                          navigate({
                            pathname: "/settlement",
                            search: {
                              region: "32",
                              municipality: info.obshtina,
                            },
                          });
                        }
                      }}
                      key={c.key}
                      fill={
                        topVotesParty(
                          votesByContinent?.find((p) => p.obshtina === c.key)
                            ?.results.votes,
                        )?.color || "lightgrey"
                      }
                      transform={c.transform}
                    >
                      {c.paths.map((p, idx) => (
                        <path key={`${c.key}-${idx}`} d={p} />
                      ))}
                    </g>
                  );
                })}
              </svg>
            )}
          </MapLayout>
        </>
      )}
      <TopParties
        votes={results?.results.votes}
        prevElectionVotes={prevResults}
      />
      {tooltip}
    </>
  );
};
