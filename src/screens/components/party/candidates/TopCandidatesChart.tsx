import { Bar, BarChart, Cell, CartesianGrid, XAxis, LabelList } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { PartyInfo, RegionInfo } from "@/data/dataTypes";
import { FC } from "react";
import { formatThousands } from "@/data/utils";
import { useCandidates } from "@/data/preferences/useCandidates";
import { usePreferencesStats } from "./data/usePreferencesStats";
import { useNavigateParams } from "@/ux/useNavigateParams";
import { useRegions } from "@/data/regions/useRegions";
import { useTranslation } from "react-i18next";

const CustomTooltip: FC<{
  active?: boolean;
  payload?: {
    value: number;
    payload: { pctVotes: number; name: string; region: RegionInfo };
  }[];
  label?: string;
}> = ({ active, payload }) => {
  const { t, i18n } = useTranslation();
  return active && payload ? (
    <div className="z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2">
      <div className="flex">
        <div className="text-muted">{`${payload[0].payload.name} (${i18n.language === "en" ? payload[0].payload.region.name_en : payload[0].payload.region.name}):`}</div>
        <div className="ml-2 font-semibold">
          {`${formatThousands(payload[0].value)} ${t("pref.")}`}
        </div>
      </div>
    </div>
  ) : null;
};

export const TopCandidatesChart: FC<{
  maxRows?: number;
  party: PartyInfo;
}> = ({ party, maxRows = 5 }) => {
  const { findCandidate } = useCandidates();
  const navigate = useNavigateParams();
  const stats = usePreferencesStats(party);
  const { findRegion } = useRegions();
  const preferences = stats?.top?.slice(0, maxRows).map((p) => {
    const candidate = p.oblast
      ? findCandidate(p.oblast, p.partyNum, p.pref)
      : undefined;
    const nameParts = candidate?.name.split(" ");
    const region = findRegion(p.oblast);
    nameParts?.splice(1, 1);
    return {
      ...p,
      name: nameParts?.join(" "),
      region,
      pctVotes: stats?.totalVotes
        ? 100 * (p.totalVotes / stats.totalVotes)
        : undefined,
    };
  });
  return (
    <ChartContainer config={{}} style={{ maxHeight: "200px" }}>
      <BarChart
        accessibilityLayer
        data={preferences}
        margin={{ top: 0, left: 0, right: 0, bottom: 20 }}
      >
        <defs>
          <filter id="colored-bg" x="-5%" width="110%" y="0%" height="100%">
            <feFlood floodColor="rgba(0,0,0,0.5)" />
            <feComposite operator="over" in="SourceGraphic"></feComposite>
          </filter>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="nickName"
          angle={270}
          tickMargin={25}
          tick={true}
          tickFormatter={(value: string) => {
            if (value.length > 6) {
              const parts = value.split("-");
              if (parts.length > 1) {
                return parts[0];
              }
            }

            return maxRows ? value.slice(0, maxRows) : value;
          }}
          interval={0}
        />
        <ChartTooltip cursor={false} content={<CustomTooltip />} />
        <Bar dataKey="totalVotes" radius={8}>
          {preferences?.map((p) => (
            <Cell
              key={`cell-${p.partyNum}`}
              fill={party.color}
              cursor="pointer"
              onClick={() => navigate({ pathname: `/candidate/${p.name}` })}
            />
          ))}
          <LabelList
            dataKey="name"
            filter={"url(#colored-bg)"}
            position="insideEnd"
            className="fill-white"
            fontSize={10}
            fontWeight={900}
            angle={270}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
};
