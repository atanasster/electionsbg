import { FC, useMemo, useState } from "react";
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
  yes: "#10b981", // emerald
  no: "#ef4444", // red
  abstain: "#f59e0b", // amber
  absent: "#e5e7eb", // muted grey for "no vote cast"
};

const VOTE_LABEL: Record<VoteValue, string> = {
  yes: "vote_yes",
  no: "vote_no",
  abstain: "vote_abstain",
  absent: "vote_absent",
};

const castCount = (item: SessionItem): number =>
  item.tallies.yes + item.tallies.no + item.tallies.abstain;

// Auto-scale cell dimensions to keep the grid readable across viewport sizes
// while staying within ~600 px wide / ~480 px tall. Past 480 MPs the rows
// compress to a 1-px sliver, which is the right trade-off — the patterns
// remain visible even when individual rows can't be picked out by eye.
const TARGET_WIDTH = 600;
const TARGET_HEIGHT = 480;

// Roll-call heatmap. Y-axis = MPs sorted by embedding x-coordinate so MPs
// who vote similarly cluster together; X-axis = items in their roll-call
// order. Cell colour encodes the cast vote (or absent). Patterns to look
// for:
//   - one party's row flipping from green-to-red mid-grid = a defection
//     wave on a particular item
//   - vertical bands where a cluster votes opposite the rest = a cross-aisle
//     coalition forming for that item.
export const RollcallHeatmap: FC<Props> = ({ session }) => {
  const { t } = useTranslation();
  const { order, isLoading: orderLoading } = useMpEmbeddingOrder();
  const { colorForPartyShort } = useParliamentGroups();
  const [hovered, setHovered] = useState<{
    mpId: number;
    item: number;
  } | null>(null);

  const { rows, items, voteByMpItem, cellW, cellH } = useMemo(() => {
    const castItems = session.sessions.filter((it) => castCount(it) > 0);

    // Union of all MP ids seen in the session — typically every seated MP,
    // even those marked absent on every item.
    const mpSet = new Set<number>();
    for (const it of castItems) {
      for (const v of it.votes) mpSet.add(v.mpId);
    }
    const allMps = [...mpSet];

    // Primary key: embedding rank. Secondary key (for MPs without an
    // embedding point — typically those with too few votes to model): name
    // alphabetically so the bottom of the grid is still deterministic.
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

    // Build the (mpId, item) → vote map up front so cell render is O(1).
    const vMap = new Map<string, VoteValue>();
    for (const it of castItems) {
      for (const v of it.votes) {
        vMap.set(`${v.mpId}#${it.item}`, v.vote);
      }
    }

    const cw = Math.max(
      2,
      Math.min(10, Math.floor(TARGET_WIDTH / Math.max(1, castItems.length))),
    );
    const ch = Math.max(
      1,
      Math.min(4, Math.floor(TARGET_HEIGHT / Math.max(1, allMps.length))),
    );

    return {
      rows: allMps,
      items: castItems,
      voteByMpItem: vMap,
      cellW: cw,
      cellH: ch,
    };
  }, [session, order]);

  if (orderLoading) return null;
  if (rows.length === 0 || items.length === 0) return null;

  const gridW = items.length * cellW;
  const gridH = rows.length * cellH;
  const partyStripW = 4; // narrow vertical strip of party colour at row 0

  // Tooltip is rendered as a sibling absolute-positioned div on hover. Cell
  // hover state is local (no Radix tooltip per cell) — a few hundred cells
  // with full tooltips would slow scroll on mid-range laptops.
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
        {t("votes_heatmap_axis_mps") || "MPs (left-right by voting pattern)"} ·{" "}
        {t("votes_heatmap_axis_items") || "Items"}
      </p>

      <div className="relative">
        <svg
          width={gridW + partyStripW + 2}
          height={gridH}
          className="block max-w-full"
          role="img"
          aria-label={t("votes_heatmap_title") || "Vote-by-MP heatmap"}
        >
          {/* Party-colour strip on the left edge — one rect per MP row */}
          {rows.map((mpId, ri) => {
            const party = session.mpParty?.[String(mpId)];
            const fill = colorForPartyShort(party) ?? "#94a3b8";
            return (
              <rect
                key={`p-${mpId}`}
                x={0}
                y={ri * cellH}
                width={partyStripW}
                height={cellH}
                fill={fill}
              />
            );
          })}
          {/* Cells: one rect per (mp, item) tuple */}
          {rows.map((mpId, ri) =>
            items.map((it, ci) => {
              const vote = voteByMpItem.get(`${mpId}#${it.item}`) ?? "absent";
              return (
                <rect
                  key={`c-${mpId}-${it.item}`}
                  x={partyStripW + 2 + ci * cellW}
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
