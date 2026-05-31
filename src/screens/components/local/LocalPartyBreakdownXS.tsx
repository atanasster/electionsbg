// Compact party-breakdown table for local-elections map tooltips.
//
// The local analogue of PartyVotesXS (the parliamentary votes-map tooltip):
// a small uppercase total header followed by a ranked list of parties, each
// with a colour swatch, its value (mayors won / council seats) and its share
// of the total. Driven straight from the local regions_summary rows — no
// parliamentary party hooks.

import { FC } from "react";
import { formatPct, formatThousands } from "@/data/utils";

export type LocalBreakdownRow = {
  id: string;
  name: string;
  color: string;
  value: number;
};

export const LocalPartyBreakdownXS: FC<{
  // Already-localised total line, e.g. "31 mayors" / "401 seats".
  header: string;
  rows: LocalBreakdownRow[];
  // Denominator for the per-row share. Defaults to the sum of row values.
  total?: number;
  // How many parties to list (default 5, matching the parliamentary tooltip).
  limit?: number;
}> = ({ header, rows, total, limit = 5 }) => {
  if (!rows.length) return null;
  const denom = total ?? rows.reduce((a, r) => a + r.value, 0);
  const shown = rows.slice(0, limit);
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide opacity-70 text-center mb-1">
        {header}
      </div>
      <table className="w-full border-collapse text-[11px] leading-tight">
        <tbody>
          {shown.map((r) => {
            const pct = denom > 0 ? (100 * r.value) / denom : 0;
            return (
              <tr key={r.id} className="font-medium">
                <td className="py-0.5 pr-2">
                  <div className="flex items-center gap-1.5 max-w-[140px]">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-sm shrink-0"
                      style={{ backgroundColor: r.color }}
                    />
                    <span className="truncate">{r.name}</span>
                  </div>
                </td>
                <td className="py-0.5 pr-2 text-right tabular-nums opacity-90">
                  {formatThousands(r.value)}
                </td>
                <td className="py-0.5 text-right tabular-nums font-semibold">
                  {denom > 0 ? formatPct(pct) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
