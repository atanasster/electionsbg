import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAreaAnchor } from "@/data/area/areaAnchor";
import { cn } from "@/lib/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { prefetchElection } from "@/data/prefetch";
import { localDate, localDateShort, totalAllVotes } from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { useTouch } from "@/ux/TouchProvider";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Users,
} from "lucide-react";
import { FC, ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

type ParliamentaryRow = {
  kind: "parliamentary";
  name: string;
  local: string;
  winnerNick?: string;
  winnerPct?: string;
  turnoutPct?: string;
  color?: string;
};

type LocalRow = {
  kind: "local";
  name: string;
  local: string;
};

type ElectionRow = ParliamentaryRow | LocalRow;

export const ElectionsSelect: FC = () => {
  const { elections, localElections, selected, setSelected, stats } =
    useElectionContext();
  const { colorFor } = useCanonicalParties();
  const { t } = useTranslation();
  const isTouch = useTouch();
  // When an area is anchored the persistent AreaPill joins this row, and so
  // does the text menu bar at lg. To keep everything on one line (and leave
  // the pill enough room to show its name rather than truncate to a stub) we
  // drop the prev/next arrows whenever anchored below xl — the dropdown still
  // selects any election — and restore them at xl where the full bar fits.
  // See AreaSniperButton / AreaPill for the rest of the anchored compaction.
  const anchor = useAreaAnchor();
  const arrowHiddenWhenAnchored = anchor ? "hidden xl:inline-flex" : undefined;
  const navigate = useNavigate();
  const maybeHint = (text: string, node: ReactNode) =>
    isTouch ? node : <Hint text={text}>{node}</Hint>;

  const parliamentaryRows: ParliamentaryRow[] = useMemo(() => {
    return elections.map((name) => {
      const info = stats.find((s) => s.name === name);
      const protocol = info?.results?.protocol;
      const votes = info?.results?.votes;
      const winner = votes
        ? [...votes].sort((a, b) => b.totalVotes - a.totalVotes)[0]
        : undefined;
      const totalVotes = totalAllVotes(votes);
      const winnerPct =
        winner && totalVotes
          ? `${((winner.totalVotes / totalVotes) * 100).toFixed(1)}%`
          : undefined;
      const turnoutPct =
        protocol &&
        protocol.numRegisteredVoters &&
        protocol.totalActualVoters !== undefined
          ? `${((protocol.totalActualVoters / protocol.numRegisteredVoters) * 100).toFixed(0)}%`
          : undefined;
      return {
        kind: "parliamentary" as const,
        name,
        local: localDate(name),
        winnerNick: winner?.nickName,
        winnerPct,
        turnoutPct,
        color: winner ? colorFor(winner.nickName) : undefined,
      };
    });
  }, [elections, stats, colorFor]);

  // Local cycles use their own date string (round 1) for the display
  // label rather than `localDate(name)`, which expects the YYYY_MM_DD
  // parliamentary slug — our local names carry an `_mi` suffix.
  const localRows: LocalRow[] = useMemo(() => {
    return localElections
      .slice()
      .sort((a, b) => b.round1Date.localeCompare(a.round1Date))
      .map((e) => ({
        kind: "local" as const,
        name: e.name,
        local: localDate(e.round1Date.replace(/-/g, "_")),
      }));
  }, [localElections]);

  // Next/prev arrows iterate parliamentary cycles only — per the design
  // decision that locals appear in the dropdown but never become arrow
  // targets.
  const currentIdx = elections.findIndex((v) => v === selected);
  const priorElection = elections[currentIdx + 1];
  const nextElection = currentIdx > 0 ? elections[currentIdx - 1] : undefined;

  const onPickRow = (r: ElectionRow) => {
    if (r.kind === "parliamentary") {
      setSelected(r.name);
    } else {
      // Step 1 deliverable: local-cycle selection navigates to the cycle
      // stub route (full overview screen is step 3).
      navigate(`/local/${r.name}`);
    }
  };

  return (
    <div className="flex shrink-0 gap-1 items-center">
      {maybeHint(
        t("prior_elections"),
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-7 md:size-8 text-secondary-foreground/70 hover:text-secondary-foreground",
            arrowHiddenWhenAnchored,
          )}
          onMouseEnter={() => prefetchElection(priorElection)}
          onFocus={() => prefetchElection(priorElection)}
          onClick={() => {
            if (priorElection) {
              setSelected(priorElection);
            }
          }}
          disabled={!priorElection}
        >
          <ChevronLeft className="size-5" />
          <span className="sr-only">{t("prior_elections")}</span>
        </Button>,
      )}
      {/* A DropdownMenu with `modal={false}` rather than a Radix Select: Select
          always locks body scroll and compensates for the removed scrollbar,
          which flashes a ghost scrollbar and shifts the fixed header. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            id="select_election"
            type="button"
            aria-label={t("select_election_year")}
            onMouseEnter={() => {
              prefetchElection(priorElection);
              prefetchElection(nextElection);
            }}
            className={cn(
              "flex h-7 items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-2 text-sm text-secondary-foreground shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring [&[data-state=open]>svg]:rotate-180",
              // Anchored on mobile the date shares its row with the area pill,
              // so it shrinks to a 2-digit-year trigger; otherwise it keeps the
              // roomy full-year width.
              anchor
                ? "w-[110px] sm:w-[125px] md:w-[150px]"
                : "w-[125px] md:w-[150px]",
            )}
          >
            {/* Only when anchored (and on mobile) do we swap the full year for a
                2-digit one, so the trigger stays narrow enough to share one
                header row with the area pill. With no anchor — or at sm+ — the
                full "19/04/2026" shows. */}
            <span className="line-clamp-1 tabular-nums">
              <span className={cn("sm:hidden", !anchor && "hidden")}>
                {localDateShort(selected)}
              </span>
              <span className={cn(anchor && "hidden sm:inline")}>
                {localDate(selected)}
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 opacity-50 transition-transform duration-200" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-[260px] max-h-96 overflow-y-auto"
        >
          {parliamentaryRows.map((r) => (
            <DropdownMenuItem
              key={r.name}
              onSelect={() => onPickRow(r)}
              onMouseEnter={() => prefetchElection(r.name)}
              onFocus={() => prefetchElection(r.name)}
              className="relative flex w-full cursor-default select-none flex-col items-start gap-0.5 rounded-sm py-2 pl-3 pr-9"
            >
              <span className="absolute right-3 top-2.5 flex size-4 items-center justify-center">
                {r.name === selected && <Check className="size-4" />}
              </span>
              <span className="text-sm font-medium text-secondary-foreground tabular-nums">
                {r.local}
              </span>
              {(r.winnerNick || r.turnoutPct) && (
                <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  {r.winnerNick && (
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full ring-1 ring-border"
                        style={{
                          backgroundColor: r.color ?? "hsl(var(--muted))",
                        }}
                      />
                      <span>{r.winnerNick}</span>
                      {r.winnerPct && <span>{r.winnerPct}</span>}
                    </span>
                  )}
                  {r.turnoutPct && (
                    <span className="flex items-center gap-1">
                      <Users aria-hidden className="size-3" />
                      {r.turnoutPct}
                    </span>
                  )}
                </span>
              )}
            </DropdownMenuItem>
          ))}
          {localRows.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              {localRows.map((r) => (
                <DropdownMenuItem
                  key={r.name}
                  onSelect={() => onPickRow(r)}
                  className="relative flex w-full cursor-default select-none flex-row items-center gap-2 rounded-sm py-2 pl-3 pr-9"
                >
                  <Landmark
                    aria-hidden
                    className="size-3.5 text-muted-foreground shrink-0"
                  />
                  <span className="flex-1 text-sm font-medium text-secondary-foreground tabular-nums">
                    {r.local}
                  </span>
                  <span className="inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("local_elections_badge")}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {maybeHint(
        t("next_elections"),
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-7 md:size-8 text-secondary-foreground/70 hover:text-secondary-foreground",
            arrowHiddenWhenAnchored,
          )}
          onMouseEnter={() => prefetchElection(nextElection)}
          onFocus={() => prefetchElection(nextElection)}
          onClick={() => {
            if (nextElection) {
              setSelected(nextElection);
            }
          }}
          disabled={!nextElection}
        >
          <ChevronRight className="size-5" />
          <span className="sr-only">{t("next_elections")}</span>
        </Button>,
      )}
    </div>
  );
};
