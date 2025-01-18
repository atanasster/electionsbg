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
  pctStyle?: "plain" | "colored";
  size?: "xl" | "sm";
  className?: string;
  decimals?: number;
  pctSuffix?: string;
  pct2?: number;
  pct2Explainer?: ReactNode;
}> = ({
  value,
  pctChange,
  valueLabel,
  valueExplainer,
  pctExplainer,
  pctStyle,
  size = "sm",
  className,
  decimals = 2,
  pctSuffix,
  pct2,
  pct2Explainer,
}) => {
  return value ? (
    size === "xl" ? (
      <div className="flex justify-between items-center">
        <div className="flex my-4 gap-2">
          <Hint text={valueExplainer} underline={false} className={className}>
            <div className="text-2xl xl:text-4xl font-bold">
              {formatThousands(value, decimals)}
            </div>
          </Hint>
          {pctChange !== undefined && (
            <Hint text={pctExplainer} underline={false}>
              <PercentChange
                className="text-xl xl:text-lg font-semibold"
                pctChange={formatPct(pctChange)}
                style={pctStyle}
                suffix={pctSuffix}
              />
            </Hint>
          )}
        </div>
        {pct2 !== undefined && (
          <div>
            <Hint text={pct2Explainer} underline={false}>
              <PercentChange
                className="text-xl xl:text-lg font-semibold"
                pctChange={formatPct(pct2)}
                suffix={pctSuffix}
              />
            </Hint>
          </div>
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
              {formatThousands(value, decimals)}
            </span>
          </Hint>

          <Hint text={pctExplainer}>
            <PercentChange pctChange={pctChange} suffix={pctSuffix} />
          </Hint>
        </div>
      </div>
    )
  ) : null;
};
