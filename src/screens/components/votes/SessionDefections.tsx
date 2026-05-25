import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "@/ux/Link";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { PartyTag } from "@/screens/components/party/PartyTag";
import { firstLastName, titleCaseName } from "@/lib/utils";
import type { SessionFile, VoteValue } from "@/data/parliament/votes/types";
import type { ItemMetrics } from "@/data/parliament/votes/sessionMetrics";

type Props = {
  session: SessionFile;
  perItem: ItemMetrics[];
  candidateUrl: (mpId: number, name: string) => string;
};

const VOTE_COLOR: Record<VoteValue, string> = {
  yes: "text-emerald-600",
  no: "text-red-600",
  abstain: "text-amber-600",
  absent: "text-muted-foreground",
};

const VOTE_LABEL: Record<VoteValue, string> = {
  yes: "vote_yes",
  no: "vote_no",
  abstain: "vote_abstain",
  absent: "vote_absent",
};

// Items with more than this many dissents render collapsed by default, so a
// session with one whole-faction split doesn't dominate the page. Items below
// the threshold stay expanded so small breaks remain visible at a glance.
const AUTO_COLLAPSE_DISSENT_THRESHOLD = 6;

type DissentVote = Exclude<VoteValue, "absent">;

interface DefectionGroup {
  party: string;
  vote: DissentVote;
  majority: VoteValue;
  mpIds: number[];
}

const groupDissenters = (
  dissenters: ItemMetrics["dissenters"],
): DefectionGroup[] => {
  const map = new Map<string, DefectionGroup>();
  for (const d of dissenters) {
    const key = `${d.party}|${d.vote}|${d.majority}`;
    const g = map.get(key);
    if (g) g.mpIds.push(d.mpId);
    else
      map.set(key, {
        party: d.party,
        vote: d.vote,
        majority: d.majority,
        mpIds: [d.mpId],
      });
  }
  return [...map.values()].sort((a, b) => b.mpIds.length - a.mpIds.length);
};

export const SessionDefections: FC<Props> = ({
  session,
  perItem,
  candidateUrl,
}) => {
  const { t } = useTranslation();
  const itemsWithDissents = perItem.filter((m) => m.dissenters.length > 0);
  if (itemsWithDissents.length === 0) return null;
  const totalDissents = itemsWithDissents.reduce(
    (sum, m) => sum + m.dissenters.length,
    0,
  );

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          {t("votes_session_dissents_title") || "Cross-group votes"}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("votes_session_dissents_lead") ||
            "MPs who broke with the group plurality."}{" "}
          <span className="tabular-nums">{totalDissents}</span>{" "}
          {t("votes_session_dissents_across") || "votes across"}{" "}
          <span className="tabular-nums">{itemsWithDissents.length}</span>{" "}
          {t("votes_session_dissents_items") || "items"}
        </p>
      </header>

      <div className="space-y-1">
        {itemsWithDissents.map((m) => (
          <DefectionItemRow
            key={m.item.item}
            session={session}
            item={m}
            candidateUrl={candidateUrl}
          />
        ))}
      </div>
    </section>
  );
};

const DefectionItemRow: FC<{
  session: SessionFile;
  item: ItemMetrics;
  candidateUrl: (mpId: number, name: string) => string;
}> = ({ session, item, candidateUrl }) => {
  const { t } = useTranslation();
  const groups = useMemo(
    () => groupDissenters(item.dissenters),
    [item.dissenters],
  );
  const total = item.dissenters.length;
  const factionCount = new Set(item.dissenters.map((d) => d.party)).size;
  const [open, setOpen] = useState(total <= AUTO_COLLAPSE_DISSENT_THRESHOLD);

  const title = session.itemTitles?.[String(item.item.item)];
  const slug =
    session.itemSlugs?.[String(item.item.item)] ?? String(item.item.item);

  // Single-faction small items don't need a separate "N dissents" subline —
  // the group row that follows carries the same information at no extra cost.
  // Keep the subline when the item is collapsed (it's the only signal then)
  // or when the breakdown is non-trivial (>1 faction or >3 dissents).
  const showSubline = !open || factionCount > 1 || total > 3;

  return (
    <div className="border-t pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={
            open ? t("collapse") || "Collapse" : t("expand") || "Expand"
          }
          className="mt-0.5 p-0.5 rounded hover:bg-muted/60 transition-colors shrink-0"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <Link
            to={`/votes/${session.date}/item-${slug}`}
            underline={false}
            className="text-sm font-medium hover:underline block"
          >
            <span className="text-xs text-muted-foreground tabular-nums mr-2">
              #{item.item.item}
            </span>
            {title || `${t("votes_session_item") || "Item"} ${item.item.item}`}
          </Link>
          {showSubline && (
            <div className="text-xs text-muted-foreground mt-0.5 tabular-nums flex items-center gap-2 flex-wrap">
              <span>
                <span className="font-semibold text-foreground">{total}</span>{" "}
                {t("votes_session_dissents_count_label", { count: total }) ||
                  "dissents"}
              </span>
              {factionCount > 1 && (
                <>
                  <span>·</span>
                  <span>
                    <span className="font-semibold text-foreground">
                      {factionCount}
                    </span>{" "}
                    {t("votes_session_dissents_factions_label", {
                      count: factionCount,
                    }) || "factions"}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-2 ml-6 space-y-2 pb-1">
          {groups.map((g) => (
            <DefectionGroupRow
              key={`${g.party}|${g.vote}|${g.majority}`}
              session={session}
              group={g}
              candidateUrl={candidateUrl}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const DefectionGroupRow: FC<{
  session: SessionFile;
  group: DefectionGroup;
  candidateUrl: (mpId: number, name: string) => string;
}> = ({ session, group, candidateUrl }) => {
  const { t } = useTranslation();
  const n = group.mpIds.length;
  // Single-MP groups omit the redundant "1 депутат" token — the lone chip
  // following the header speaks for itself, keeping the row to one line.
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
      <PartyTag partyShort={group.party} />
      {n > 1 && (
        <>
          <span>
            <span className="font-semibold tabular-nums text-foreground">
              {n}
            </span>{" "}
            <span className="text-muted-foreground">
              {t("votes_session_dissents_mps_unit", { count: n }) || "MPs"}
            </span>
          </span>
          <span className="text-muted-foreground">·</span>
        </>
      )}
      <span className={`font-semibold ${VOTE_COLOR[group.vote]}`}>
        {t(VOTE_LABEL[group.vote]) || group.vote}
      </span>
      <span className="text-muted-foreground">
        {t("mp_voting_dissents_vs") || "vs."}
      </span>
      <span className={`font-semibold ${VOTE_COLOR[group.majority]}`}>
        {t(VOTE_LABEL[group.majority]) || group.majority}
      </span>
      {group.mpIds.map((mpId) => {
        const name = session.mpNames?.[String(mpId)] ?? `MP #${mpId}`;
        const display = titleCaseName(firstLastName(name));
        return (
          <span
            key={mpId}
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted/30 pl-1 pr-3 py-0.5"
          >
            <MpAvatar mpId={mpId} name={name} />
            <Link
              to={candidateUrl(mpId, name)}
              underline={false}
              className="font-medium hover:underline"
              title={titleCaseName(name)}
            >
              {display}
            </Link>
          </span>
        );
      })}
    </div>
  );
};
