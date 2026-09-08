// „Как гласуваха партийните избиратели" — the estimated transition from the parliamentary vote
// at or before a presidential cycle into one ROUND of that cycle's ballot.
//
// ⚠⚠ AN ESTIMATE, AND THE COPY SAYS SO IN THE SAME BREATH AS THE NUMBER. Nobody sees an
// individual change their ballot; what is seen is that a section's two protocols differ. This
// is an ecological regression per oblast (NNLS + RAS), so it shows movement CONSISTENT WITH the
// data, never counted people — the same licence `PresidentialTransferTile` carries for the
// round-1→round-2 estimate, and it is the reason the tile links out to the shared methodology
// page rather than restating it.
//
// ⚠⚠ ON 2021 THIS PAGE ALSO CARRIES „ЕДНАТА БЮЛЕТИНА СРЕЩУ ДРУГАТА", OVER THE SAME TWO BALLOTS,
// AND THE TWO ARE DIFFERENT KINDS OF ANSWER. That one is a LOWER BOUND assuming nothing —
// |A △ B| ≥ ||A| − |B|| per section, „поне N". This is an estimate. They sit in separate
// sections with their own headings for that reason; read as two attempts at one number, the
// weaker-looking floor would seem to contradict the richer-looking estimate.
//
// ⚠ IT SELF-HIDES FOR THREE DIFFERENT ORDINARY REASONS — no parliamentary predecessor (2001), a
// section join the producer refused (2006, at 66%), and an artifact that has not shipped
// (`data/*_pvr` reaches the bucket only through `bucket:gz`). None of the three is a defect, so
// none of them draws a heading over an empty box.
//
// The Sankey, its tooltip, overlay and mobile fallback are the parliamentary dashboard's own
// components, imported rather than reproduced — a second implementation would drift the first
// time either moved. `LocalVoteFlowTile` is the same composition against a different root.

import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitFork } from "lucide-react";
import { Link } from "@/ux/Link";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { StatCard } from "@/screens/dashboard/StatCard";
import { usePresidentialFlow } from "@/data/presidential/usePresidentialFlow";
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

/** "2014_10_05" → "05.10.2014". */
const parlDateLabel = (date?: string): string =>
  date ? date.split("_").reverse().join(".") : "";

export const PresidentialFlowTile: FC<{
  cycle: string;
  round: 1 | 2;
  /** Presidential oblast code; omitted → national. */
  oblast?: string;
}> = ({ cycle, round, oblast }) => {
  const { t } = useTranslation();
  const isMd = useMediaQueryMatch("md");
  const { matrix, from, isLoading, hasFile, hasPair } = usePresidentialFlow(
    cycle,
    round,
    oblast ?? "national",
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

  // ⚠ THE PIN IS DISMISSED ON ANY OUTSIDE CLICK, and the round toggle above this tile is one
  // of them — an overlay left open across a round change would describe the previous ballot.
  useEffect(() => {
    if (!pinned) return;
    const onDocClick = (e: MouseEvent) => {
      const node = e.target as Node;
      if (
        overlayRef.current &&
        !overlayRef.current.contains(node) &&
        containerRef.current &&
        !containerRef.current.contains(node)
      )
        setPinned(null);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [pinned]);

  // ⚠ AND ON THE ROUND ITSELF. The two rounds have different candidate sets, so a pinned node
  // id from one may not exist in the other — the overlay would then render nothing while the
  // Sankey behind it stayed dimmed.
  useEffect(() => {
    setPinned(null);
    setHover(null);
  }, [round]);

  const onClickNode = useCallback((info: SankeyClickInfo) => {
    setPinned({ id: info.id, side: info.side, yFrac: info.yFrac });
  }, []);

  const hoveredId = useMemo(
    () => (hover && hover.kind === "node" ? hover.id : null),
    [hover],
  );
  const activeId = pinned?.id ?? hoveredId;
  const pinnedNodeResolved = pinned
    ? pinned.side === "from"
      ? matrix?.fromNodes.find((n) => n.id === pinned.id)
      : matrix?.toNodes.find((n) => n.id === pinned.id)
    : null;

  // ⚠ NO PAIR IS AN ABSENCE, NOT AN EMPTY STATE — see the file header for the three ways a
  // cycle-round legitimately has none.
  if (!isLoading && (!hasPair || !hasFile)) return null;
  const isEmpty = !matrix || matrix.flows.length === 0;
  if (!isLoading && isEmpty) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitFork className="h-4 w-4" />
            <span>{t("presidential_flow_title")}</span>
          </div>
          <Link
            to="/where-did-votes-go/methodology"
            className="text-xs font-medium text-primary hover:underline"
          >
            {t("vote_flow_tile_methodology_link")}
          </Link>
        </div>
      }
      hint={t("presidential_flow_hint")}
    >
      <div ref={containerRef} className="relative w-full">
        {isLoading && !matrix ? (
          <div
            className="flex items-center justify-center text-sm text-muted-foreground"
            style={{ minHeight: SANKEY_HEIGHT }}
          >
            {t("loading")}
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
      {/* ⚠ THE CAPTION NAMES BOTH BALLOTS AND THE ROUND. „Прехвърляне на гласове" over a Sankey
          whose left column is a party list and whose right column is a person is unreadable
          without saying which two votes are being compared — and on 2021 the two dates are the
          SAME DAY, which is itself the interesting fact. */}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {t("presidential_flow_caption", {
          from: parlDateLabel(from),
          round,
        })}
      </p>
    </StatCard>
  );
};
