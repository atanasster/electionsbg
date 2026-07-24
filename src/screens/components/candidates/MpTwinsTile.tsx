import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Link } from "@/ux/Link";
import { useMps } from "@/data/parliament/useMps";
import { useMpSimilarity } from "@/data/parliament/votes/useMpSimilarity";
import { hasVotingTwins } from "@/data/parliament/votes/similarityClass";
import { useMpProfile } from "@/data/parliament/votes/useMpProfile";
import { useCandidateUrlForVote } from "@/data/parliament/votes/useCandidateUrlForVote";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { MpAvatar } from "./MpAvatar";

type Props = { name: string };

const PREVIEW_PER_GROUP = 5;

const formatScore = (score: number, lang: string): string =>
  new Intl.NumberFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(Math.max(-1, Math.min(1, score)));

// Per-MP cross-party twins section on the candidate dashboard. Shows the top
// peers (other MPs whose vote vectors most closely match this MP) split into
// two groups: those from a different parliamentary group ("bridges", the
// journalism hook) and those from the same group. The full top-K (20 per
// derived/similarity.json) is hidden behind an expand toggle.
//
// Name + party resolution: the similarity entry's `topK[i].mpId` is a CSV id,
// so we resolve through both the roster (latest deduped id) and the latest
// session's `mpNames` / `mpParty` maps to surface names + colours regardless
// of parliament.bg's id-recycling.
export const MpTwinsTile: FC<Props> = ({ name }) => {
  const { t, i18n } = useTranslation();
  const { findMpByName, findMpById, isLoading: mpsLoading } = useMps();
  const mp = findMpByName(name);
  const { entry, isLoading: simLoading } = useMpSimilarity(mp?.id, name);
  const { mpParty: sessionParty, mpNames: sessionNames } = useMpProfile();
  const { colorForPartyShort, labelForPartyShort } = useParliamentGroups();
  const candidateUrl = useCandidateUrlForVote();

  const [expanded, setExpanded] = useState(false);

  const partyOf = (id: number): string | null =>
    findMpById(id)?.currentPartyGroupShort ?? sessionParty[String(id)] ?? null;
  const nameOf = (id: number): string =>
    findMpById(id)?.name ?? sessionNames[String(id)] ?? `MP #${id}`;

  // Seed MP's own party — use the same two-step lookup so coalition splits and
  // recycled ids still find a match.
  const seedParty = useMemo(() => {
    if (!entry) return null;
    return partyOf(entry.mpId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, sessionParty]);

  const { crossParty, sameParty } = useMemo(() => {
    const cross: typeof entry extends infer E
      ? E extends { topK: infer T }
        ? T
        : never
      : never = [] as never;
    const same: typeof cross = [] as never;
    if (!entry) return { crossParty: cross, sameParty: same };
    const crossArr: { mpId: number; score: number; overlap: number }[] = [];
    const sameArr: { mpId: number; score: number; overlap: number }[] = [];
    for (const p of entry.topK) {
      const party = partyOf(p.mpId);
      if (!party) continue;
      if (seedParty && party !== seedParty) crossArr.push(p);
      else sameArr.push(p);
    }
    return { crossParty: crossArr, sameParty: sameArr };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, seedParty, sessionParty]);

  // Most-different peers (lowest cosine) — the one bit of signal the old
  // "Сходно гласуващи" browser carried that the twins split didn't. Folded in
  // here so similarity lives in ONE section instead of two near-identical ones.
  const mostDifferent = useMemo(
    () => (entry?.bottomK ?? []).filter((p) => partyOf(p.mpId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry, sessionParty],
  );

  if (simLoading || mpsLoading) {
    return (
      <Card className="my-4" aria-hidden>
        <CardContent>
          <div className="min-h-[80px] sm:min-h-[260px]" />
        </CardContent>
      </Card>
    );
  }
  if (!entry || (crossParty.length === 0 && sameParty.length === 0)) {
    return null;
  }

  const lang = i18n.language;
  // "Twin" is EARNED, not assumed (similarityClass): only frame the section as "voting twins"
  // when at least one peer is a reliable, near-identical match. Otherwise it's "voting
  // similarity", with a caveat showing the actual ceiling so nobody reads a 53% (or a match over
  // a handful of shared votes) as a twin.
  const twins = hasVotingTwins(entry.topK);
  const topScore = Math.max(0, ...entry.topK.map((p) => p.score));
  const visibleCross = expanded
    ? crossParty
    : crossParty.slice(0, PREVIEW_PER_GROUP);
  const visibleSame = expanded
    ? sameParty
    : sameParty.slice(0, PREVIEW_PER_GROUP);
  const visibleDiff = expanded
    ? mostDifferent
    : mostDifferent.slice(0, PREVIEW_PER_GROUP);
  const hiddenCount =
    crossParty.length +
    sameParty.length +
    mostDifferent.length -
    visibleCross.length -
    visibleSame.length -
    visibleDiff.length;

  // "see full ranking" targets the standalone screen keyed by the roster id.
  const rosterMpId = mp?.id ?? entry.mpId;

  const renderRow = (
    p: { mpId: number; score: number; overlap: number },
    isCross: boolean,
  ) => {
    const party = partyOf(p.mpId);
    const peerName = nameOf(p.mpId);
    const color = colorForPartyShort(party) ?? "#94a3b8";
    return (
      <li key={p.mpId}>
        <Link
          to={candidateUrl(p.mpId, peerName)}
          underline={false}
          className="flex items-center gap-3 py-2 hover:bg-muted/40 transition-colors px-2 -mx-2 rounded"
        >
          <MpAvatar mpId={findMpById(p.mpId)?.id ?? p.mpId} name={peerName} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{peerName}</div>
            <div className="text-xs text-muted-foreground flex flex-wrap gap-2 tabular-nums">
              {party && (
                <span style={isCross ? { color } : undefined}>
                  {labelForPartyShort(party) || party}
                </span>
              )}
              <span>
                {t("similarity_overlap") || "Shared items"}: {p.overlap}
              </span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm font-semibold tabular-nums">
              {formatScore(p.score, lang)}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("similarity_score") || "similarity"}
            </div>
          </div>
        </Link>
      </li>
    );
  };

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Sparkles className="h-4 w-4" />
          {twins
            ? t("mp_twins_title") || "Voting twins"
            : t("mp_similarity_title") || "Voting similarity"}
          <span className="text-xs text-muted-foreground font-normal">
            · {entry.topK.length} {t("mp_twins_peers_label") || "peers"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-2">
          {t("mp_twins_intro") ||
            "Other MPs whose voting record most closely matches this one. Those from a different parliamentary group appear first."}
        </p>
        {!twins && (
          <p className="mb-4 text-xs text-amber-700 dark:text-amber-500">
            {t("mp_similarity_weak", { pct: formatScore(topScore, lang) }) ||
              `No strong voting twins — the closest match is ${formatScore(topScore, lang)}.`}
          </p>
        )}

        {crossParty.length > 0 && (
          <section className="mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {t("similarity_cross_party") || "Closest, other groups"}
              <span className="ml-1 font-normal normal-case">
                ({crossParty.length})
              </span>
            </h3>
            <ul className="divide-y">
              {visibleCross.map((p) => renderRow(p, true))}
            </ul>
          </section>
        )}

        {sameParty.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {t("similarity_same_party") || "Within the same group"}
              <span className="ml-1 font-normal normal-case">
                ({sameParty.length})
              </span>
            </h3>
            <ul className="divide-y">
              {visibleSame.map((p) => renderRow(p, false))}
            </ul>
          </section>
        )}

        {mostDifferent.length > 0 && (
          <section className="mt-4 pt-4 border-t">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {t("mp_similarity_opposed") || "Most different"}
              <span className="ml-1 font-normal normal-case">
                ({mostDifferent.length})
              </span>
            </h3>
            <ul className="divide-y">
              {visibleDiff.map((p) =>
                renderRow(p, !!seedParty && partyOf(p.mpId) !== seedParty),
              )}
            </ul>
          </section>
        )}

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-4 text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            {t("mp_twins_show_all") || "See all"} ({hiddenCount})
            <ChevronDown className="h-3 w-3" />
          </button>
        )}
        {expanded && hiddenCount === 0 && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="mt-4 text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            {t("mp_twins_show_less") || "Show fewer"}
            <ChevronUp className="h-3 w-3" />
          </button>
        )}

        <div className="mt-4 pt-3 border-t">
          <Link
            to={`/parliament/similarity/${rosterMpId}`}
            underline={false}
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            {t("mp_similarity_see_full") || "See full ranking"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
};
