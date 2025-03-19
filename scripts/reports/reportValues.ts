import { CalcProcProps, CalcRowType, round } from "./report_types";
import { topPartyValues } from "./values/top_party";
import { calcGainsProc } from "./values/calc_gains";
import { calcSuemgValues } from "./values/suemg_values";
import { calcRecountValues } from "./values/recount";
import {
  ElectionMunicipality,
  ElectionSettlement,
  SectionInfo,
} from "@/data/dataTypes";

type ReportValue = {
  name: string;
  direction: "asc" | "desc";
  calc: <DType extends ElectionMunicipality | ElectionSettlement | SectionInfo>(
    p: CalcProcProps<DType>,
  ) => CalcRowType | undefined;
};

export const reportValues: ReportValue[] = [
  {
    name: "turnout",
    direction: "desc",
    calc: ({ votes, protocol }) => {
      return {
        ...topPartyValues(votes, protocol),
        value: protocol?.numRegisteredVoters
          ? round(
              100 * (protocol.totalActualVoters / protocol.numRegisteredVoters),
            )
          : undefined,
      } as CalcRowType;
    },
  },
  {
    name: "concentrated",
    direction: "desc",
    calc: ({ votes, protocol }) => {
      const topVotes = topPartyValues(votes, protocol);
      return {
        ...topVotes,
        value: topVotes?.pctPartyVote,
      } as CalcRowType;
    },
  },
  {
    name: "additional_voters",
    direction: "desc",
    calc: ({ votes, protocol }) => {
      return {
        ...topPartyValues(votes, protocol),
        value: protocol?.totalActualVoters
          ? round(
              100 *
                ((protocol.numAdditionalVoters || 0) /
                  protocol.totalActualVoters),
            )
          : undefined,
      } as CalcRowType;
    },
  },
  {
    name: "invalid_ballots",
    direction: "desc",
    calc: ({ votes, protocol }) => {
      return {
        ...topPartyValues(votes, protocol),
        value: protocol?.numPaperBallotsFound
          ? round(
              100 *
                ((protocol.numInvalidBallotsFound || 0) /
                  protocol.numPaperBallotsFound),
            )
          : undefined,
      } as CalcRowType;
    },
  },
  {
    name: "supports_noone",
    direction: "desc",
    calc: ({ votes, protocol }) => {
      return {
        ...topPartyValues(votes, protocol),
        value: protocol?.totalActualVoters
          ? 100 *
            round(
              ((protocol.numValidNoOnePaperVotes || 0) +
                (protocol.numValidNoOneMachineVotes || 0)) /
                protocol.totalActualVoters,
            )
          : undefined,
      } as CalcRowType;
    },
  },
  {
    name: "top_gainers",
    direction: "desc",
    calc: (p) => calcGainsProc(p, true),
  },
  {
    name: "top_losers",
    direction: "asc",
    calc: (p) => calcGainsProc(p, false),
  },
  {
    name: "suemg",
    direction: "desc",
    calc: (props) => {
      const result = calcSuemgValues(props);

      if (
        result?.pctSuemg === 0 &&
        result?.suemgVotes &&
        result?.machineVotes !== 0
      ) {
        return result;
      }
      return undefined;
    },
  },
  {
    name: "suemg_added",
    direction: "desc",
    calc: (props) => {
      const result = calcSuemgValues(props);

      if (
        result?.pctSuemg &&
        result?.pctSuemg > 0 &&
        result?.suemgVotes &&
        result?.machineVotes !== 0
      ) {
        return result;
      }
      return undefined;
    },
  },
  {
    name: "suemg_removed",
    direction: "asc",
    calc: (props) => {
      const result = calcSuemgValues(props);

      if (
        result?.pctSuemg &&
        result?.pctSuemg < 0 &&
        result?.suemgVotes &&
        result?.machineVotes !== 0
      ) {
        return result;
      }
      return undefined;
    },
  },
  {
    name: "suemg_missing_flash",
    direction: "desc",
    calc: (props) => {
      const result = calcSuemgValues(props);
      if (result?.suemgVotes || result?.machineVotes === 0) {
        return undefined;
      }
      return result;
    },
  },
  {
    name: "recount",
    direction: "desc",
    calc: (props) => {
      return calcRecountValues(props);
    },
  },
  {
    name: "recount_zero_votes",
    direction: "desc",
    calc: (props) => {
      const { protocol, original } = props;
      if (
        !(
          (protocol?.numValidMachineVotes === 0 &&
            original?.removedMachineVotes !== 0) ||
          (protocol?.numValidVotes === 0 && original?.removedPaperVotes !== 0)
        )
      ) {
        return undefined;
      }
      return calcRecountValues(props);
    },
  },
];
