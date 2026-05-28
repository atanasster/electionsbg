// "Recent activity" feed tile — simulates the email-alerts feature the
// site can't deliver until auth lands. Renders the top 20 events from the
// per-município feed: procurement awards, EU-fund contracts, capital
// programmes, the local-election cycle, and plenary debates that
// mentioned the município by name.
//
// Auto-hides when the feed is empty (a handful of small municípios with
// no matching data).

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Coins,
  Crown,
  FileSearch,
  Hammer,
  Mic,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  useMyAreaAlerts,
  type MyAreaAlertEvent,
  type MyAreaAlertKind,
} from "@/data/myarea/useMyAreaAlerts";

type Props = {
  obshtina: string;
};

const PREVIEW_CAP = 8;
const EXPANDED_CAP = 20;

const ICONS: Record<MyAreaAlertKind, typeof Activity> = {
  procurement: FileSearch,
  eu_funds: Coins,
  local_election: Crown,
  capital_program: Hammer,
  plenary_keyword: Mic,
};

const COLOR: Record<MyAreaAlertKind, string> = {
  procurement: "#5E8AC7",
  eu_funds: "#E0A22C",
  local_election: "#56A86F",
  capital_program: "#A6792F",
  plenary_keyword: "#C97AAA",
};

const formatDateBg = (iso: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("bg-BG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
};
const formatDateEn = (iso: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
};

export const MyAreaAlertsTile: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data } = useMyAreaAlerts(obshtina);
  const [expanded, setExpanded] = useState(false);

  if (!data || data.events.length === 0) return null;

  const visible = expanded
    ? data.events.slice(0, EXPANDED_CAP)
    : data.events.slice(0, PREVIEW_CAP);
  const canExpand = data.events.length > PREVIEW_CAP;

  const renderEvent = (e: MyAreaAlertEvent, i: number) => {
    const Icon = ICONS[e.kind] ?? Activity;
    const color = COLOR[e.kind] ?? "#888";
    const headline = lang === "bg" ? e.headline_bg : e.headline_en;
    const dateLabel =
      lang === "bg" ? formatDateBg(e.date) : formatDateEn(e.date);
    return (
      <li
        key={`${e.date}-${i}-${e.kind}`}
        className="flex items-start gap-2 py-1.5 border-b last:border-b-0"
      >
        <div
          className="mt-0.5 shrink-0 rounded-full p-1"
          style={{ backgroundColor: `${color}22`, color }}
        >
          <Icon className="size-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs leading-snug">{headline}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
            {dateLabel}
            {e.detail ? <span> · {e.detail}</span> : null}
          </div>
        </div>
      </li>
    );
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="size-4 text-primary" />
        <h2 className="text-sm font-semibold flex-1">
          {t("my_area_alerts_title")}
        </h2>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {data.events.length}
        </span>
      </div>
      <ul className="flex flex-col">{visible.map(renderEvent)}</ul>
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="mt-2 text-xs text-primary underline flex items-center gap-1"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3" />
              {t("my_area_alerts_collapse")}
            </>
          ) : (
            <>
              <ChevronDown className="size-3" />
              {t("my_area_alerts_expand", {
                count: Math.min(EXPANDED_CAP, data.events.length) - PREVIEW_CAP,
              })}
            </>
          )}
        </button>
      ) : null}
      <p className="text-[10px] text-muted-foreground mt-3 italic">
        {t("my_area_alerts_caveat")}
      </p>
    </Card>
  );
};
