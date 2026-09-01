// Per-município simulated alerts feed. Composed by scripts/myarea/build_alerts.ts from
// already-ingested data — no separate scrape. The feed is the V1 substitute for real email
// alerts (no auth yet); each event has both BG and EN headlines plus an inferred date for
// chronological ordering.
//
// SERVED FROM POSTGRES since json-retirement-v2 Tier 4b (/api/db/myarea-alerts,
// myarea_alerts in 184). It used to read data/myarea/alerts/<obshtina>.json — 290 files
// rebuilt and re-uploaded to the bucket EVERY DAY, the highest churn-per-byte tree in the
// repo at 14,746 file-touches over 300 commits.
//
// ⚠️ ONLY THE STORAGE MOVED. The ten builders behind this feed compose BILINGUAL HEADLINES,
// and translated prose does not belong in a migration — 184's header carries that reasoning.
// The events arrive exactly as the builder wrote them.

import { useQuery } from "@tanstack/react-query";
import { isAlertKind, type AlertKind } from "@/data/alerts/alertKinds";

/** Procurement notice type — announced (обявена) / awarded (възложена) /
 * annex (анекс). Lets the feed + watchlist distinguish the three. */
export type MyAreaNoticeType = "announced" | "awarded" | "annex";

/** EU-funds change type from the snapshot-diff — a brand-new project or a
 * value/status change to an existing one. */
export type MyAreaChangeType = "new" | "modified";

export type MyAreaAlertEvent = {
  date: string;
  /**
   * ⚠️ THIS USED TO BE A HAND-WRITTEN UNION IN THIS FILE AND IT WAS WRONG.
   * `build_alerts.ts` has emitted `open_call` since the open-calls arm landed and the union
   * never listed it — so TypeScript asserted the kind could not exist while
   * `MyAreaAlertsTile` fell through `ICONS[e.kind] ?? Activity` to a generic grey row. A
   * forward-looking call to apply for rendered as an anonymous line beside a contract award,
   * at a 200, with nothing red. The vocabulary now has one home, and the builder is scanned
   * against it — see `src/data/alerts/alertKinds.ts`.
   */
  kind: AlertKind;
  headline_bg: string;
  headline_en: string;
  amountEur?: number;
  link?: string;
  detail?: string;
  /** EU-funds rows only — "2014-2020", "2021-2027", "2021-RRP". When set,
   * the tile renders this in place of the (programme-period midpoint) date. */
  programPeriod?: string;
  /** Procurement rows only — the OCDS notice type. */
  noticeType?: MyAreaNoticeType;
  /** EU-funds rows only — set on snapshot-diff new/modified contracts. */
  changeType?: MyAreaChangeType;
};

export type MyAreaAlertsFile = {
  obshtina: string;
  /** When the LOADER last wrote this feed — our clock, not an event date. The file this
   *  replaced carried the same field under the same name.
   *
   *  ⚠️ OPTIONAL, because it arrives over the wire behind an `as` cast rather than a check.
   *  The app mounts exactly one error boundary and it is unrelated to this tree, so a
   *  `TypeError` here is a white screen on every `/my-area/*` route — and a vintage line is
   *  not worth that. Absent means „not stated"; the tile omits the line. */
  generatedAt?: string;
  events: MyAreaAlertEvent[];
  /**
   * Kinds the payload carried that this bundle does not know, already removed from `events`.
   *
   * ⚠️ IT IS DATA RATHER THAN A `console.warn` BECAUSE THE FAILURE IS A PRODUCTION ONE.
   * `build_alerts.ts` publishes to Postgres while `ALERT_KINDS` ships in the hosting bundle,
   * so running the builder with a new kind before `npm run deploy` drops every row of that
   * kind from a live feed — and for a município whose feed is entirely that kind, the tile's
   * own `events.length === 0` guard removes the whole tile, at a 200. A DEV-gated log is
   * silent in exactly the situation that matters. Empty on every healthy deploy.
   */
  droppedKinds: string[];
};

const fetchAlerts = async (
  obshtina: string,
): Promise<MyAreaAlertsFile | null> => {
  const r = await fetch(
    `/api/db/myarea-alerts?obshtina=${encodeURIComponent(obshtina)}`,
  );
  if (!r.ok) throw new Error(`alerts fetch failed: ${r.status}`);
  // null = this município has no feed. The route returns it explicitly, where the file
  // family expressed the same thing as a 404 — the tile's absent state is unchanged.
  const body = (await r.json()) as {
    obshtina: string;
    events: MyAreaAlertEvent[];
    refreshedAt?: string;
  } | null;
  if (!body) return null;
  const raw = body.events ?? [];
  // A row whose kind is not in the registry is DROPPED rather than rendered anonymously. The
  // alternative is what this feed did before the registry existed: an unknown kind fell
  // through to a fallback icon and #888, so a new event type shipped as a grey line nobody
  // could identify.
  const events = raw.filter((e) => isAlertKind(e.kind));
  // ⚠️ AND THE DROP IS REPORTED, because it is otherwise INVISIBLE. The tile renders
  // `events.length` — the count AFTER this filter — so a reader has no baseline, and a
  // dropped row is exactly as silent as the grey row it replaced. Both channels are
  // deliberate: the array so a caller (and a test) can see it, and one console line so an
  // operator watching a deploy does not have to. Neither fires on a healthy deploy.
  const droppedKinds = [
    ...new Set(
      raw.filter((e) => !isAlertKind(e.kind)).map((e) => String(e.kind)),
    ),
  ].sort();
  if (droppedKinds.length > 0) {
    console.warn(
      `myarea-alerts: dropped ${raw.length - events.length} row(s) of unknown kind ` +
        `(${droppedKinds.join(", ")}) — the builder is ahead of ALERT_KINDS in this bundle`,
    );
  }
  return {
    obshtina: body.obshtina,
    // Same reason as the kind filter: this is network JSON and an `as` cast is not a check.
    generatedAt:
      typeof body.refreshedAt === "string" ? body.refreshedAt : undefined,
    events,
    droppedKinds,
  };
};

/**
 * ⚠️ `staleTime` IS 30 MINUTES, NOT `Infinity`, AND ON ITS OWN THAT CHANGES NOTHING.
 *
 * This is the "what happened near me" tile — the one surface whose entire value is recency,
 * and under `staleTime: Infinity` a tab left open served the same events until it was
 * reloaded. The loader writes several times a day.
 *
 * But `staleTime` is a PERMISSION, not a trigger: React Query does not poll when it expires,
 * it only stops refusing a refetch something else has already asked for. The app-wide client
 * (`src/data/queryClient.ts`) sets `refetchOnWindowFocus: false` and
 * `refetchOnReconnect: false`, so an idle mounted query has no asker at all — lowering
 * `staleTime` alone fixes the navigate-away-and-back case via the default `refetchOnMount`
 * and leaves the literal open tab exactly as stale as before. The two options below are what
 * actually deliver it, and they are opted into here rather than globally because the rest of
 * the app really is static per session.
 *
 * 30 minutes is well inside the route's own `max-age=300, s-maxage=3600`, so a refetch is
 * usually an edge hit rather than a database query. `generatedAt` is rendered beside the rows
 * so a reader can see the vintage rather than infer it.
 */
export const MYAREA_ALERTS_STALE_MS = 30 * 60 * 1000;

export const useMyAreaAlerts = (obshtina?: string | null) =>
  useQuery({
    queryKey: ["myarea", "alerts", obshtina ?? ""],
    queryFn: () => (obshtina ? fetchAlerts(obshtina) : Promise.resolve(null)),
    enabled: !!obshtina,
    staleTime: MYAREA_ALERTS_STALE_MS,
    // The two triggers the global client switches off. Without them the docblock above is a
    // description of something that does not happen.
    refetchOnWindowFocus: true,
    refetchInterval: MYAREA_ALERTS_STALE_MS,
    // Never poll a hidden tab. This is a courtesy refresh on a shared Cloud SQL instance, not
    // a live feed, and a background tab has no reader to be stale for.
    refetchIntervalInBackground: false,
  });
