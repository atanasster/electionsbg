import { Bar, BarChart, Cell, CartesianGrid, XAxis, LabelList } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { PartyVotes } from "@/data/dataTypes";
import { FC } from "react";
import { useTranslation } from "react-i18next";
import { formatPct, formatThousands } from "@/data/utils";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";

const CustomTooltip: FC<{
  active?: boolean;
  payload?: {
    value: number;
    payload: { pctVotes: number; nickName: string };
  }[];
  label?: string;
}> = ({ active, payload }) => {
  const { t } = useTranslation();
  return active && payload ? (
    <div className="z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2">
      <div className="flex">
        <div className="text-muted">{`${payload[0].payload.nickName}:`}</div>
        <div className="ml-2 font-semibold">
          {`${formatThousands(payload[0].value)} ${payload[0].payload.pctVotes ? `(${formatPct(payload[0].payload.pctVotes, 2)})` : ""}`}
        </div>
        <div className="text-muted ml-1 lowercase ">{t("votes")}</div>
      </div>
    </div>
  ) : null;
};

export const VotesChart: FC<{ votes?: PartyVotes[]; maxRows?: number }> = ({
  votes,
  maxRows,
}) => {
  const isLarge = useMediaQueryMatch("lg");
  const topValue = votes?.length ? votes[0].totalVotes : undefined;
  return (
    <ChartContainer config={{}} style={{ maxHeight: "200px" }}>
      <BarChart
        accessibilityLayer
        data={votes}
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
          {votes?.map((p) => (
            <Cell key={`cell-${p.partyNum}`} fill={p.color} />
          ))}
          <LabelList
            filter={"url(#colored-bg)"}
            position="insideEnd"
            className="fill-white"
            fontSize={10}
            fontWeight={900}
            angle={270}
            formatter={(p: number) =>
              topValue && (!isLarge || p > topValue / 2)
                ? formatThousands(p)
                : undefined
            }
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
};
