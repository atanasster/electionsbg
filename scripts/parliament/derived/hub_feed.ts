// The /parliament hub's per-NS feed — bands 0–2 (wire, lead, news rail) and the session
// strip's outcome split, as one small shard per parliament.
//
// WHY A SECOND ARTIFACT (plan §5.1). hub_stats.json is fetched by every visitor and holds
// numbers only; this one holds Bulgarian bill titles, which routinely run 130+ characters.
// Nine parliaments of rail in the always-fetched blob would be ~38 KB of text, eight ninths
// of it for a parliament the reader is not looking at. Sharded per NS — the same shape and
// the same directory as important_votes/<ns>.json — it is fetched on demand and stays under
// the 12 KB budget §11 asserts.
//
// ===========================================================================
// THE ARTIFACT CARRIES SOURCE TEXT AND NUMBERS. IT CARRIES NO GLUE PROSE AND NO URLS.
//
// `title` is a bill title or a person's name — text that exists only in Bulgarian and
// cannot be translated by us. Everything else the card displays ("39 точки · 73%
// присъствие") is composed in the SPA from `stats` under an i18n key chosen by `kind`, so
// the English hub is not a Bulgarian one with English headings.
//
// Destinations are `target` discriminators, not hrefs. /candidate/mp-<id> is built by
// candidateSlug.ts, and a second copy of that rule living in scripts/ is precisely the
// drift this module was written to avoid elsewhere: the URL shape would change in src and
// this generator would keep emitting the old one, green in both files.
// ===========================================================================

import type { SessionFile, SessionItemFile } from "./types";
import type { DissentOutput } from "./dissents";
import { normalizeTitle } from "./dedupe";
import { importanceScore, contestScoreFor, castCount } from "./important_votes";
import { secondReadingStem, secondReadingStems } from "./hub_stats";
// ONE declaration of the shard's shape, on the src/ side. See hubFeedTypes.ts for why the
// hand-copied halves had to go: they drifted on HubWire.attendance's nullability inside a
// single review cycle, and the compiler stopped watching the one field that has a null in
// the committed data.
import type {
  FeedItem,
  HubFeedFile,
  HubLead,
} from "../../../src/data/parliament/hubFeedTypes";

export type {
  FeedTarget,
  FeedKind,
  FeedItem,
  HubLead,
  StripDay,
  HubWire,
  HubFeedFile,
} from "../../../src/data/parliament/hubFeedTypes";

const MAX_PER_CARD = 4;
/** SITTINGS, not calendar days. The consumer's window is at most `MAX_WINDOW_DAYS` (60)
 *  calendar days wide, which cannot contain more than 60 sittings, so this is a superset of
 *  whatever the strip asks for. Widening that window means raising this. */
const STRIP_SITTINGS = 60;

export interface HubFeedInput {
  ns: string;
  /** DEDUPED sessions for this NS — the same array every other metric is computed over. */
  sessions: SessionFile[];
  dissents: DissentOutput | undefined;
  /** Editorial override for the lead, from data/parliament/votes/leads.json. */
  curatedLead?: { date: string; item: number };
  /** The run's timestamp, threaded in rather than read from the clock here — the shards are
   *  committed, so a wall-clock read guarantees nine modified files after every rebuild and
   *  buries a real content change in the diff. It also makes the function testable. */
  computedAt: string;
}

const titleOf = (session: SessionFile, item: number): string => {
  const raw = session.itemTitles?.[String(item)];
  return raw ? normalizeTitle(raw) : "";
};

const slugOf = (session: SessionFile, item: number): string =>
  session.itemSlugs?.[String(item)] ?? String(item);

/** Latest name we hold for each MP in this parliament. dissents.json and attendance.json
 *  carry mpId + party but no name; the session files carry the name. Later sittings win, so
 *  a member who changed name mid-term is shown as they were last recorded. */
const nameIndex = (sessions: SessionFile[]): Map<number, string> => {
  const out = new Map<number, string>();
  const byDate = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  for (const session of byDate) {
    for (const [id, name] of Object.entries(session.mpNames ?? {})) {
      if (name) out.set(Number(id), name);
    }
  }
  return out;
};

const dayTally = (
  session: SessionFile,
): { yes: number; no: number; abstain: number; absent: number } => {
  const out = { yes: 0, no: 0, abstain: 0, absent: 0 };
  for (const item of session.sessions) {
    out.yes += item.tallies.yes;
    out.no += item.tallies.no;
    out.abstain += item.tallies.abstain;
    out.absent += item.tallies.absent;
  }
  return out;
};

/** The day's most consequential item, by the same scorer the important-votes shard and the
 *  prerendered /votes/<date> bodies use. A third vocabulary for "what mattered here" is how
 *  a page ends up naming one item in its <h1> and a different one in its rail. */
const headlineItem = (
  session: SessionFile,
): { item: SessionItemFile; title: string } | null => {
  let best: { item: SessionItemFile; title: string; score: number } | null =
    null;
  for (const it of session.sessions) {
    const title = titleOf(session, it.item);
    if (!title) continue;
    const score = importanceScore(title, contestScoreFor(it));
    if (score === 0) continue;
    if (!best || score > best.score) best = { item: it, title, score };
  }
  return best ? { item: best.item, title: best.title } : null;
};

/** `stats`: items · yes · no · abstain — the day's tally summed across every item.
 *
 *  These are VOTES, not members, and they are summed over the whole sitting: the 52nd's
 *  budget day carries 219 items and so `yes: 15961`. Printed raw beside a date that number
 *  reads as "15,961 members voted for", which is off by two orders of magnitude and names
 *  a chamber of 240. The card must therefore express them as SHARES of the day's cast votes
 *  — which is also the encoding the session strip's colours use, so the two agree by
 *  construction rather than by anyone remembering to keep them in step. */
const sessionCards = (sessions: SessionFile[]): FeedItem[] =>
  [...sessions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_PER_CARD)
    .map((session) => {
      const tally = dayTally(session);
      const headline = headlineItem(session);
      return {
        id: `session-${session.date}`,
        kind: "session" as const,
        at: session.date,
        // The headline item NAMES the day; it does not stand in for it. The card links to
        // the whole sitting, so a reader who follows it lands on every item rather than on
        // the one we chose — which is why an unnamed day degrades to "" and an i18n
        // fallback rather than to the first title we can find.
        title: headline?.title ?? "",
        stats: {
          items: session.sessions.length,
          yes: tally.yes,
          no: tally.no,
          abstain: tally.abstain,
        },
        target: { kind: "session" as const, date: session.date },
      };
    });

/** `stats`: articles — the number of per-article votes this bill's second reading took. */
const billCards = (sessions: SessionFile[]): FeedItem[] =>
  secondReadingStems(sessions)
    .slice(0, MAX_PER_CARD)
    .map((bill) => ({
      id: `bill-${bill.lastItem.date}-${bill.lastItem.item}`,
      kind: "bill" as const,
      at: bill.lastDate,
      title: normalizeTitle(bill.stem),
      stats: { articles: bill.items },
      target: {
        kind: "item" as const,
        date: bill.lastItem.date,
        slug: bill.lastItem.slug,
      },
    }));

/** `stats`: dissents · cast — votes against the member's own group, over votes cast.
 *
 *  Ranked by the COUNT, not the rate. A rate ranking puts a member who cast nine votes and
 *  broke on two at 22% above one who broke 180 times in 4,000, and the card's question is
 *  „кой гласува срещу своите", which is a count. The denominator ships beside it so the
 *  reader can compute the rate themselves. */
const dissentCards = (
  dissents: DissentOutput | undefined,
  names: Map<number, string>,
): FeedItem[] =>
  [...(dissents?.entries ?? [])]
    .filter((e) => e.dissentCount > 0 && e.recent.length > 0)
    .sort((a, b) =>
      b.dissentCount === a.dissentCount
        ? b.dissentCount / Math.max(b.totalCast, 1) -
          a.dissentCount / Math.max(a.totalCast, 1)
        : b.dissentCount - a.dissentCount,
    )
    .slice(0, MAX_PER_CARD)
    .map((e) => ({
      id: `dissent-${e.mpId}`,
      kind: "dissent" as const,
      // `recent` is newest-first, so this is the member's latest break with their group —
      // a real event date rather than the build's.
      at: e.recent[0].date,
      title: names.get(e.mpId) ?? String(e.mpId),
      badge: e.partyShort || undefined,
      stats: { dissents: e.dissentCount, cast: e.totalCast },
      target: { kind: "mp" as const, mpId: e.mpId },
    }));

/** `stats`: absent · roll · items — members who cast NOTHING on the last sitting, of those
 *  on its roll, over the day's items.
 *
 *  ONE AGGREGATE CARD, NOT A LEADERBOARD OF NAMED PEOPLE, and the reason is in the data.
 *  The 52nd's last sitting ran five items; everyone who skipped it missed all five, so a
 *  per-member ranking is a table of ties broken by whatever the sort falls back on — in the
 *  first draft, ascending mpId. That named four sitting MPs on the module's front page in an
 *  order carrying no information about them at all. An aggregate answers the same question
 *  („колко не се явиха") without attributing a rank nobody earned, and the sitting it links
 *  to shows exactly who.
 *
 *  Scoped to the LAST SITTING, which is what makes it an event with a date. A term-wide
 *  "least present" figure has no date, and dating it with the window end reads as a claim
 *  about that particular day. */
const absenceCards = (sessions: SessionFile[]): FeedItem[] => {
  const last = [...sessions].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!last || last.sessions.length === 0) return [];
  const missed = new Map<number, number>();
  const onRoll = new Map<number, number>();
  for (const item of last.sessions) {
    for (const v of item.votes) {
      onRoll.set(v.mpId, (onRoll.get(v.mpId) ?? 0) + 1);
      if (v.vote === "absent")
        missed.set(v.mpId, (missed.get(v.mpId) ?? 0) + 1);
    }
  }
  // Absent for EVERY item OF THE DAY — not "of the items they appear on", and not "missed at
  // least one", which on a 219-item budget day is nearly the whole chamber and says nothing.
  // The day's own count is the right denominator because the card's headline claims „не
  // гласуваха по нито една точка": a member recorded on 1 of 5 items and absent on that one
  // has not missed the sitting, and counting them would make that sentence false.
  const dayItems = last.sessions.length;
  const fullyAbsent = [...onRoll.entries()].filter(
    ([mpId, items]) => items === dayItems && (missed.get(mpId) ?? 0) === items,
  ).length;
  if (fullyAbsent === 0 || onRoll.size === 0) return [];
  // Same suppression as the wire's attendance clause, for the same reason. The 49th's final
  // sitting records two items with no roll call, so every one of its 240 members reads as
  // absent — and „240 от 240 депутати не гласуваха" states as fact that the chamber was
  // empty, where the corpus says only that it holds no votes for those items. A card that
  // would name the whole roll is measuring the ingest, not the sitting.
  if (fullyAbsent === onRoll.size) return [];
  return [
    {
      id: `absence-${last.date}`,
      kind: "absence" as const,
      at: last.date,
      // No natural title — the SPA composes this card's headline from the numbers.
      title: "",
      stats: {
        absent: fullyAbsent,
        roll: onRoll.size,
        items: dayItems,
      },
      // Anchored at the section that names the people this card counts.
      target: { kind: "session" as const, date: last.date, anchor: "absent" },
    },
  ];
};

/** NO `\b` BEFORE THE CYRILLIC. JavaScript defines a word boundary against `\w`, which is
 *  [A-Za-z0-9_] — every Cyrillic letter is a non-word character to it, so between a space and
 *  „п" there is no boundary and `/\bпърво/` matches NOTHING. The first draft carried it, and
 *  the 45th's lead — „… - първо гласуване" in its own title — shipped labelled „Гласуване".
 *  topics.ts and important_votes.ts both document this trap; the fix is the same shape they
 *  use, which is to anchor on the optional „на" instead. */
const FIRST_READING = /(?:на\s+)?първо\s+(?:гласуване|четене)/i;

const stageOf = (title: string): HubLead["stage"] => {
  if (secondReadingStem(title)) return "second";
  return FIRST_READING.test(title) ? "first" : "other";
};

/** The period's most consequential vote, over the FULL corpus for this parliament.
 *
 *  NOT read from important_votes/<ns>.json, which is a top-15 leaderboard carrying no
 *  reading stage: §4.2 measured the plan's original rule ("highest score among
 *  final-adoption items in that shard") returning NOTHING for the 48th and the 51st.
 *
 *  It also does not restrict to second readings, for the same reason. There is no adoption
 *  marker anywhere in this corpus, so „final adoption" is not a filter we can apply — it is
 *  an inference. The lead therefore reports the STAGE it found and the tally, and the card
 *  says „второ четене" or „първо четене" rather than „приет". That distinction is not
 *  pedantry: P3 measured 324 item pages where the majority-of-cast-votes reading of
 *  „приет" is wrong outright, because a чл.101 veto re-vote needs 121 of 240 rather than a
 *  majority of those present. */
const autoLead = (sessions: SessionFile[]): HubLead | null => {
  let best: {
    session: SessionFile;
    item: SessionItemFile;
    title: string;
    score: number;
    contest: number;
  } | null = null;
  for (const session of sessions) {
    for (const it of session.sessions) {
      if (castCount(it) === 0) continue;
      const title = titleOf(session, it.item);
      if (!title) continue;
      const contest = contestScoreFor(it);
      const score = importanceScore(title, contest);
      if (score === 0) continue;
      // Ties broken by how contested the vote was, then by recency. Score alone leaves the
      // lead at the mercy of array order — the budget law scores 75 on all 232 of its
      // article votes, and "whichever came first in the file" is not a selection rule.
      if (
        !best ||
        score > best.score ||
        (score === best.score &&
          (contest > best.contest ||
            (contest === best.contest && session.date > best.session.date)))
      ) {
        best = { session, item: it, title, score, contest };
      }
    }
  }
  if (!best) return null;
  return leadFrom(best.session, best.item, best.title, "auto");
};

const leadFrom = (
  session: SessionFile,
  item: SessionItemFile,
  title: string,
  source: HubLead["source"],
): HubLead => ({
  id: `lead-${session.date}-${item.item}`,
  kind: "bill",
  at: session.date,
  title,
  stage: stageOf(title),
  source,
  stats: {
    yes: item.tallies.yes,
    no: item.tallies.no,
    abstain: item.tallies.abstain,
    absent: item.tallies.absent,
  },
  target: {
    kind: "item",
    date: session.date,
    slug: slugOf(session, item.item),
  },
});

/** The curated lead, or a THROW. A missing override must not fall back to the automatic
 *  pick: the editor who added the entry would see a lead on the page and have no way to
 *  tell it was not theirs. */
const curatedLead = (
  sessions: SessionFile[],
  ref: { date: string; item: number },
  ns: string,
): HubLead => {
  const session = sessions.find((s) => s.date === ref.date);
  const item = session?.sessions.find((i) => i.item === ref.item);
  if (!session || !item) {
    throw new Error(
      `leads.json names NS ${ns} ${ref.date} item ${ref.item}, which is not in the deduped corpus. ` +
        `A re-vote may have collapsed it — pick the surviving item.`,
    );
  }
  return leadFrom(session, item, titleOf(session, item.item), "curated");
};

export const computeHubFeed = (input: HubFeedInput): HubFeedFile | null => {
  const { sessions } = input;
  if (sessions.length === 0) {
    // The curated-lead check comes BEFORE the empty-corpus return, or the one case the throw
    // exists for — an editor naming an item nobody can serve — is the one case it misses.
    if (input.curatedLead) {
      throw new Error(
        `leads.json names NS ${input.ns}, which has no roll-call sessions.`,
      );
    }
    return null;
  }
  const names = nameIndex(sessions);
  const byDateDesc = [...sessions].sort((a, b) => b.date.localeCompare(a.date));
  const last = byDateDesc[0];

  const lastTally = dayTally(last);
  const lastCast = lastTally.yes + lastTally.no + lastTally.abstain;
  // Raw title in, exactly as secondReadingStems reads it: the stem builder normalizes
  // internally, so both sides of this figure share one basis by construction.
  const lastBills = new Set(
    last.sessions
      .map((it) => secondReadingStem(last.itemTitles?.[String(it.item)] ?? ""))
      .filter((s): s is string => !!s),
  );

  return {
    computedAt: input.computedAt,
    ns: input.ns,
    wire: {
      date: last.date,
      items: last.sessions.length,
      bills: lastBills.size,
      attendance:
        lastCast > 0 ? lastCast / (lastCast + lastTally.absent) : null,
    },
    lead: input.curatedLead
      ? curatedLead(sessions, input.curatedLead, input.ns)
      : autoLead(sessions),
    feed: {
      sessions: sessionCards(sessions),
      bills: billCards(sessions),
      dissents: dissentCards(input.dissents, names),
      absences: absenceCards(sessions),
    },
    // Newest LAST, so the strip can read it as a calendar without re-sorting. Items are the
    // post-dedupe count, which is 5% below index.json's raw count on the 52nd — the strip
    // must take its heights from whichever source it takes its colours from, never one of
    // each.
    strip: byDateDesc
      .slice(0, STRIP_SITTINGS)
      .reverse()
      .map((session) => {
        const tally = dayTally(session);
        return {
          date: session.date,
          items: session.sessions.length,
          yes: tally.yes,
          no: tally.no,
          abstain: tally.abstain,
        };
      }),
  };
};
