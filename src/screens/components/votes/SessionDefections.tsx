import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { PartyTag } from "@/screens/components/party/PartyTag";
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

      <div className="space-y-3">
        {itemsWithDissents.map((m) => {
          const title = session.itemTitles?.[String(m.item.item)];
          const slug =
            session.itemSlugs?.[String(m.item.item)] ?? String(m.item.item);
          return (
            <div
              key={m.item.item}
              className="border-t pt-3 first:border-t-0 first:pt-0"
            >
              <Link
                to={`/votes/${session.date}/item-${slug}`}
                underline={false}
                className="text-sm font-medium hover:underline block mb-2"
              >
                <span className="text-xs text-muted-foreground tabular-nums mr-2">
                  #{m.item.item}
                </span>
                {title || `${t("votes_session_item") || "Item"} ${m.item.item}`}
              </Link>
              <ul className="flex flex-wrap gap-2">
                {m.dissenters.map((d) => {
                  const name =
                    session.mpNames?.[String(d.mpId)] ?? `MP #${d.mpId}`;
                  return (
                    <li
                      key={d.mpId}
                      className="inline-flex items-center gap-2 rounded-full border bg-muted/30 pl-1 pr-2 py-0.5"
                    >
                      <MpAvatar mpId={d.mpId} name={name} />
                      <Link
                        to={candidateUrl(d.mpId, name)}
                        underline={false}
                        className="text-xs font-medium hover:underline"
                      >
                        {name}
                      </Link>
                      <PartyTag partyShort={d.party} />
                      <span className="text-[10px] tabular-nums">
                        <span className={`font-semibold ${VOTE_COLOR[d.vote]}`}>
                          {t(VOTE_LABEL[d.vote]) || d.vote}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          {t("mp_voting_dissents_vs") || "vs."}{" "}
                        </span>
                        <span
                          className={`font-semibold ${VOTE_COLOR[d.majority]}`}
                        >
                          {t(VOTE_LABEL[d.majority]) || d.majority}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
};
