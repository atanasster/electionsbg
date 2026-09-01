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
  Megaphone,
  Mic,
  Vote,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/formatDate";
import { ALERT_KIND_META, type AlertIconToken } from "@/data/alerts/alertKinds";
import {
  useMyAreaAlerts,
  type MyAreaAlertEvent,
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

/**
 * The ONLY thing this file still owns about a kind: token → component.
 *
 * ⚠️ EXHAUSTIVE BY TYPE, which is the whole repair. The icon and colour maps used to be
 * hand-written per kind and indexed as `ICONS[e.kind] ?? Activity` / `COLOR[e.kind] ?? "#888"`,
 * so a kind the builder emitted and the maps lacked rendered as a generic grey row with
 * nothing red — which is exactly what `open_call` did. `Record<AlertIconToken, …>` makes a
 * missing token a compile error, and the colour now comes from the registry, so neither map
 * can go stale independently of the builder again.
 */
const ICON_BY_TOKEN: Record<AlertIconToken, typeof Activity> = {
  fileSearch: FileSearch,
  clipboardList: ClipboardList,
  coins: Coins,
  megaphone: Megaphone,
  crown: Crown,
  hammer: Hammer,
  mic: Mic,
  vote: Vote,
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
    // No `?? fallback` on either line, deliberately. The hook drops a row whose kind is not
    // in the registry, and the registry is exhaustive over the builder — so an unknown kind
    // cannot reach here, and a fallback would only hide the next drift the way the last one
    // was hidden.
    const meta = ALERT_KIND_META[e.kind];
    const Icon = ICON_BY_TOKEN[meta.icon];
    const color = meta.color;
    const kindLabel = t(meta.labelKey);
    const headline = lang === "bg" ? e.headline_bg : e.headline_en;
    // EU funds contracts have no real per-contract date — the build
    // script emits a programPeriod label ("2014-2020", "2021-2027",
    // "2021-RRP") in place of a fake "1 Jan YYYY". When present, we
    // render the period instead of the date.
    // `formatDate` rather than a local pair: it pins the formatter to UTC only for the
    // date-only SHAPE (`2026-08-20`), which is what these rows carry and where "the day" is
    // the whole fact — and it leaves a real instant in the reader's own zone, which is what
    // the vintage line below needs. It also takes `i18n.language` directly, so the
    // `lang === "bg"` branch goes with it. Output is byte-identical to the local copies.
    const temporalLabel = e.programPeriod ?? formatDate(e.date, i18n.language);
    const subLabel = subTypeLabel(e, lang);
    const inner = (
      <>
        {/* The icon and its hue were the ONLY thing distinguishing one kind from another, so
            a screen reader got nothing and a colour-blind reader got a shape. `role="img"` +
            the registry's own label key is the cheapest fix that also makes `labelKey` live
            copy rather than an unused field. */}
        {/* ⚠️ THE GLYPH IS `text-foreground/80`, NOT THE KIND'S HUE — the same treatment, and
            the same reason, as the sub-type chip below. Drawing the icon AT `color` on a 13%
            tint of `color` is a colour against a near-copy of itself: measured against the
            real `--card` tokens all eight kinds came out at 1.55–2.88:1 in light mode, under
            WCAG 1.4.11's 3:1 floor for non-text contrast, and no single palette fixes both
            themes (the tint darkens with the hue). This measures 6.39:1 light / 8.45:1 dark.
            The kind is still carried three ways: the tint's hue, the icon's shape, and the
            accessible name. */}
        <div
          className="mt-0.5 shrink-0 rounded-full p-1 text-foreground/80"
          style={{ backgroundColor: `${color}22` }}
          role="img"
          aria-label={kindLabel}
          title={kindLabel}
        >
          <Icon className="size-3" aria-hidden="true" />
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
      {/* The vintage, stated rather than inferred. This tile is the one surface whose entire
          value is recency, and under the old `staleTime: Infinity` an open tab served the
          same rows indefinitely with nothing on screen saying how old they were. `generatedAt`
          is the route's own `refreshedAt` — OUR clock (when the loader last wrote the feed),
          never an event date, which is why it is phrased „обновено" and sits apart from the
          per-row dates below. */}
      {data.generatedAt ? (
        <div className="-mt-2 mb-2">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {t("my_area_alerts_refreshed", {
              // No `.slice(0, 10)`: this is a timestamptz INSTANT, not a calendar day, so
              // truncating it to the UTC day rendered „обновено 1 сеп." for a feed written at
              // 00:30 on 2 September in Sofia. `formatDate` applies its UTC pin only to the
              // date-only shape, so an instant lands in the reader's own zone — which for an
              // instant is the right answer.
              date: formatDate(data.generatedAt, i18n.language),
            })}
          </span>
        </div>
      ) : null}
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
