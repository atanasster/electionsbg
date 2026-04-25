import { FC, PropsWithChildren, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Hint } from "@/ux/Hint";

type Props = {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
};

export const StatCard: FC<PropsWithChildren<Props>> = ({
  label,
  hint,
  className,
  children,
}) => {
  const labelEl = (
    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
  );
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm",
        className,
      )}
    >
      {hint ? (
        <Hint text={hint} underline={false}>
          {labelEl}
        </Hint>
      ) : (
        labelEl
      )}
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
};
