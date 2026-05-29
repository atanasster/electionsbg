// Above-the-fold "what should I notice right now?" strip. Sits between
// the hero and the representatives row. The selector (useNextAction)
// returns either an upcoming-election countdown or null — past activity
// (council votes, procurement, EU contracts) lives in MyAreaAlertsTile.
//
// Per "no tabs" UX standard, this is a single horizontal card with an
// icon, a one-line lead, and a one-line context detail.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useNextAction } from "@/data/myarea/useNextAction";
import { formatLongDate } from "@/data/myarea/upcomingElections";

type Props = {
  obshtina: string;
};

export const MyAreaActionBand: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const action = useNextAction(obshtina);
  if (!action) return null;

  const e = action.election;
  const dateLabel = formatLongDate(e.date, lang);
  const kindLabel = t(`election_kind_${e.kind}`);
  const eyebrow = lang === "bg" ? "Предстои гласуване" : "Vote coming up";
  const lead =
    lang === "bg"
      ? `${kindLabel} след ${action.daysOut} ${action.daysOut === 1 ? "ден" : "дни"}`
      : `${kindLabel} in ${action.daysOut} day${action.daysOut === 1 ? "" : "s"}`;
  const detail =
    e.confidence === "estimated"
      ? lang === "bg"
        ? `${dateLabel} · ориентировъчно`
        : `${dateLabel} · estimated`
      : dateLabel;

  return (
    <Card className="p-4 border-primary/40 bg-primary/5">
      <div className="flex items-start gap-3">
        <CalendarClock className="size-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {eyebrow}
          </div>
          <p className="text-sm font-semibold mt-0.5 leading-snug">{lead}</p>
          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
            {detail}
          </p>
        </div>
      </div>
    </Card>
  );
};
