import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as SelectPrimitive from "@radix-ui/react-select";
import { useElectionContext } from "@/data/ElectionContext";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { prefetchElection } from "@/data/prefetch";
import { localDate, totalAllVotes } from "@/data/utils";
import { Hint } from "@/ux/Hint";
import { Check, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";

type ElectionRow = {
  name: string;
  local: string;
  winnerNick?: string;
  winnerPct?: string;
  turnoutPct?: string;
  color?: string;
};

export const ElectionsSelect: FC = () => {
  const { elections, selected, setSelected, stats } = useElectionContext();
  const { colorFor } = useCanonicalParties();
  const { t } = useTranslation();

  const rows: ElectionRow[] = useMemo(() => {
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
        name,
        local: localDate(name),
        winnerNick: winner?.nickName,
        winnerPct,
        turnoutPct,
        color: winner ? colorFor(winner.nickName) : undefined,
      };
    });
  }, [elections, stats, colorFor]);

  const currentIdx = elections.findIndex((v) => v === selected);
  const priorElection = elections[currentIdx + 1];
  const nextElection = currentIdx > 0 ? elections[currentIdx - 1] : undefined;

  return (
    <div className="flex gap-1 items-center">
      <Hint text={t("prior_elections")}>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 md:size-10 text-secondary-foreground/70 hover:text-secondary-foreground"
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
        </Button>
      </Hint>
      <Select
        value={selected}
        onValueChange={(e) => {
          setSelected(e);
        }}
      >
        <SelectTrigger
          id="select_election"
          aria-label={t("select_election_year")}
          className="w-[125px] md:w-[150px] text-sm text-secondary-foreground px-2"
          onMouseEnter={() => {
            prefetchElection(priorElection);
            prefetchElection(nextElection);
          }}
        >
          <SelectValue placeholder={selected} />
        </SelectTrigger>
        <SelectContent className="min-w-[260px]">
          {rows.map((r) => (
            <SelectPrimitive.Item
              key={r.name}
              value={r.name}
              onMouseEnter={() => prefetchElection(r.name)}
              onFocus={() => prefetchElection(r.name)}
              className="relative flex w-full cursor-default select-none flex-col gap-0.5 rounded-sm py-2 pl-3 pr-9 outline-none focus:bg-secondary focus:text-secondary-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
            >
              <span className="absolute right-3 top-2.5 flex size-4 items-center justify-center">
                <SelectPrimitive.ItemIndicator>
                  <Check className="size-4" />
                </SelectPrimitive.ItemIndicator>
              </span>
              <SelectPrimitive.ItemText>
                <span className="text-sm font-medium text-secondary-foreground tabular-nums">
                  {r.local}
                </span>
              </SelectPrimitive.ItemText>
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
            </SelectPrimitive.Item>
          ))}
        </SelectContent>
      </Select>
      <Hint text={t("next_elections")}>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 md:size-10 text-secondary-foreground/70 hover:text-secondary-foreground"
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
        </Button>
      </Hint>
    </div>
  );
};
