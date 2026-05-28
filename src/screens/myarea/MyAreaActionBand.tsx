// Above-the-fold "what should I notice right now?" strip. Sits between
// the hero and the representatives row. The selector picks one item to
// surface based on a fixed priority (see useNextAction): election
// imminent → recent council vote → recent procurement red flag →
// default countdown. Always renders one card; never empty.
//
// Per "no tabs" UX standard, this is a single horizontal card with an
// icon, a one-line lead, a one-line context detail, and one CTA.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarClock,
  Vote,
  AlertTriangle,
  CalendarDays,
  ArrowRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import { useNextAction, type NextAction } from "@/data/myarea/useNextAction";
import { formatLongDate } from "@/data/myarea/upcomingElections";

type Props = {
  obshtina: string;
};

const formatEur = (amount: number, lang: "bg" | "en"): string => {
  const v = new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 0,
  }).format(amount);
  return lang === "bg" ? `${v} €` : `€${v}`;
};

const renderBody = (
  action: NextAction,
  lang: "bg" | "en",
  t: (k: string) => string,
): {
  icon: FC<{ className?: string }>;
  toneClass: string;
  eyebrow: string;
  lead: string;
  detail: string;
  cta?: { href: string; label: string; external?: boolean };
} => {
  switch (action.kind) {
    case "election_imminent": {
      const e = action.election;
      const dateLabel = formatLongDate(e.date, lang);
      const kindLabel = t(`election_kind_${e.kind}`);
      return {
        icon: CalendarClock,
        toneClass: "border-primary/40 bg-primary/5",
        eyebrow: lang === "bg" ? "Предстои гласуване" : "Vote coming up",
        lead:
          lang === "bg"
            ? `${kindLabel} след ${action.daysOut} ${action.daysOut === 1 ? "ден" : "дни"}`
            : `${kindLabel} in ${action.daysOut} day${action.daysOut === 1 ? "" : "s"}`,
        detail:
          e.confidence === "estimated"
            ? lang === "bg"
              ? `${dateLabel} · ориентировъчно`
              : `${dateLabel} · estimated`
            : dateLabel,
      };
    }
    case "council_recent": {
      const r = action.resolution;
      const title = (lang === "bg" ? r.summary_bg : r.summary_en) || r.title;
      const dateLabel = formatLongDate(r.date, lang);
      return {
        icon: Vote,
        toneClass: "border-amber-500/30 bg-amber-500/5",
        eyebrow:
          lang === "bg"
            ? "Общинският съвет гласува"
            : "The municipal council voted",
        lead: title,
        detail:
          lang === "bg"
            ? `${dateLabel} · преди ${action.daysAgo} ${action.daysAgo === 1 ? "ден" : "дни"}`
            : `${dateLabel} · ${action.daysAgo} day${action.daysAgo === 1 ? "" : "s"} ago`,
        cta: r.sourceUrl
          ? {
              href: r.sourceUrl,
              label: lang === "bg" ? "Към решението" : "View resolution",
              external: true,
            }
          : undefined,
      };
    }
    case "alert_recent": {
      const e = action.event;
      const headline = lang === "bg" ? e.headline_bg : e.headline_en;
      const dateLabel = formatLongDate(e.date, lang);
      const amountStr = e.amountEur ? formatEur(e.amountEur, lang) : null;
      return {
        icon: AlertTriangle,
        toneClass: "border-amber-500/40 bg-amber-500/5",
        eyebrow:
          lang === "bg"
            ? "Нова дейност в общината"
            : "New activity in your area",
        lead: headline,
        detail: amountStr
          ? lang === "bg"
            ? `${amountStr} · ${dateLabel}`
            : `${amountStr} · ${dateLabel}`
          : dateLabel,
        cta: e.link
          ? {
              href: e.link,
              label: lang === "bg" ? "Подробности" : "Details",
              external: true,
            }
          : undefined,
      };
    }
    case "election_default": {
      const e = action.election;
      const dateLabel = formatLongDate(e.date, lang);
      const kindLabel = t(`election_kind_${e.kind}`);
      return {
        icon: CalendarDays,
        toneClass: "",
        eyebrow: lang === "bg" ? "Следващи избори" : "Next election",
        lead:
          lang === "bg"
            ? `${kindLabel} след ${action.daysOut} дни`
            : `${kindLabel} in ${action.daysOut} days`,
        detail:
          e.confidence === "estimated"
            ? lang === "bg"
              ? `${dateLabel} · ориентировъчно`
              : `${dateLabel} · estimated`
            : dateLabel,
      };
    }
  }
};

export const MyAreaActionBand: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const action = useNextAction(obshtina);
  if (!action) return null;

  const body = renderBody(action, lang, t);
  const Icon = body.icon;

  return (
    <Card className={`p-4 ${body.toneClass}`.trim()}>
      <div className="flex items-start gap-3">
        <Icon className="size-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {body.eyebrow}
          </div>
          <p className="text-sm font-semibold mt-0.5 leading-snug">
            {body.lead}
          </p>
          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
            {body.detail}
          </p>
        </div>
        {body.cta ? (
          body.cta.external ? (
            <a
              href={body.cta.href}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline shrink-0 mt-0.5"
            >
              {body.cta.label}
              <ArrowRight className="size-3" />
            </a>
          ) : (
            <Link
              to={body.cta.href}
              underline={false}
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline shrink-0 mt-0.5"
            >
              {body.cta.label}
              <ArrowRight className="size-3" />
            </Link>
          )
        ) : null}
      </div>
    </Card>
  );
};
