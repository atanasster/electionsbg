import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitFork } from "lucide-react";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { useElectionContext } from "@/data/ElectionContext";
import { useVoteFlow, VoteFlowScope } from "@/data/voteFlows/useVoteFlow";
import { oblastToMir } from "@/data/parliament/nsFolders";
import { localDate } from "@/data/utils";
import { StatCard } from "@/screens/dashboard/StatCard";
import { VoteFlowSankey, SankeyClickInfo } from "./VoteFlowSankey";
import { VoteFlowMobile } from "./VoteFlowMobile";
import { VoteFlowTooltip, VoteFlowHover } from "./VoteFlowTooltip";
import { VoteFlowOverlay } from "./VoteFlowOverlay";

type Props = {
  /** Single 3-letter oblast code (BLG, BGS, …). Resolved to a 2-digit MIR
   * key so the tile fetches `/transitions/<from>_<to>/<mir>.json` only. */
  regionCode?: string;
  /** Multi-oblast list (Sofia city = S23+S24+S25). Per-oblast files are
   * fetched in parallel and merged. */
  regionCodes?: readonly string[];
};

const SANKEY_HEIGHT = 460;

type Pinned = { id: string; side: "from" | "to"; yFrac: number };

export const VoteFlowTile: FC<Props> = ({ regionCode, regionCodes }) => {
  const { t } = useTranslation();
  const isMd = useMediaQueryMatch("md");
  const { selected, priorElections } = useElectionContext();
  const fromDate = priorElections?.name;
  const toDate = selected;

  const scope = useMemo<VoteFlowScope | null>(() => {
    if (regionCodes?.length) {
      const mirs = regionCodes
        .map((c) => oblastToMir(c))
        .filter((m): m is string => !!m);
      if (!mirs.length) return null;
      return { kind: "oblasts", mirs };
    }
    if (regionCode) {
      const mir = oblastToMir(regionCode);
      return mir ? { kind: "oblast", mir } : null;
    }
    return { kind: "national" };
  }, [regionCode, regionCodes]);

  const { matrix, isLoading, hasFile } = useVoteFlow(
    fromDate,
    toDate,
    scope ?? { kind: "national" },
  );

  const [hover, setHover] = useState<VoteFlowHover | null>(null);
  const [pinned, setPinned] = useState<Pinned | null>(null);
  const [width, setWidth] = useState(0);
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const ent of entries) setWidth(ent.contentRect.width);
    });
    ro.observe(el);
  }, []);

  // Switching cycles or scope clears any pinned overlay so the user doesn't
  // see stale node details for the old matrix.
  useEffect(() => {
    setPinned(null);
    setHover(null);
  }, [fromDate, toDate, regionCode, regionCodes]);

  const onClickNode = useCallback((info: SankeyClickInfo) => {
    setPinned((prev) => (prev && prev.id === info.id ? null : { ...info }));
  }, []);

  // Click outside the chart area dismisses the pinned overlay. We catch this
  // at the tile level: any click that doesn't propagate from the SVG node
  // body or the overlay (which calls stopPropagation) lands here.
  const onTileClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-vote-flow-overlay]")) return;
    setPinned(null);
  }, []);

  if (!fromDate || !toDate || fromDate === toDate || !scope) return null;
  if (hasFile && !matrix) return null;

  const cycleLabel = `${localDate(fromDate)} → ${localDate(toDate)}`;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <Hint text={t("vote_flow_tile_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <GitFork className="h-4 w-4" />
              <span>{t("vote_flow_tile_title")}</span>
              <span className="hidden sm:inline text-[10px] normal-case text-muted-foreground">
                {cycleLabel}
              </span>
            </div>
          </Hint>
          <Link
            to="/where-did-votes-go/methodology"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("vote_flow_tile_methodology_link")} →
          </Link>
        </div>
      }
      className="overflow-hidden"
    >
      {/* Reserve the chart's render height even on cold load so the page
          layout doesn't reflow when the matrix arrives or when the user
          switches elections. The relative wrapper is the positioning
          context for the pinned overlay. */}
      {!matrix ? (
        <div
          className="text-xs text-muted-foreground py-6 text-center flex items-center justify-center"
          style={{ minHeight: SANKEY_HEIGHT }}
        >
          {isLoading ? t("loading") : t("vote_flow_no_data")}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="relative min-w-0"
          style={{ minHeight: SANKEY_HEIGHT }}
          onClick={onTileClick}
        >
          {isMd ? (
            <>
              <VoteFlowSankey
                matrix={matrix}
                width={Math.max(0, width)}
                height={SANKEY_HEIGHT}
                hoveredId={hover?.kind === "node" ? hover.id : null}
                pinnedId={pinned?.id ?? null}
                onHover={setHover}
                onClickNode={onClickNode}
              />
              {pinned ? (
                <VoteFlowOverlay
                  matrix={matrix}
                  nodeId={pinned.id}
                  anchorSide={pinned.side}
                  anchorYFrac={pinned.yFrac}
                  onClose={() => setPinned(null)}
                  onSelectNode={(id) =>
                    setPinned({ id, side: pinned.side, yFrac: pinned.yFrac })
                  }
                />
              ) : null}
              {/* Hover tooltip is suppressed while a node is pinned — the
                  overlay already shows the rich detail; layering a tooltip
                  on top is just visual noise. */}
              {!pinned && <VoteFlowTooltip matrix={matrix} hover={hover} />}
            </>
          ) : (
            <VoteFlowMobile matrix={matrix} />
          )}
        </div>
      )}
    </StatCard>
  );
};
