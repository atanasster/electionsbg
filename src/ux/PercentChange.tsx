import { cn } from "@/lib/utils";

export const PercentChange = ({
  pctChange,
  className,
}: {
  pctChange: number | string | null | undefined;
  className?: string;
}) =>
  !!pctChange && (
    <div
      className={cn(
        `font-bold text-center ${parseFloat(typeof pctChange === "string" ? pctChange : pctChange.toString()) < 0 ? "text-destructive" : ""}`,
        className,
      )}
    >
      {pctChange}
    </div>
  );
