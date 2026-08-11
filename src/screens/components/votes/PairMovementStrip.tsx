// „Кой се сближи и кой се отдалечи" — every pair the selected parliament seats, against the
// last parliament that seated the same pair, biggest move first.
//
// The row prints WHICH parliament it is comparing against, and that is the point rather
// than a detail. For ГЕРБ-СДС↔ПП in the 52nd the comparison is the 48th, four parliaments
// back, because ПП sat inside ПП-ДБ in between — a generic „спрямо предишното НС" would
// name a parliament the number was never computed from.
//
// The list is NOT capped. A parliament with ten groups has 45 pairs; showing the top few
// and silently dropping the rest would read as „these are the pairs" rather than „these
// moved most", so the container scrolls instead.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { nsOrdinal } from "@/data/parliament/nsOrdinal";
import type { PairMovement } from "@/data/parliament/votes/partyPairs";

const pct = (v: number) => Math.round(v * 100);

export const PairMovementStrip: FC<{
  rows: PairMovement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  labelFor: (partyShort: string) => string;
  colorFor: (partyShort: string) => string;
  className?: string;
}> = ({ rows, selectedId, onSelect, labelFor, colorFor, className }) => {
  const { t, i18n } = useTranslation();
  if (rows.length === 0) return null;

  // Bars are scaled to the biggest move in this parliament, not to a fixed ±100: the moves
  // that matter are often ten points, and against a fixed scale every bar would be a stub.
  const widest = Math.max(
    ...rows.map((r) => (r.delta === null ? 0 : Math.abs(r.delta))),
    0.01,
  );

  return (
    <div className={className}>
      <ul className="divide-y max-h-[320px] overflow-y-auto pr-1">
        {rows.map((r) => {
          const selected = r.id === selectedId;
          const width =
            r.delta === null
              ? 0
              : Math.max(2, (Math.abs(r.delta) / widest) * 50);
          const up = (r.delta ?? 0) > 0;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                aria-pressed={selected}
                className={`w-full text-left py-2 px-2 rounded hover:bg-muted/60 ${
                  selected ? "bg-muted" : ""
                }`}
              >
                <div className="flex items-baseline gap-1.5 text-xs flex-wrap">
                  <span
                    className="font-medium truncate max-w-[42%]"
                    style={{ color: colorFor(r.a) }}
                  >
                    {labelFor(r.aRaw)}
                  </span>
                  <span className="text-muted-foreground">↔</span>
                  <span
                    className="font-medium truncate max-w-[42%]"
                    style={{ color: colorFor(r.b) }}
                  >
                    {labelFor(r.bRaw)}
                  </span>
                  {r.via && (
                    <span className="text-muted-foreground">
                      {t("corr_history_via", { group: r.via })}
                    </span>
                  )}
                  <span className="ml-auto tabular-nums font-semibold">
                    {pct(r.score)}%
                  </span>
                </div>

                {/* Diverging bar around a centre line: right/green = the pair converged,
                    left/red = it came apart. Same colour language as the heatmap above. */}
                <div className="mt-1 flex items-center gap-2">
                  <div className="relative h-1.5 flex-1 rounded bg-muted">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                    {r.delta !== null && (
                      <div
                        className={`absolute inset-y-0 rounded ${
                          up ? "bg-emerald-600" : "bg-red-600"
                        }`}
                        style={
                          up
                            ? { left: "50%", width: `${width}%` }
                            : { right: "50%", width: `${width}%` }
                        }
                      />
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {r.delta === null || r.prevNs === null
                      ? t("corr_history_new_pair")
                      : t("corr_history_delta", {
                          sign: r.delta > 0 ? "+" : "−",
                          points: Math.abs(pct(r.delta)),
                          // NOT `ns`: that is a RESERVED i18next option (the namespace),
                          // so passing the parliament under it made every lookup miss and
                          // rendered the raw key on every row.
                          nsLabel: nsOrdinal(r.prevNs, i18n.language),
                        }) +
                        // The comparison ran through a coalition or an older name, so the
                        // row says which rather than implying a like-for-like.
                        (r.prevVia
                          ? ` ${t("corr_history_via", { group: r.prevVia })}`
                          : "")}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
