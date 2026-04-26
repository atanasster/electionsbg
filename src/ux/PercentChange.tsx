import { cn } from "@/lib/utils";

export const PercentChange = ({
  pctChange,
  className,
  style = "colored",
  suffix = "%",
}: {
  pctChange: number | string | null | undefined;
  style?: "plain" | "colored";
  className?: string;
  suffix?: string;
}) => {
  if (pctChange !== undefined && pctChange !== null) {
    const pctFloat =
      typeof pctChange === "string" ? parseFloat(pctChange) : pctChange;
    return (
      <div
        className={cn(
          `font-bold text-center ${style === "colored" ? (pctFloat < 0 ? "text-negative" : pctFloat > 0 ? "text-positive" : "") : ""}`,
          className,
        )}
      >
        {`${pctFloat === 0 ? "-" : style === "colored" && pctFloat > 0 ? "+" : ""}${pctFloat !== 0 ? pctChange : ""}`}
        {pctFloat !== 0 ? suffix : ""}
      </div>
    );
  }
  return null;
};
