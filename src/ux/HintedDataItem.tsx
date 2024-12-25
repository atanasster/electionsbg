import { FC, ReactNode } from "react";
import { Hint } from "./Hint";
import { formatPct, formatThousands } from "@/data/utils";
import { PercentChange } from "./PercentChange";

export const HintedDataItem: FC<{
  value?: number;
  pctChange?: number;
  valueLabel?: string;
  valueExplainer?: ReactNode;
  pctExplainer?: ReactNode;
  size?: "xl" | "sm";
  className?: string;
}> = ({
  value,
  pctChange,
  valueLabel,
  valueExplainer,
  pctExplainer,
  size = "sm",
  className,
}) => {
  return value ? (
    size === "xl" ? (
      <div className="flex my-4 ">
        <Hint text={valueExplainer} underline={false} className={className}>
          <div className="text-2xl xl:text-4xl mr-2 font-bold">
            {formatThousands(value, 2)}
          </div>
        </Hint>
        {pctChange !== undefined && (
          <Hint text={pctExplainer} underline={false}>
            <div
              className={`text-xl xl:text-lg font-semibold ${pctChange < 0 ? "text-destructive" : ""}`}
            >
              {formatPct(pctChange)}
            </div>
          </Hint>
        )}
      </div>
    ) : (
      <div
        className={`flex justify-between text-xs text-muted-foreground leading-6`}
      >
        {valueLabel && (
          <Hint text={valueExplainer} className={className}>
            <div>{`${valueLabel}: `}</div>
          </Hint>
        )}
        <div className="flex gap-2">
          <Hint text={valueExplainer} className={className}>
            <span className="font-bold text-primary">
              {formatThousands(value, 2)}
            </span>
          </Hint>
          {pctChange && (
            <Hint text={pctExplainer}>
              <PercentChange pctChange={pctChange} />
            </Hint>
          )}
        </div>
      </div>
    )
  ) : null;
};
