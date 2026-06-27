// Shared label↔value row for the procurement detail screens (contract + tender).
// `flex-wrap` so the value drops below its label on narrow/mobile widths.
import { FC, ReactNode } from "react";

export const KvRow: FC<{ label: string; value: ReactNode }> = ({
  label,
  value,
}) => (
  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
    <dt className="text-xs uppercase tracking-wide text-muted-foreground min-w-[110px]">
      {label}
    </dt>
    <dd>{value}</dd>
  </div>
);
