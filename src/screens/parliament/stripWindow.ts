// The session strip's window rule, kept pure and separate from the component so it is
// testable without a DOM or a clock — and so the strip file stays a fast-refresh boundary.
//
// The rule has to satisfy two opposite cases at once (docs/plans/parliament-hub-v1.md §4.1):
//
//   • a CURRENT recess must be VISIBLE as trailing empty columns. That is the entire reason
//     the strip won the hero slot over a lead card and a news rail — 11–32% of every term's
//     days sit inside a gap longer than ten, so a hero that cannot depict a gap spends a
//     fifth of its life apologising instead of informing.
//   • a DISSOLVED parliament must not do that. The 45th NS last sat on 2021-05-07; running
//     its window to today would draw ~1,900 empty columns and the strip would stop being a
//     calendar at all.

const DAY_MS = 86_400_000;
/** Widest window we will draw — beyond this the columns stop being legible. */
const MAX_WINDOW_DAYS = 60;
/** How many recent sittings the window tries to include. */
const TARGET_SITTINGS = 12;
/** How far past the last sitting the window still runs to "today". Inside this, a recess is
 *  live news and is drawn; outside it, the parliament is history and the window ends at its
 *  final sitting.
 *
 *  EXPORTED because the wire above the strip has to make the same call. It did not, and so
 *  described eight of the nine parliaments — every dissolved one — as „НС не заседава от 25
 *  март (1960 дни)": a chamber that no longer exists reported as failing to sit. One
 *  threshold, one liveness answer. */
export const LIVE_TAIL_DAYS = 60;

const toDay = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface StripDay {
  date: string;
  /** Items voted that day; 0 marks a non-sitting day. */
  items: number;
  /** The day's outcome split, when the source carries one.
   *
   *  index.json does NOT: `RollcallIndexEntry` is { date, stenogramId, items, file, ns },
   *  so a strip fed from it can encode volume and nothing else. hub_feed/<ns>.json carries
   *  the tallies, and when it is the source these are set. Undefined is therefore a real
   *  state and the component must render volume-only rather than a zeroed split. */
  tally?: { yes: number; no: number; abstain: number };
}

export interface StripSource {
  date: string;
  items?: number;
  yes?: number;
  no?: number;
  abstain?: number;
}

/** Given a parliament's sittings and "today", which calendar days does the strip draw? */
export const buildStripWindow = (
  sessions: StripSource[],
  todayIso: string,
): StripDay[] => {
  if (sessions.length === 0) return [];

  const byDate = new Map<
    string,
    {
      items: number;
      yes: number;
      no: number;
      abstain: number;
      tallied: boolean;
    }
  >();
  for (const session of sessions) {
    // Sum rather than overwrite: a sitting split across two index entries must read as one
    // busy day, not as only its last chunk.
    const prev = byDate.get(session.date) ?? {
      items: 0,
      yes: 0,
      no: 0,
      abstain: 0,
      tallied: false,
    };
    prev.items += session.items ?? 0;
    prev.yes += session.yes ?? 0;
    prev.no += session.no ?? 0;
    prev.abstain += session.abstain ?? 0;
    // A day is "tallied" only if the source actually supplied a split for it. Treating an
    // absent split as three zeroes would draw a legitimate sitting as an empty stack —
    // visually identical to a day on which nobody voted for anything.
    prev.tallied =
      prev.tallied ||
      session.yes !== undefined ||
      session.no !== undefined ||
      session.abstain !== undefined;
    byDate.set(session.date, prev);
  }

  const dates = [...byDate.keys()].sort();
  const lastSitting = toDay(dates[dates.length - 1]);
  const today = toDay(todayIso);

  const end =
    today > lastSitting && today - lastSitting <= LIVE_TAIL_DAYS * DAY_MS
      ? today
      : lastSitting;

  const nth = dates[Math.max(0, dates.length - TARGET_SITTINGS)];
  // The width cap is applied from `end`, which during a recess is TODAY rather than the
  // last sitting — so at a gap of exactly MAX_WINDOW_DAYS the clamp pushes `start` one day
  // PAST the last sitting and the strip draws 60 bare hairlines with peak === 0. That is
  // not the no-data state (days.length is 60, so its guard never fires); it is the "the
  // chamber did not sit" misread the whole component exists to prevent. Clamping to the
  // last sitting keeps at least one bar in frame whatever the gap.
  const start = Math.min(
    lastSitting,
    Math.max(toDay(nth), end - (MAX_WINDOW_DAYS - 1) * DAY_MS),
  );

  const days: StripDay[] = [];
  for (let t = start; t <= end; t += DAY_MS) {
    const iso = toIso(t);
    const day = byDate.get(iso);
    days.push({
      date: iso,
      items: day?.items ?? 0,
      ...(day?.tallied
        ? { tally: { yes: day.yes, no: day.no, abstain: day.abstain } }
        : {}),
    });
  }
  return days;
};
