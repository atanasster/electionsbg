// Who was not in the room — by name, for one plenary day.
//
// WHY IT EXISTS. The hub's „Отсъствие" card says „50 от 240 депутати не гласуваха по нито
// една точка" and links here, and until this section landed the answer to the obvious next
// question — WHICH fifty — was nowhere on the page it linked to. The data was already
// loaded: the session file carries every MP's vote on every item, so the names cost nothing
// extra to show. A card that states a count and lands on a page that cannot name it is worse
// than no card.
//
// THE DEFINITION IS "ABSENT FROM EVERY ITEM THEY WERE ON THE ROLL FOR", and it is the same
// one the hub's card counts, deliberately — the number in the heading here and the number on
// the card must be the same claim. „Missed at least one item" is a different and much larger
// set: on a 219-item budget day it is most of the chamber, since anyone who stepped out for
// one procedural vote qualifies, and it would say nothing about attendance.
//
// A member who appears on SOME of the day's items and is absent on all of those is NOT
// counted. They were recorded present for part of the sitting; the roll simply does not list
// them for the rest, and calling that a full absence would put a claim on the page the
// corpus does not support.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { PartyTag } from "@/screens/components/party/PartyTag";
import { firstLastName, titleCaseName } from "@/lib/utils";
import type { SessionFile } from "@/data/parliament/votes/types";

type Props = {
  session: SessionFile;
  candidateUrl: (mpId: number, name: string) => string;
};

export interface AbsentMp {
  mpId: number;
  name: string;
  party: string;
}

/** Members absent from every one of the day's items, grouped by party.
 *
 *  Exported for the test: the count this renders has to equal the one the hub card states,
 *  and both are derived from the same rule rather than from each other. */
export const fullyAbsent = (session: SessionFile): AbsentMp[] => {
  const dayItems = session.sessions.length;
  if (dayItems === 0) return [];
  const onRoll = new Map<number, number>();
  const missed = new Map<number, number>();
  for (const item of session.sessions) {
    for (const v of item.votes ?? []) {
      onRoll.set(v.mpId, (onRoll.get(v.mpId) ?? 0) + 1);
      if (v.vote === "absent")
        missed.set(v.mpId, (missed.get(v.mpId) ?? 0) + 1);
    }
  }
  const out: AbsentMp[] = [];
  for (const [mpId, items] of onRoll) {
    // Both clauses matter. `items === dayItems` keeps a member who is on the roll for only
    // part of the sitting out of the set; `missed === items` is the absence itself.
    if (items !== dayItems) continue;
    if ((missed.get(mpId) ?? 0) !== items) continue;
    out.push({
      mpId,
      name: session.mpNames?.[String(mpId)] ?? `MP ${mpId}`,
      party: session.mpParty?.[String(mpId)] ?? "",
    });
  }
  return out.sort(
    (a, b) => a.party.localeCompare(b.party) || a.name.localeCompare(b.name),
  );
};

export const SessionAbsentees: FC<Props> = ({ session, candidateUrl }) => {
  const { t } = useTranslation();
  const absent = useMemo(() => fullyAbsent(session), [session]);
  const byParty = useMemo(() => {
    const map = new Map<string, AbsentMp[]>();
    for (const mp of absent) {
      const key = mp.party || "—";
      map.set(key, [...(map.get(key) ?? []), mp]);
    }
    // Largest group first — the interesting fact is usually which group stayed away.
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [absent]);

  // A sitting nobody missed is a real and pleasant answer, but it is not worth a section.
  if (absent.length === 0) return null;

  const onRollCount = new Set(
    session.sessions.flatMap((i) => (i.votes ?? []).map((v) => v.mpId)),
  ).size;

  return (
    // The id is the hub card's anchor target — /votes/<date>#absent.
    <section id="absent" className="space-y-3 rounded-xl border bg-card p-4">
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          {t("votes_session_absent_title")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {/* The BASIS, on the page, beside the number. „50 от 240" without „по нито една
              точка" is the figure that gets quoted as "50 MPs skipped parliament". */}
          {t("votes_session_absent_lead", {
            count: absent.length,
            roll: onRollCount,
            items: session.sessions.length,
          })}
        </p>
      </header>

      <div className="space-y-2">
        {byParty.map(([party, mps]) => (
          <div
            key={party}
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            <span className="flex items-center gap-1.5">
              {party === "—" ? null : <PartyTag partyShort={party} />}
              <span className="text-xs tabular-nums text-muted-foreground">
                {mps.length}
              </span>
            </span>
            {mps.map((mp) => (
              <Link
                key={mp.mpId}
                to={candidateUrl(mp.mpId, mp.name)}
                underline={false}
                className="flex items-center gap-1.5 rounded-full border border-border px-1.5 py-0.5 text-xs hover:border-foreground/25"
              >
                <MpAvatar
                  mpId={mp.mpId}
                  name={mp.name}
                  className="h-[18px] w-[18px]"
                />
                {titleCaseName(firstLastName(mp.name))}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
};
