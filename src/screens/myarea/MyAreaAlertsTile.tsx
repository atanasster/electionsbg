// "Recent activity" feed tile — simulates the email-alerts feature the
// site can't deliver until auth lands. Renders the top 20 events from the
// per-município feed: council resolutions, procurement awards, EU-fund
// contracts, capital programmes, the local-election cycle, and plenary
// debates that mentioned the município by name.
//
// Rows with a source link are anchor-wrapped (hover row, ChevronRight at
// row end) so the whole row is a click target. EU rows render
// `programPeriod` ("2014-2020" etc.) instead of a fake date, since the
// programCode prefix only identifies the programming frame.
//
// Auto-hides when the feed is empty (a handful of small municípios with
// no matching data).

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Coins,
  Crown,
  FileSearch,
  Hammer,
  Mic,
  Vote,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  useMyAreaAlerts,
  type MyAreaAlertEvent,
  type MyAreaAlertKind,
} from "@/data/myarea/useMyAreaAlerts";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { FollowButton } from "@/screens/components/procurement/FollowButton";

type Props = {
  obshtina: string;
  /** Settlement view → its own ekatte; município view → resolved here from the
   *  centre. Used as the watchlist "place" key so a user can subscribe to this
   *  area's activity feed. */
  ekatte?: string;
  placeName?: string;
};

const PREVIEW_CAP = 10;
const EXPANDED_CAP = 20;

const ICONS: Record<MyAreaAlertKind, typeof Activity> = {
  procurement: FileSearch,
  tender: ClipboardList,
  eu_funds: Coins,
  local_election: Crown,
  capital_program: Hammer,
  plenary_keyword: Mic,
  council_resolution: Vote,
};

const COLOR: Record<MyAreaAlertKind, string> = {
  procurement: "#5E8AC7",
  tender: "#6366F1",
  eu_funds: "#E0A22C",
  local_election: "#56A86F",
  capital_program: "#A6792F",
  plenary_keyword: "#C97AAA",
  // Amber tint matches the band's old council-vote treatment so the
  // visual continuity carries over now that council rows live here.
  council_resolution: "#D97706",
};

// Short sub-type chip label for an event. Procurement rows carry a notice
// type (announced/awarded/annex); EU-funds rows a snapshot-diff change type
// (new/modified). Phrased the way a Bulgarian would actually say it.
const subTypeLabel = (
  e: MyAreaAlertEvent,
  lang: "bg" | "en",
): string | null => {
  if (e.noticeType) {
    if (lang === "bg") {
      return e.noticeType === "announced"
        ? "обявена"
        : e.noticeType === "annex"
          ? "анекс"
          : "възложена";
    }
    return e.noticeType === "announced"
      ? "announced"
      : e.noticeType === "annex"
        ? "annex"
        : "awarded";
  }
  if (e.changeType) {
    if (lang === "bg") return e.changeType === "new" ? "нов" : "промяна";
    return e.changeType === "new" ? "new" : "changed";
  }
  return null;
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

export const MyAreaAlertsTile: FC<Props> = ({
  obshtina,
  ekatte,
  placeName,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data } = useMyAreaAlerts(obshtina);
  const { findMunicipality } = useMunicipalities();
  const [expanded, setExpanded] = useState(false);

  // The watchlist "place" key is the settlement's own ekatte, or the
  // municipal-centre ekatte for a município view — the same target the
  // procurement tile pins to, so following here lands on /procurement/watchlist.
  const followEkatte = ekatte ?? findMunicipality(obshtina)?.ekatte;

  if (!data || data.events.length === 0) return null;

  const visible = expanded
    ? data.events.slice(0, EXPANDED_CAP)
    : data.events.slice(0, PREVIEW_CAP);
  const canExpand = data.events.length > PREVIEW_CAP;

  const renderEvent = (e: MyAreaAlertEvent, i: number) => {
    const Icon = ICONS[e.kind] ?? Activity;
    const color = COLOR[e.kind] ?? "#888";
    const headline = lang === "bg" ? e.headline_bg : e.headline_en;
    // EU funds contracts have no real per-contract date — the build
    // script emits a programPeriod label ("2014-2020", "2021-2027",
    // "2021-RRP") in place of a fake "1 Jan YYYY". When present, we
    // render the period instead of the date.
    const temporalLabel = e.programPeriod
      ? e.programPeriod
      : lang === "bg"
        ? formatDateBg(e.date)
        : formatDateEn(e.date);
    const subLabel = subTypeLabel(e, lang);
    const inner = (
      <>
        <div
          className="mt-0.5 shrink-0 rounded-full p-1"
          style={{ backgroundColor: `${color}22`, color }}
        >
          <Icon className="size-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs leading-snug line-clamp-2">{headline}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5 flex items-center gap-1 flex-wrap">
            {subLabel ? (
              // Color-coded via the background tint; the label itself uses the
              // theme foreground token so contrast holds at AA in both themes
              // (a colored-text chip on a light tint fails AA for lighter hues).
              <span
                className="rounded px-1 py-px font-medium uppercase tracking-wide not-italic text-foreground/80"
                style={{ backgroundColor: `${color}33` }}
              >
                {subLabel}
              </span>
            ) : null}
            <span>{temporalLabel}</span>
            {e.detail ? <span> · {e.detail}</span> : null}
          </div>
        </div>
        {e.link ? (
          <ChevronRight className="size-3 shrink-0 mt-1.5 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />
        ) : null}
      </>
    );
    return (
      <li key={`${e.date}-${i}-${e.kind}`} className="border-b last:border-b-0">
        {e.link ? (
          <a
            href={e.link}
            target="_blank"
            rel="noreferrer noopener"
            className="group flex items-start gap-2 py-1.5 hover:bg-accent/30 rounded-sm -mx-1 px-1 transition-colors"
          >
            {inner}
          </a>
        ) : (
          <div className="flex items-start gap-2 py-1.5">{inner}</div>
        )}
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
        {followEkatte && /^\d{5}$/.test(followEkatte) ? (
          <FollowButton
            kind="place"
            id={followEkatte}
            label={placeName ?? obshtina}
          />
        ) : null}
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
