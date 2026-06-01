// Municipal-council seat composition as a parliament-style hemicycle, with the
// majority line and an explicit "No Overall Control" (NOC) status — the single
// most important municipal-specific reading that a parliamentary dashboard
// never needs (largest party ≠ governing majority).
//
// Driven entirely by the already-loaded município bundle (council[].mandatesWon
// + primaryCanonicalId for colour) — no extra fetch.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { LocalCouncilParty } from "@/data/local/types";
import { StatCard } from "../StatCard";

const NEUTRAL = "#9ca3af"; // independents / unresolved party colour

type Seat = { x: number; y: number; angle: number };

// Lay out `n` seats in a 180° hemicycle across a sensible number of rows,
// returning unit coords (x ∈ [-1,1], y ∈ [-1,0]) ordered left → right so the
// party fill sweeps across the arc.
const hemicycleSeats = (n: number): Seat[] => {
  if (n <= 0) return [];
  const rows = Math.max(2, Math.min(6, Math.round(Math.sqrt(n / 2.2))));
  const r0 = 0.42; // inner-row radius (outer row = 1)
  const radii = Array.from({ length: rows }, (_, i) =>
    rows === 1 ? 1 : r0 + ((1 - r0) * i) / (rows - 1),
  );
  const radiusSum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.max(1, Math.round((n * r) / radiusSum)));
  // Reconcile rounding so the row counts sum to exactly n.
  let diff = n - counts.reduce((a, b) => a + b, 0);
  for (
    let i = counts.length - 1;
    diff !== 0 && i >= 0;
    i = i === 0 ? counts.length - 1 : i - 1
  ) {
    if (diff > 0) {
      counts[i]++;
      diff--;
    } else if (counts[i] > 1) {
      counts[i]--;
      diff++;
    }
  }
  const seats: Seat[] = [];
  radii.forEach((r, rowIdx) => {
    const c = counts[rowIdx];
    for (let s = 0; s < c; s++) {
      const angle = c === 1 ? Math.PI / 2 : Math.PI - (Math.PI * s) / (c - 1);
      seats.push({ x: r * Math.cos(angle), y: -r * Math.sin(angle), angle });
    }
  });
  // Left → right around the arc (high angle = left), inner rows first on ties.
  return seats.sort((a, b) => b.angle - a.angle);
};

export const LocalCouncilHemicycleTile: FC<{
  council: LocalCouncilParty[];
}> = ({ council }) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();

  const parties = useMemo(
    () =>
      council
        .filter((p) => p.mandatesWon > 0)
        .sort((a, b) => b.mandatesWon - a.mandatesWon)
        .map((p) => ({
          name: p.localPartyName,
          seats: p.mandatesWon,
          color: p.primaryCanonicalId
            ? colorFor(p.primaryCanonicalId) || NEUTRAL
            : NEUTRAL,
        })),
    [council, colorFor],
  );

  const total = parties.reduce((a, p) => a + p.seats, 0);
  const majority = Math.floor(total / 2) + 1;
  const leader = parties[0];
  const hasMajority = !!leader && leader.seats >= majority;

  const seatColors = useMemo(() => {
    const arr: string[] = [];
    parties.forEach((p) => {
      for (let i = 0; i < p.seats; i++) arr.push(p.color);
    });
    return arr;
  }, [parties]);

  const seats = useMemo(() => hemicycleSeats(total), [total]);

  if (total === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          <span>{t("local_council_hemicycle_title")}</span>
        </div>
      }
      hint={t("local_council_hemicycle_hint")}
    >
      <div className="flex flex-col items-center gap-3">
        <svg
          viewBox="-1.12 -1.16 2.24 1.28"
          className="w-full max-w-[420px]"
          role="img"
          aria-label={t("local_council_hemicycle_title")}
        >
          {seats.map((s, i) => (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={0.036}
              fill={seatColors[i] ?? NEUTRAL}
              stroke="rgba(0,0,0,0.15)"
              strokeWidth={0.004}
            />
          ))}
          {/* Total seats centred in the well of the arc. */}
          <text
            x={0}
            y={-0.06}
            textAnchor="middle"
            className="fill-foreground"
            style={{ font: "600 0.2px var(--font-sans, sans-serif)" }}
          >
            {total}
          </text>
        </svg>

        {/* Majority / No-Overall-Control status. */}
        <div className="w-full text-center text-sm">
          {hasMajority ? (
            <span>
              <span
                className="mr-1.5 inline-block size-2 rounded-full align-middle ring-1 ring-border"
                style={{ backgroundColor: leader.color }}
              />
              {t("local_council_majority_held", {
                party: leader.name,
                seats: leader.seats,
              })}
            </span>
          ) : (
            <span className="font-medium text-muted-foreground">
              {t("local_council_noc")}
            </span>
          )}
          <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {t("local_council_majority")}: {majority} / {total}
          </div>
        </div>

        {/* Legend: party → seats. */}
        <ul className="grid w-full grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {parties.map((p) => (
            <li
              key={p.name}
              className="flex items-center gap-2 text-sm min-w-0"
            >
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-full ring-1 ring-border shrink-0"
                style={{ backgroundColor: p.color }}
              />
              <span className="truncate" title={p.name}>
                {p.name}
              </span>
              <span className="ml-auto font-semibold tabular-nums shrink-0">
                {p.seats}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </StatCard>
  );
};
