import { formatThousands } from "@/data/utils";
import { cn } from "@/lib/utils";

export const ThousandsChange = ({
  number,
  className,
  style = "colored",
  decimals,
}: {
  number: number | string | null | undefined;
  style?: "plain" | "colored";
  className?: string;
  decimals?: number;
}) => {
  if (number !== undefined && number !== null) {
    const numFloat = typeof number === "string" ? parseFloat(number) : number;
    return (
      <div
        className={cn(
          `text-center ${style === "colored" ? (numFloat < 0 ? "text-destructive" : numFloat > 0 ? "text-green-600" : "") : ""}`,
          className,
        )}
      >
        {`${numFloat === 0 ? "-" : style === "colored" && numFloat > 0 ? "+" : ""}${numFloat !== 0 ? formatThousands(numFloat, decimals) : ""}`}
      </div>
    );
  }
  return null;
};
