// Mid-term comparison: a partial (частичен / нов) mayoral by-election held
// after the place's last regular local cycle, set side-by-side with that
// regular vote. Surfaces the three deltas that matter when a single office is
// re-run on its own — how many fewer voters turned out, how the field of
// candidates shrank, and how the winner's share moved.
//
// Deltas are rendered neutral (not red/green): a by-election naturally draws
// far fewer voters than a full local cycle, so "fewer" is context, not a
// regression. Mounted by LocalElectionScreen only when a newer partial
// mayoral event exists for the place.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatThousands } from "@/data/utils";
import { StatCard } from "../StatCard";
import type { LocalMayorResult } from "@/data/local/types";

type MayorBundle = {
  round1: LocalMayorResult[];
  round2?: LocalMayorResult[];
  elected: LocalMayorResult | null;
};

const winnerShare = (m: MayorBundle): number =>
  m.elected?.pctOfValid ??
  (m.round1.length ? Math.max(...m.round1.map((c) => c.pctOfValid)) : 0);

const Delta: FC<{ value: number; suffix?: string; digits?: number }> = ({
  value,
  suffix,
  digits = 0,
}) => {
  if (!isFinite(value) || Math.round(value * 10 ** digits) === 0)
    return <span className="text-muted-foreground">·</span>;
  const up = value > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 text-muted-foreground tabular-nums">
      <Icon className="size-3 shrink-0" />
      {up ? "+" : "−"}
      {Math.abs(value).toFixed(digits)}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
};

export const LocalMidtermComparisonTile: FC<{
  regular: MayorBundle;
  partial: MayorBundle;
  regularDate: string;
  partialDate: string;
  className?: string;
}> = ({ regular, partial, regularDate, partialDate, className }) => {
  const { t } = useTranslation();

  const m = useMemo(() => {
    const regVotes = regular.round1.reduce((a, c) => a + c.votes, 0);
    const parVotes = partial.round1.reduce((a, c) => a + c.votes, 0);
    const regWin = winnerShare(regular);
    const parWin = winnerShare(partial);
    const sameWinner =
      regular.elected && partial.elected
        ? regular.elected.mpId && partial.elected.mpId
          ? regular.elected.mpId === partial.elected.mpId
          : regular.elected.candidateName === partial.elected.candidateName
        : false;
    return {
      regVotes,
      parVotes,
      votesDeltaPct:
        regVotes > 0 ? ((parVotes - regVotes) / regVotes) * 100 : 0,
      regCand: regular.round1.length,
      parCand: partial.round1.length,
      regWin,
      parWin,
      sameWinner,
    };
  }, [regular, partial]);

  const rows: {
    label: string;
    reg: string;
    par: string;
    delta: React.ReactNode;
  }[] = [
    {
      label: t("local_election_compare_voters"),
      reg: formatThousands(m.regVotes),
      par: formatThousands(m.parVotes),
      delta: <Delta value={m.votesDeltaPct} suffix="%" />,
    },
    {
      label: t("local_election_compare_candidates"),
      reg: String(m.regCand),
      par: String(m.parCand),
      delta: <Delta value={m.parCand - m.regCand} />,
    },
    {
      label: t("local_election_compare_winner_share"),
      reg: `${m.regWin.toFixed(1)}%`,
      par: `${m.parWin.toFixed(1)}%`,
      delta: (
        <Delta
          value={m.parWin - m.regWin}
          suffix={t("local_election_compare_pp")}
          digits={1}
        />
      ),
    },
  ];

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4" />
          <span>{t("local_election_midterm_compare_title")}</span>
        </div>
      }
      hint={t("local_election_midterm_compare_hint")}
    >
      <div className="mt-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-3 gap-y-2 items-center text-sm">
          <span />
          <span className="text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("local_election_compare_col_regular", { date: regularDate })}
          </span>
          <span className="text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("local_election_compare_col_partial", { date: partialDate })}
          </span>
          <span />
          {rows.map((r) => (
            <div key={r.label} className="contents">
              <span className="min-w-0 truncate text-muted-foreground">
                {r.label}
              </span>
              <span className="text-right tabular-nums">{r.reg}</span>
              <span className="text-right font-medium tabular-nums">
                {r.par}
              </span>
              <span className="text-right text-xs">{r.delta}</span>
            </div>
          ))}
        </div>
        {partial.elected ? (
          <div className="mt-3 border-t pt-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {partial.elected.candidateName}
            </span>{" "}
            ·{" "}
            {m.sameWinner
              ? t("local_election_mayor_reelected")
              : t("local_election_mayor_new_winner")}
          </div>
        ) : null}
      </div>
    </StatCard>
  );
};
