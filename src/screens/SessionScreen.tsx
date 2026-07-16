import { FC, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Link } from "@/ux/Link";
import { PartyTag } from "@/screens/components/party/PartyTag";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Title } from "@/ux/Title";
import { Breadcrumbs } from "@/ux/Breadcrumbs";
import { useRollcallSession } from "@/data/parliament/votes/useRollcallSession";
import { useCandidateUrlForVote } from "@/data/parliament/votes/useCandidateUrlForVote";
import { useMps } from "@/data/parliament/useMps";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { SessionVoteHemicycle } from "@/screens/components/votes/SessionVoteHemicycle";
import { TopicChip } from "@/screens/components/votes/TopicChip";
import { CopyTopicLink } from "@/screens/components/votes/CopyTopicLink";
import { RollcallHeatmap } from "@/screens/components/votes/RollcallHeatmap";
import { SessionStatsTiles } from "@/screens/components/votes/SessionStatsTiles";
import { SessionItemBreakdown } from "@/screens/components/votes/SessionItemBreakdown";
import { SessionDefections } from "@/screens/components/votes/SessionDefections";
import { computeSessionMetrics } from "@/data/parliament/votes/sessionMetrics";
import { majorityFor } from "@/data/parliament/votes/majority";
import type { SessionItem, VoteValue } from "@/data/parliament/votes/types";

// Threshold for switching the per-session visualization from per-item party
// breakdown cards (legible at a glance) to the embedding-clustered heatmap
// (only meaningful when there are many items to spot patterns across).
const HEATMAP_MIN_ITEMS = 8;

const VOTE_LABELS: Record<VoteValue, string> = {
  yes: "yes",
  no: "no",
  abstain: "abstain",
  absent: "absent",
};

const VOTE_COLOR: Record<VoteValue, string> = {
  yes: "text-emerald-600",
  no: "text-red-600",
  abstain: "text-amber-600",
  absent: "text-muted-foreground",
};

const formatDate = (iso: string, lang: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
};

const castCount = (item: SessionItem): number =>
  item.tallies.yes + item.tallies.no + item.tallies.abstain;

const isUnanimous = (item: SessionItem): boolean => {
  const { yes, no, abstain } = item.tallies;
  const cast = castCount(item);
  if (cast === 0) return true;
  return yes === cast || no === cast || abstain === cast;
};

// Roll-call sessions begin and sometimes end with quorum-check items where
// every seated MP is marked "absent" — there is no actual vote to render.
// We filter these out unconditionally; the date header still notes the seated
// count for the session as a whole, so the registration item is just noise.
const isCastVote = (item: SessionItem): boolean => castCount(item) > 0;

// Per-item outcome label derived from the tally. Used in place of the
// meaningless "Точка #N" header — parliament.bg doesn't expose bill titles
// via API, so a tally-derived headline ("Прието единодушно", "Отхвърлено",
// "Спорно") is the most useful summary we can show without a separate
// stenogram-text scrape.
type Outcome =
  | "passed_unanimous"
  | "passed"
  | "rejected_unanimous"
  | "rejected"
  | "abstain_unanimous"
  | "contested";

const outcomeFor = (item: SessionItem): Outcome => {
  const { yes, no, abstain } = item.tallies;
  const cast = castCount(item);
  if (yes === cast) return "passed_unanimous";
  if (no === cast) return "rejected_unanimous";
  if (abstain === cast) return "abstain_unanimous";
  if (yes > no + abstain) return "passed";
  if (no + abstain > yes) return "rejected";
  return "contested";
};

const OUTCOME_COLOR: Record<Outcome, string> = {
  passed_unanimous: "text-emerald-700",
  passed: "text-emerald-700",
  rejected_unanimous: "text-red-700",
  rejected: "text-red-700",
  abstain_unanimous: "text-amber-700",
  contested: "text-foreground",
};

export const SessionScreen: FC = () => {
  // `slug` is the optional second path segment ("item-7-zid-na-zkpo"). The
  // integer after "item-" is the authoritative item number — the slug tail
  // is decorative and can change without breaking the URL.
  const { date, slug } = useParams<{ date: string; slug?: string }>();
  const slugItemNo = useMemo(() => {
    if (!slug) return null;
    const m = /^item-(\d+)/.exec(slug);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  }, [slug]);
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mpParam = params.get("mp");
  const focusedMpId = mpParam ? Number(mpParam) : null;
  const [hideUnanimous, setHideUnanimous] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(
    slugItemNo != null ? new Set([slugItemNo]) : new Set(),
  );

  const { session, isLoading } = useRollcallSession(date ?? null);
  const { findMpById } = useMps();
  const candidateUrl = useCandidateUrlForVote();

  // Legacy support: `/votes/:date#item-N` (used before canonical slug URLs
  // existed) → redirect to `/votes/:date/item-N-slug`. Runs once after the
  // session loads so we can resolve the slug.
  useEffect(() => {
    if (slugItemNo != null) return;
    if (!session || !date) return;
    const hash = window.location.hash;
    if (!hash.startsWith("#item-")) return;
    const n = parseInt(hash.slice("#item-".length), 10);
    if (!Number.isFinite(n)) return;
    const target = session.itemSlugs?.[String(n)] ?? String(n);
    navigate(`/votes/${date}/item-${target}${window.location.search}`, {
      replace: true,
    });
  }, [slugItemNo, session, date, navigate]);

  // Keep the deep-linked item open as the URL changes (covers the legacy
  // `#item-N` redirect and any future replace navigations).
  useEffect(() => {
    if (slugItemNo == null) return;
    setExpanded((prev) => {
      if (prev.has(slugItemNo)) return prev;
      const next = new Set(prev);
      next.add(slugItemNo);
      return next;
    });
  }, [slugItemNo]);

  // Scroll the deep-linked item into view once the session is rendered.
  useEffect(() => {
    if (slugItemNo == null) return;
    if (!session) return;
    const el = document.getElementById(`item-${slugItemNo}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [slugItemNo, session]);

  const items = useMemo(() => {
    if (!session) return [];
    // Always drop registration / quorum items (every MP marked absent).
    const cast = session.sessions.filter(isCastVote);
    return hideUnanimous ? cast.filter((i) => !isUnanimous(i)) : cast;
  }, [session, hideUnanimous]);

  // Stash the raw item count (after the absent-only filter) for the "shown"
  // counter so toggling "hide unanimous" reports against a meaningful base.
  const castItemCount = useMemo(
    () => session?.sessions.filter(isCastVote).length ?? 0,
    [session],
  );

  const metrics = useMemo(
    () => (session ? computeSessionMetrics(session) : null),
    [session],
  );
  // Roster lookup first; fall back to the session-file `mpNames` map when
  // the CSV id isn't in the deduped roster (parliament.bg recycles ids
  // across NSes — see useCandidateUrlForVote for the longer note).
  const focusedRosterMp = focusedMpId != null ? findMpById(focusedMpId) : null;
  const focusedSessionName =
    focusedMpId != null ? session?.mpNames?.[String(focusedMpId)] : undefined;
  const focusedName = focusedRosterMp?.name ?? focusedSessionName ?? null;

  // The URL `mp` param is a roster id, but session vote rows are keyed by the
  // per-NS parliament.bg id (different number for the same person). Bridge
  // through `mpNames`: if the roster id isn't already a session key, find the
  // session key whose name matches the roster name.
  const sessionMpId = useMemo<number | null>(() => {
    if (focusedMpId == null || !session) return null;
    if (session.mpNames?.[String(focusedMpId)]) return focusedMpId;
    if (!focusedName) return null;
    const target = focusedName.toUpperCase().replace(/\s+/g, " ").trim();
    for (const [id, name] of Object.entries(session.mpNames ?? {})) {
      if (name.toUpperCase().replace(/\s+/g, " ").trim() === target) {
        return Number(id);
      }
    }
    return null;
  }, [focusedMpId, focusedName, session]);

  const lang = i18n.language;
  const headingDate = date ? formatDate(date, lang) : "";
  const pageTitle = `${t("votes_session_title") || "Voting session"} · ${headingDate}`;

  return (
    <div className="w-full px-4 md:px-8">
      <Title description={pageTitle}>{pageTitle}</Title>
      <Breadcrumbs
        className="mt-5"
        items={[
          { label: t("nav_governance"), to: "/governance" },
          { label: t("gov_hub_parliament_title"), to: "/parliament" },
          { label: t("sessions_index_title"), to: "/votes" },
          { label: headingDate },
        ]}
      />

      <div className="pb-12 space-y-4">
        {focusedMpId != null && focusedName && (
          <div className="flex items-center justify-end gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {t("votes_session_focused_mp") || "Highlighting votes for"}:
              </span>
              <MpAvatar
                mpId={focusedRosterMp?.id ?? focusedMpId}
                name={focusedName}
              />
              <Link
                to={candidateUrl(focusedMpId, focusedName)}
                underline={false}
                className="text-primary hover:underline"
              >
                {focusedName}
              </Link>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-muted-foreground">
            {t("loading") || "Loading…"}
          </div>
        ) : !session ? (
          <div className="text-sm text-muted-foreground">
            {t("votes_session_not_found") ||
              "No roll-call data was found for this date."}
          </div>
        ) : (
          <>
            {metrics && (
              <SessionStatsTiles
                session={session}
                metrics={metrics}
                headingDate={headingDate}
              />
            )}

            {metrics && metrics.perItem.length >= HEATMAP_MIN_ITEMS ? (
              <RollcallHeatmap session={session} />
            ) : metrics && metrics.perItem.length > 0 ? (
              <SessionItemBreakdown
                session={session}
                perItem={metrics.perItem}
              />
            ) : null}

            {metrics && (
              <SessionDefections
                session={session}
                perItem={metrics.perItem}
                candidateUrl={candidateUrl}
              />
            )}

            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideUnanimous}
                  onChange={(e) => setHideUnanimous(e.target.checked)}
                  className="h-4 w-4"
                />
                {t("votes_session_hide_unanimous") || "Hide unanimous votes"}
              </label>
              <span className="text-xs text-muted-foreground">
                {items.length} / {castItemCount}{" "}
                {t("votes_session_shown") || "shown"}
              </span>
            </div>

            <ul className="divide-y border rounded-xl bg-card">
              {items.map((item) => {
                const isOpen = expanded.has(item.item);
                const itemSlug =
                  session.itemSlugs?.[String(item.item)] ?? String(item.item);
                const itemTopic = session.itemTopics?.[String(item.item)];
                const focusedVote =
                  sessionMpId != null
                    ? item.votes.find((v) => v.mpId === sessionMpId)?.vote
                    : null;
                const focusedParty =
                  sessionMpId != null
                    ? session.mpParty?.[String(sessionMpId)]
                    : null;
                const focusedMajority =
                  focusedParty && session.mpParty
                    ? majorityFor(item, focusedParty, session.mpParty)
                    : null;
                const isDissent =
                  !!focusedVote &&
                  focusedVote !== "absent" &&
                  !!focusedMajority &&
                  focusedVote !== focusedMajority;
                return (
                  <li
                    key={item.item}
                    id={`item-${item.item}`}
                    className={
                      isDissent ? "bg-amber-50/60 dark:bg-amber-900/10" : ""
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.item)) next.delete(item.item);
                          else next.add(item.item);
                          return next;
                        })
                      }
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div
                          className={`font-medium ${isOpen ? "" : "line-clamp-2"}`}
                        >
                          <span className="text-xs text-muted-foreground font-normal mr-2 tabular-nums">
                            #{item.item}
                          </span>
                          {session.itemTitles?.[String(item.item)] ? (
                            <>
                              <span
                                className={`text-[10px] uppercase tracking-wide font-semibold mr-2 ${OUTCOME_COLOR[outcomeFor(item)]}`}
                              >
                                {t(`votes_outcome_${outcomeFor(item)}`) ||
                                  outcomeFor(item)}
                              </span>
                              <span>
                                {session.itemTitles[String(item.item)]}
                              </span>
                            </>
                          ) : (
                            <span className={OUTCOME_COLOR[outcomeFor(item)]}>
                              {t(`votes_outcome_${outcomeFor(item)}`) ||
                                outcomeFor(item)}
                            </span>
                          )}
                        </div>
                        {itemTopic && (
                          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                            <TopicChip topic={itemTopic} linkable={false} />
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-3 mt-0.5 tabular-nums">
                          <span className="text-emerald-600">
                            {t("vote_yes") || "Yes"}: {item.tallies.yes}
                          </span>
                          <span className="text-red-600">
                            {t("vote_no") || "No"}: {item.tallies.no}
                          </span>
                          <span className="text-amber-600">
                            {t("vote_abstain") || "Abstain"}:{" "}
                            {item.tallies.abstain}
                          </span>
                          <span>
                            {t("vote_absent") || "Absent"}:{" "}
                            {item.tallies.absent}
                          </span>
                        </div>
                      </div>
                      {focusedVote && (
                        <span
                          className={`text-xs font-semibold uppercase tracking-wide ${VOTE_COLOR[focusedVote]}`}
                        >
                          {t(`vote_${VOTE_LABELS[focusedVote]}`) ||
                            VOTE_LABELS[focusedVote]}
                        </span>
                      )}
                    </button>
                    {isOpen && (
                      <>
                        <div className="px-4 py-2 flex items-center gap-3 flex-wrap border-t bg-muted/10">
                          {itemTopic && <TopicChip topic={itemTopic} />}
                          {date && (
                            <CopyTopicLink date={date} slug={itemSlug} />
                          )}
                        </div>
                        <SessionVoteHemicycle
                          item={item}
                          mpParty={session.mpParty}
                          mpNames={session.mpNames}
                        />
                        <PerPartyBreakdown
                          item={item}
                          mpParty={session.mpParty}
                        />
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};

const PerPartyBreakdown: FC<{
  item: SessionItem;
  mpParty?: Record<string, string>;
}> = ({ item, mpParty }) => {
  const { t } = useTranslation();
  const rows = useMemo(() => {
    if (!mpParty) return [];
    const byParty = new Map<string, Record<VoteValue, number>>();
    for (const v of item.votes) {
      const party = mpParty[String(v.mpId)] ?? "—";
      const row = byParty.get(party) ?? {
        yes: 0,
        no: 0,
        abstain: 0,
        absent: 0,
      };
      row[v.vote]++;
      byParty.set(party, row);
    }
    return [...byParty.entries()].sort(
      (a, b) =>
        b[1].yes + b[1].no + b[1].abstain - (a[1].yes + a[1].no + a[1].abstain),
    );
  }, [item, mpParty]);

  if (rows.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground">
        {t("votes_session_no_party_data") ||
          "Per-party breakdown unavailable for this item."}
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-muted/20 border-t">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th className="text-left font-normal py-1 pr-2">
              {t("votes_session_party") || "Party"}
            </th>
            <th className="text-right font-normal py-1 px-2 tabular-nums">
              {t("vote_yes") || "Yes"}
            </th>
            <th className="text-right font-normal py-1 px-2 tabular-nums">
              {t("vote_no") || "No"}
            </th>
            <th className="text-right font-normal py-1 px-2 tabular-nums">
              {t("vote_abstain") || "Abstain"}
            </th>
            <th className="text-right font-normal py-1 pl-2 tabular-nums">
              {t("vote_absent") || "Absent"}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([party, counts]) => (
            <tr key={party} className="border-b border-border/30">
              <td className="py-1 pr-2">
                <PartyTag partyShort={party} />
              </td>
              <td className="py-1 px-2 text-right tabular-nums">
                {counts.yes || "—"}
              </td>
              <td className="py-1 px-2 text-right tabular-nums">
                {counts.no || "—"}
              </td>
              <td className="py-1 px-2 text-right tabular-nums">
                {counts.abstain || "—"}
              </td>
              <td className="py-1 pl-2 text-right tabular-nums">
                {counts.absent || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
