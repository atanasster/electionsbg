import { FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import type {
  SessionFile,
  SessionItem,
  VoteValue,
} from "@/data/parliament/votes/types";

type Props = {
  session: SessionFile;
};

const VOTE_COLOR: Record<VoteValue, string> = {
  yes: "#10b981",
  no: "#ef4444",
  abstain: "#f59e0b",
  absent: "#e5e7eb",
};

const VOTE_LABEL: Record<VoteValue, string> = {
  yes: "vote_yes",
  no: "vote_no",
  abstain: "vote_abstain",
  absent: "vote_absent",
};

const castCount = (item: SessionItem): number =>
  item.tallies.yes + item.tallies.no + item.tallies.abstain;

const marginOf = (item: SessionItem): number =>
  Math.abs(item.tallies.yes - (item.tallies.no + item.tallies.abstain));

const FALLBACK_WIDTH = 600;
const LABEL_COL = 140; // left column for party-name labels
const STRIP_W = 3; // party-colour strip between label and cells
const GAP = 6;
const X_AXIS_H = 32;
const ROW_H = 26;
const ROW_GAP = 2;

type CellData = {
  party: string;
  counts: Record<VoteValue, number>;
  total: number;
};

// Roll-call heatmap. Rows = parliamentary groups (largest first); columns =
// items sorted by closeness (smallest margin first). Each cell is a stacked
// horizontal bar showing the group's split for that item — yes / no /
// abstain / absent — so cross-party patterns and intra-group splits are
// both visible at a glance. Aggregating to the group level keeps row height
// readable regardless of how many items the day's session contained.
export const RollcallHeatmap: FC<Props> = ({ session }) => {
  const { t } = useTranslation();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();
  const [hovered, setHovered] = useState<{
    party: string;
    item: number;
  } | null>(null);

  // Callback ref so the observer attaches when the div actually mounts.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(FALLBACK_WIDTH);

  useEffect(() => {
    if (!containerEl) return;
    const initial = containerEl.clientWidth;
    if (initial > 0) setContainerWidth(initial);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setContainerWidth(w);
      }
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  }, [containerEl]);

  const { parties, items, cells, cellW } = useMemo(() => {
    const castItems = session.sessions.filter((it) => castCount(it) > 0);
    const sortedItems = [...castItems].sort((a, b) => {
      const ma = marginOf(a);
      const mb = marginOf(b);
      if (ma !== mb) return ma - mb;
      return a.item - b.item;
    });

    // Build per-party MP count from the union of mpParty keys and every
    // mpId seen in any item's votes — covers non-attached MPs who only
    // show up in the per-item rows.
    const allMps = new Set<number>();
    for (const id of Object.keys(session.mpParty ?? {})) allMps.add(Number(id));
    for (const it of sortedItems) for (const v of it.votes) allMps.add(v.mpId);

    const partySize = new Map<string, number>();
    for (const mpId of allMps) {
      const p = session.mpParty?.[String(mpId)] ?? "—";
      partySize.set(p, (partySize.get(p) ?? 0) + 1);
    }

    const cellMap = new Map<string, CellData>();
    for (const it of sortedItems) {
      for (const [party, size] of partySize) {
        cellMap.set(`${party}#${it.item}`, {
          party,
          counts: { yes: 0, no: 0, abstain: 0, absent: 0 },
          total: size,
        });
      }
      for (const v of it.votes) {
        const party = session.mpParty?.[String(v.mpId)] ?? "—";
        const entry = cellMap.get(`${party}#${it.item}`);
        if (!entry) continue;
        entry.counts[v.vote]++;
      }
      // Backfill absent for any party member missing from the item's votes
      // (SessionItem.votes is meant to include every MP, but be defensive).
      for (const [party, size] of partySize) {
        const entry = cellMap.get(`${party}#${it.item}`)!;
        const seen =
          entry.counts.yes +
          entry.counts.no +
          entry.counts.abstain +
          entry.counts.absent;
        if (seen < size) entry.counts.absent += size - seen;
      }
    }

    const partyList = [...partySize.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .map(([p]) => p);

    const widthBudget = Math.max(
      120,
      containerWidth - LABEL_COL - STRIP_W - GAP,
    );
    const cw = Math.max(
      4,
      Math.floor(widthBudget / Math.max(1, sortedItems.length)),
    );

    return {
      parties: partyList,
      items: sortedItems,
      cells: cellMap,
      cellW: cw,
    };
  }, [session, containerWidth]);

  if (parties.length === 0 || items.length === 0) return null;

  const gridW = items.length * cellW;
  const gridH = parties.length * (ROW_H + ROW_GAP) - ROW_GAP;
  const svgW = LABEL_COL + STRIP_W + GAP + gridW;
  const svgH = gridH + X_AXIS_H;

  const xTickStride = cellW >= 24 ? 1 : cellW >= 12 ? 2 : cellW >= 6 ? 5 : 10;

  const hoveredCell = hovered
    ? cells.get(`${hovered.party}#${hovered.item}`)
    : null;
  const hoveredItemTitle = hovered
    ? session.itemTitles?.[String(hovered.item)]
    : null;

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-1">
        {t("votes_heatmap_title") || "Voting heatmap"}
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        {t("votes_heatmap_axis_groups") ||
          "Parliamentary groups · items sorted by closeness · each cell shows the group's vote split"}
      </p>

      <div ref={setContainerEl} className="relative w-full">
        <svg
          width={svgW}
          height={svgH}
          className="block max-w-full"
          role="img"
          aria-label={t("votes_heatmap_title") || "Voting heatmap"}
        >
          {parties.map((party, ri) => {
            const y = ri * (ROW_H + ROW_GAP);
            const fill = colorForPartyShort(party) ?? "#94a3b8";
            const label = labelForPartyShort(party) || party;
            return (
              <g key={`row-${party}`}>
                <text
                  x={LABEL_COL - 6}
                  y={y + ROW_H / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="currentColor"
                  className="text-foreground"
                >
                  {label}
                </text>
                <rect
                  x={LABEL_COL}
                  y={y}
                  width={STRIP_W}
                  height={ROW_H}
                  fill={fill}
                />
              </g>
            );
          })}

          {/* Cells — each is a stacked yes/no/abstain/absent bar */}
          {parties.map((party, ri) =>
            items.map((it, ci) => {
              const data = cells.get(`${party}#${it.item}`);
              if (!data) return null;
              const { total } = data;
              const x0 = LABEL_COL + STRIP_W + GAP + ci * cellW;
              const y0 = ri * (ROW_H + ROW_GAP);
              let xCursor = x0;
              const segs: { v: VoteValue; w: number; x: number }[] = [];
              for (const v of [
                "yes",
                "no",
                "abstain",
                "absent",
              ] as VoteValue[]) {
                const share = total > 0 ? data.counts[v] / total : 0;
                const w = share * cellW;
                if (w > 0) {
                  segs.push({ v, w, x: xCursor });
                  xCursor += w;
                }
              }
              const isHovered =
                hovered?.party === party && hovered.item === it.item;
              return (
                <g
                  key={`c-${party}-${it.item}`}
                  onMouseEnter={() => setHovered({ party, item: it.item })}
                  onMouseLeave={() => setHovered(null)}
                >
                  {segs.map((s) => (
                    <rect
                      key={`${party}-${it.item}-${s.v}`}
                      x={s.x}
                      y={y0}
                      width={s.w}
                      height={ROW_H}
                      fill={VOTE_COLOR[s.v]}
                    />
                  ))}
                  {isHovered && (
                    <rect
                      x={x0}
                      y={y0}
                      width={cellW}
                      height={ROW_H}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      className="text-foreground pointer-events-none"
                    />
                  )}
                </g>
              );
            }),
          )}

          {/* X-axis: item numbers under each column, sampled per stride */}
          {items.map((it, ci) => {
            if (ci % xTickStride !== 0 && ci !== items.length - 1) return null;
            const cx = LABEL_COL + STRIP_W + GAP + ci * cellW + cellW / 2;
            return (
              <g key={`x-${it.item}`}>
                <line
                  x1={cx}
                  x2={cx}
                  y1={gridH}
                  y2={gridH + 3}
                  stroke="currentColor"
                  className="text-muted-foreground/40"
                />
                <text
                  x={cx}
                  y={gridH + 6}
                  fontSize={9}
                  textAnchor="end"
                  fill="currentColor"
                  className="text-muted-foreground"
                  transform={`rotate(-55, ${cx}, ${gridH + 6})`}
                >
                  #{it.item}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered && hoveredCell && (
          <div className="absolute top-0 left-0 right-0 pointer-events-none bg-popover border rounded-md px-3 py-2 text-xs shadow-md max-w-md">
            <div className="font-semibold mb-0.5">
              {labelForPartyShort(hovered.party) || hovered.party}
              <span className="text-muted-foreground font-normal ml-2">
                · {hoveredCell.total}
              </span>
            </div>
            {hoveredItemTitle && (
              <div className="text-muted-foreground line-clamp-2 mb-1">
                #{hovered.item}: {hoveredItemTitle}
              </div>
            )}
            <div className="flex gap-3 flex-wrap">
              {(["yes", "no", "abstain", "absent"] as VoteValue[]).map((v) => {
                const c = hoveredCell.counts[v];
                if (c === 0) return null;
                const pct = Math.round((c / hoveredCell.total) * 100);
                return (
                  <span
                    key={v}
                    className="font-medium"
                    style={{ color: VOTE_COLOR[v] }}
                  >
                    {t(VOTE_LABEL[v]) || v}: {c} ({pct}%)
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
        {(["yes", "no", "abstain", "absent"] as VoteValue[]).map((v) => (
          <span key={v} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{ backgroundColor: VOTE_COLOR[v] }}
            />
            {t(VOTE_LABEL[v]) || v}
          </span>
        ))}
      </div>
    </section>
  );
};
