import { FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMpEmbeddingOrder } from "@/data/parliament/votes/useMpEmbedding";
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
const TARGET_HEIGHT = 480;
const PARTY_LABEL_COL = 80; // left column reserved for party-band labels
const X_AXIS_H = 28; // bottom band for item-number labels
const PARTY_STRIP_W = 4;
const GAP = 2;

// Roll-call heatmap. Y-axis = MPs sorted by embedding x-coordinate so MPs who
// vote similarly cluster together. X-axis = items sorted by closeness (smallest
// margin first), so contested votes — the interesting ones — cluster on the
// left. Cell colour encodes the cast vote (or absent).
export const RollcallHeatmap: FC<Props> = ({ session }) => {
  const { t } = useTranslation();
  const { order, isLoading: orderLoading } = useMpEmbeddingOrder();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();
  const [hovered, setHovered] = useState<{
    mpId: number;
    item: number;
  } | null>(null);
  // Callback ref so the observer attaches when the div actually mounts —
  // the component returns null while order data is loading, so a plain
  // useRef + useEffect([]) would observe a still-null node.
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

  const { rows, items, voteByMpItem, cellW, cellH, partyRuns } = useMemo(() => {
    const castItems = session.sessions.filter((it) => castCount(it) > 0);
    // Sort items by closeness — tightest margins first, unanimous votes last.
    // Stable tie-break by original item number so the layout is deterministic.
    const sortedItems = [...castItems].sort((a, b) => {
      const ma = marginOf(a);
      const mb = marginOf(b);
      if (ma !== mb) return ma - mb;
      return a.item - b.item;
    });

    const mpSet = new Set<number>();
    for (const it of sortedItems) {
      for (const v of it.votes) mpSet.add(v.mpId);
    }
    const allMps = [...mpSet];

    allMps.sort((a, b) => {
      const ra = order.get(a);
      const rb = order.get(b);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      const na = session.mpNames?.[String(a)] ?? "";
      const nb = session.mpNames?.[String(b)] ?? "";
      return na.localeCompare(nb);
    });

    const vMap = new Map<string, VoteValue>();
    for (const it of sortedItems) {
      for (const v of it.votes) {
        vMap.set(`${v.mpId}#${it.item}`, v.vote);
      }
    }

    const partyStripPlusGap = PARTY_LABEL_COL + PARTY_STRIP_W + GAP;
    const widthBudget = Math.max(120, containerWidth - partyStripPlusGap);
    const cw = Math.max(
      2,
      Math.floor(widthBudget / Math.max(1, sortedItems.length)),
    );
    const ch = Math.max(
      1,
      Math.min(4, Math.floor(TARGET_HEIGHT / Math.max(1, allMps.length))),
    );

    // Contiguous party runs along the y-axis. Used to label parties next to
    // the colour strip — one label per contiguous block. Groups smaller than
    // 4 MPs are skipped to keep labels from overlapping each other.
    const runs: {
      party: string;
      start: number;
      end: number;
    }[] = [];
    let cur: { party: string; start: number; end: number } | null = null;
    for (let i = 0; i < allMps.length; i++) {
      const party = session.mpParty?.[String(allMps[i])] ?? "—";
      if (!cur || cur.party !== party) {
        if (cur) runs.push(cur);
        cur = { party, start: i, end: i };
      } else {
        cur.end = i;
      }
    }
    if (cur) runs.push(cur);

    return {
      rows: allMps,
      items: sortedItems,
      voteByMpItem: vMap,
      cellW: cw,
      cellH: ch,
      partyRuns: runs,
    };
  }, [session, order, containerWidth]);

  if (orderLoading) return null;
  if (rows.length === 0 || items.length === 0) return null;

  const gridW = items.length * cellW;
  const gridH = rows.length * cellH;
  const svgW = PARTY_LABEL_COL + PARTY_STRIP_W + GAP + gridW;
  const svgH = gridH + X_AXIS_H;

  // Decide how often to draw an x-axis tick. Skip labels if the cell is too
  // narrow to fit even 2 characters (saves crowding when there are hundreds
  // of items in one session).
  const xTickStride = cellW >= 14 ? 1 : cellW >= 7 ? 2 : cellW >= 4 ? 5 : 10;

  const hoveredVote =
    hovered != null
      ? voteByMpItem.get(`${hovered.mpId}#${hovered.item}`)
      : null;
  const hoveredMpName =
    hovered != null
      ? (session.mpNames?.[String(hovered.mpId)] ?? `MP #${hovered.mpId}`)
      : null;
  const hoveredItemTitle =
    hovered != null ? session.itemTitles?.[String(hovered.item)] : null;

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-1">
        {t("votes_heatmap_title") || "Vote-by-MP heatmap"}
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        {t("votes_heatmap_axis_mps_v2") ||
          "MPs (clustered by voting pattern) · items (closest votes first)"}
      </p>

      <div ref={setContainerEl} className="relative w-full">
        <svg
          width={svgW}
          height={svgH}
          className="block max-w-full"
          role="img"
          aria-label={t("votes_heatmap_title") || "Vote-by-MP heatmap"}
        >
          {/* Party-band labels on the left, one per contiguous run of ≥4 MPs */}
          {partyRuns
            .filter((r) => r.end - r.start + 1 >= 4)
            .map((r) => {
              const midY = ((r.start + r.end + 1) / 2) * cellH;
              return (
                <text
                  key={`pl-${r.party}-${r.start}`}
                  x={PARTY_LABEL_COL - 4}
                  y={midY}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="currentColor"
                  className="text-muted-foreground"
                >
                  {labelForPartyShort(r.party) || r.party}
                </text>
              );
            })}

          {/* Party-colour strip — one rect per MP row */}
          {rows.map((mpId, ri) => {
            const party = session.mpParty?.[String(mpId)];
            const fill = colorForPartyShort(party) ?? "#94a3b8";
            return (
              <rect
                key={`p-${mpId}`}
                x={PARTY_LABEL_COL}
                y={ri * cellH}
                width={PARTY_STRIP_W}
                height={cellH}
                fill={fill}
              />
            );
          })}

          {/* Cells */}
          {rows.map((mpId, ri) =>
            items.map((it, ci) => {
              const vote = voteByMpItem.get(`${mpId}#${it.item}`) ?? "absent";
              return (
                <rect
                  key={`c-${mpId}-${it.item}`}
                  x={PARTY_LABEL_COL + PARTY_STRIP_W + GAP + ci * cellW}
                  y={ri * cellH}
                  width={cellW}
                  height={cellH}
                  fill={VOTE_COLOR[vote]}
                  onMouseEnter={() => setHovered({ mpId, item: it.item })}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            }),
          )}

          {/* X-axis: item numbers under each column, sampled per stride */}
          {items.map((it, ci) => {
            if (ci % xTickStride !== 0 && ci !== items.length - 1) return null;
            const cx =
              PARTY_LABEL_COL + PARTY_STRIP_W + GAP + ci * cellW + cellW / 2;
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

        {hovered && (
          <div className="absolute top-0 left-0 right-0 pointer-events-none bg-popover border rounded-md px-3 py-2 text-xs shadow-md max-w-md">
            <div className="font-semibold mb-0.5">{hoveredMpName}</div>
            {hoveredItemTitle && (
              <div className="text-muted-foreground line-clamp-2 mb-1">
                #{hovered.item}: {hoveredItemTitle}
              </div>
            )}
            {hoveredVote && (
              <div>
                <span className="text-muted-foreground">
                  {t("votes_session_party") || "Vote"}:{" "}
                </span>
                <span
                  className="font-semibold"
                  style={{ color: VOTE_COLOR[hoveredVote] }}
                >
                  {t(VOTE_LABEL[hoveredVote]) || hoveredVote}
                </span>
              </div>
            )}
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
