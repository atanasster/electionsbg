// Local-elections "pre-vote" flow tile. Renders the estimated transition Sankey
// from the most recent PARLIAMENTARY vote before the selected local cycle into
// that cycle's council ballot — the "where did the national-election voters go
// in the local council vote" view. Reuses the parliamentary presentational
// components (VoteFlowSankey / Mobile / Tooltip / Overlay); only the data source
// differs (usePrevoteFlow → /transitions_prevote, whose `from` is auto-picked as
// the preceding parliamentary election).
//
// Wiring mirrors VoteFlowTile.tsx (hover/pin highlight, pinned overlay,
// outside-click dismissal). `oblast` omitted → national scope; provided
// (3-letter code) → that oblast. Self-hides for the earliest cycle (no
// preceding parliamentary vote) and for any scope with no estimate file.
// Council ballot only; national + oblast scope only.

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitFork } from "lucide-react";
import { Link } from "@/ux/Link";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { usePrevoteFlow } from "@/data/local/usePrevoteFlow";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { StatCard } from "@/screens/dashboard/StatCard";
import {
  VoteFlowSankey,
  SankeyClickInfo,
} from "@/screens/components/voteFlow/VoteFlowSankey";
import { VoteFlowMobile } from "@/screens/components/voteFlow/VoteFlowMobile";
import {
  VoteFlowTooltip,
  VoteFlowHover,
} from "@/screens/components/voteFlow/VoteFlowTooltip";
import { VoteFlowOverlay } from "@/screens/components/voteFlow/VoteFlowOverlay";

const SANKEY_HEIGHT = 460;

type Pinned = { id: string; side: "from" | "to"; yFrac: number };

/** Parliamentary "from" date folder ("2023_04_02") → "02.04.2023". */
const parlDateLabel = (date?: string): string =>
  date ? date.split("_").reverse().join(".") : "";

export const LocalVoteFlowTile: FC<{ cycle: string; oblast?: string }> = ({
  cycle,
  oblast,
}) => {
  const { t } = useTranslation();
  const isMd = useMediaQueryMatch("md");
  const scope = oblast ?? "national";
  const { matrix, from, to, isLoading, hasFile, hasPair } = usePrevoteFlow(
    cycle,
    scope,
  );

  const [hover, setHover] = useState<VoteFlowHover | null>(null);
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dismiss the pinned overlay on any outside click.
  useEffect(() => {
    if (!pinned) return;
    const onDocClick = (e: MouseEvent) => {
      const node = e.target as Node;
      if (
        overlayRef.current &&
        !overlayRef.current.contains(node) &&
        containerRef.current &&
        !containerRef.current.contains(node)
      ) {
        setPinned(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [pinned]);

  const onClickNode = useCallback((info: SankeyClickInfo) => {
    setPinned({ id: info.id, side: info.side, yFrac: info.yFrac });
  }, []);

  const hoveredId = useMemo(() => {
    if (!hover) return null;
    return hover.kind === "node" ? hover.id : null;
  }, [hover]);
  const activeId = pinned?.id ?? hoveredId;

  const pinnedNodeResolved = pinned
    ? pinned.side === "from"
      ? matrix?.fromNodes.find((n) => n.id === pinned.id)
      : matrix?.toNodes.find((n) => n.id === pinned.id)
    : null;

  // Self-hide for the earliest cycle (no predecessor) once the index settled.
  if (!isLoading && !hasPair) return null;

  const isEmpty = !matrix || matrix.flows.length === 0;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitFork className="h-4 w-4" />
            <span>{t("vote_flow_tile_title")}</span>
          </div>
          <Link
            to="/where-did-votes-go/methodology"
            className="text-xs font-medium text-primary hover:underline"
          >
            {t("vote_flow_tile_methodology_link")}
          </Link>
        </div>
      }
      hint={t("local_prevote_flow_hint")}
    >
      <div ref={containerRef} className="relative w-full">
        {isLoading && !matrix ? (
          <div
            className="flex items-center justify-center text-sm text-muted-foreground"
            style={{ minHeight: SANKEY_HEIGHT }}
          >
            {t("loading")}
          </div>
        ) : isEmpty || !hasFile ? (
          <div
            className="flex items-center justify-center text-sm text-muted-foreground"
            style={{ minHeight: SANKEY_HEIGHT }}
          >
            {t("vote_flow_no_data")}
          </div>
        ) : isMd ? (
          <>
            <VoteFlowSankey
              matrix={matrix!}
              width={width}
              height={SANKEY_HEIGHT}
              hoveredId={activeId}
              pinnedId={pinned?.id ?? null}
              onHover={setHover}
              onClickNode={onClickNode}
            />
            <VoteFlowTooltip matrix={matrix!} hover={pinned ? null : hover} />
            {pinned && pinnedNodeResolved ? (
              <div ref={overlayRef}>
                <VoteFlowOverlay
                  matrix={matrix!}
                  nodeId={pinned.id}
                  anchorSide={pinned.side}
                  anchorYFrac={pinned.yFrac}
                  onClose={() => setPinned(null)}
                  onSelectNode={(id) =>
                    setPinned({ id, side: pinned.side, yFrac: pinned.yFrac })
                  }
                />
              </div>
            ) : null}
          </>
        ) : (
          <VoteFlowMobile matrix={matrix!} />
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {t("local_prevote_flow_caption", {
          from: parlDateLabel(from),
          to: friendlyCycleDate(to ?? cycle),
        })}
      </p>
    </StatCard>
  );
};
