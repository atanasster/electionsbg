import { formatPct } from "@/data/utils";

export const PercentChange = ({ pctChange }: { pctChange?: number }) =>
  !!pctChange && (
    <div
      className={`font-bold flex items-center ${pctChange < 0 ? "text-destructive" : ""}`}
    >
      {`(${formatPct(pctChange)})`}
    </div>
  );
