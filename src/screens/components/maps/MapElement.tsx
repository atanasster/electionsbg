import type { GeoPath } from "d3-geo";
import { NavigateParams, useNavigateParams } from "@/ux/useNavigateParams";
import { FeatureMap } from "./FeatureMap";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { PartyVotesXS } from "../PartyVotesXS";
import { useTranslation } from "react-i18next";
import {
  GeoJSONFeature,
  GeoJSONProps,
} from "@/screens/components/maps/mapTypes";
import { LocationInfo, Votes } from "@/data/dataTypes";
import { TooltipEvents } from "@/ux/useTooltip";
import { RegionShift } from "./computeShifts";
import { useOptions } from "@/layout/dataview/OptionsContext";
import { useElectionContext } from "@/data/ElectionContext";
import { formatPct, localDate } from "@/data/utils";

export function MapElement<DType extends GeoJSONProps>({
  feature,
  geoPath,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  info,
  votes,
  shift,
  onClick,
  opacity,
  ariaLabel,
}: {
  feature: GeoJSONFeature<DType>;
  geoPath: GeoPath;
  votes?: Votes[];
  info?: LocationInfo;
  shift?: RegionShift;
  onClick: (props: DType) => NavigateParams;
  opacity?: number;
  /** What a screen reader announces for this region, and the switch that makes it OPERABLE.
   *
   *  ⚠ `FeatureMap` DERIVES KEYBOARD ACCESS AS `!!ariaLabel && !!onClick`, so every election
   *  map was silently MOUSE-ONLY: this component always passed `onClick` and never a label, and
   *  nothing renders half-done when that happens. The choropleths on the procurement side pass
   *  one and are focusable; the election maps — country, region, município, settlement — were
   *  not, which is §6's named defect sitting on the busiest pages on the site.
   *
   *  ⚠ AND IT IS OPT-IN, deliberately. `FeatureMap`'s own comment gives the reason: the section
   *  maps carry thousands of paths, and a tab order that long is worse than none. A caller
   *  supplies a label where the cardinality is small enough for the tab order to be usable. */
  ariaLabel?: string;
} & TooltipEvents) {
  const { properties: props } = feature;
  const navigate = useNavigateParams();
  const { t, i18n } = useTranslation();
  const { topVotesParty } = usePartyInfo();
  const party = topVotesParty(votes);
  const { withShiftArrows } = useOptions();
  const { priorElections } = useElectionContext();

  const showShift =
    withShiftArrows &&
    shift?.deltaPp !== undefined &&
    Math.abs(shift.deltaPp) >= 0.25;
  const priorDate = priorElections?.name
    ? localDate(priorElections.name)
    : undefined;

  return (
    <>
      <FeatureMap
        geoPath={geoPath}
        fillColor={party?.color}
        opacity={opacity}
        feature={feature}
        ariaLabel={ariaLabel}
        onMouseEnter={(e) => {
          onMouseEnter(
            { pageX: e.pageX, pageY: e.pageY },
            info ? (
              <div className="text-left">
                <div className="text-lg text-center pb-1">{`${i18n.language === "bg" ? info.long_name || info.name : info.long_name_en || info.name_en}`}</div>
                {!!votes && <PartyVotesXS votes={votes} />}
                {showShift && shift && (
                  <div className="mt-2 pt-2 border-t border-border text-[11px] leading-tight">
                    <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">
                      {priorDate
                        ? t("shift_vs", { date: priorDate })
                        : t("map_shift_arrows")}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        aria-hidden="true"
                        className="inline-block h-2 w-2 rounded-sm shrink-0"
                        style={{ backgroundColor: shift.currentColor }}
                      />
                      <span className="font-medium">
                        {shift.currentNickName}
                      </span>
                      <span
                        className={
                          shift.deltaPp! > 0
                            ? "text-emerald-300 font-semibold tabular-nums"
                            : "text-rose-300 font-semibold tabular-nums"
                        }
                      >
                        {shift.deltaPp! > 0 ? "↑ +" : "↓ "}
                        {shift.deltaPp!.toFixed(2)} {t("pp_short")}
                      </span>
                      <span className="opacity-70 tabular-nums">
                        ({formatPct(shift.currentPartyPriorPct, 1)} →{" "}
                        {formatPct(shift.currentPct, 1)})
                      </span>
                    </div>
                    {shift.flipped && shift.priorNickName && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="opacity-70">
                          {t("previous_leader")}:
                        </span>
                        <span
                          aria-hidden="true"
                          className="inline-block h-2 w-2 rounded-sm shrink-0"
                          style={{ backgroundColor: shift.priorColor }}
                        />
                        <span className="font-medium">
                          {shift.priorNickName}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null,
          );
        }}
        onMouseMove={(e) => onMouseMove({ pageX: e.pageX, pageY: e.pageY })}
        onMouseLeave={onMouseLeave}
        onClick={() => navigate(onClick(props))}
      />
    </>
  );
}
