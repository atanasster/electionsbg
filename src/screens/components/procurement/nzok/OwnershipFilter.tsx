// Shared "Всички / Държавни / Общински / Частни" pill-group, so every ownership-
// aware tile (payments, risk, …) renders the identical control instead of each
// re-declaring the same state type + markup. Presentational only — the parent owns
// the filter state and applies it to its rows.

import { FC } from "react";
import { ownershipLabel, type OwnershipFilterValue } from "@/lib/nzokOwnership";

const OPTIONS: OwnershipFilterValue[] = [
  "all",
  "state",
  "municipal",
  "private",
];

export const OwnershipFilter: FC<{
  value: OwnershipFilterValue;
  onChange: (v: OwnershipFilterValue) => void;
  bg: boolean;
}> = ({ value, onChange, bg }) => (
  <div
    className="flex flex-wrap gap-1"
    role="group"
    aria-label={bg ? "Филтър по собственост" : "Filter by ownership"}
  >
    {OPTIONS.map((f) => (
      <button
        key={f}
        type="button"
        onClick={() => onChange(f)}
        aria-pressed={f === value}
        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
          f === value
            ? "border-primary bg-primary/10 text-primary"
            : "border-border bg-background text-muted-foreground hover:text-foreground"
        }`}
      >
        {f === "all" ? (bg ? "Всички" : "All") : ownershipLabel(f, bg)}
      </button>
    ))}
  </div>
);
