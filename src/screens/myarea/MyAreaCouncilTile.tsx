// Unified council tile on /governance/:id — the digest list plus the
// per-councillor named-vote strip.
//
// SERVED FROM POSTGRES (migration 161), not from the bucket. The three fetches
// this replaced were the largest avoidable payload on the governance dashboard,
// and only one of them was gated:
//
//   /council/index.json          1,542 KB   ungated
//   councillor_signals.json         55 KB   ungated
//   /council/votes/<code>.json  446-765 KB  gated on councilKey
//
// Measured per view: Sofia 2,043 KB, Burgas 2,252 KB, a wired município with no
// named votes 1,598 KB. The tile then self-suppressed AFTER the download, so
// all 265 place dashboards paid ~1,598 KB and 249 of them rendered nothing from
// it — the cost fell on the 94% of municipalities the ingest does not cover.
// One scoped call now answers, and an uncovered município gets a small
// not-covered body.
//
// It is also a correctness upgrade. The old tile matched councillors to the
// roster on a first+last name key — a heuristic maintained in two places (the
// comment said so) with no protection against two councillors sharing a name.
// The loader REFUSES a shared name, so the tile was making a claim the corpus
// does not support. Attribution now arrives resolved: `officialSlug` is
// person_role.ref for source='official_muni', which IS the
// data/officials/municipal roster key, so the avatar, party colour and photo
// hang off an identity the resolver stands behind.
//
// Tag chips and AI summaries are GONE, and nothing was lost: 0 of index.json's
// 2,735 rows carried a tag or a summary and 0 of Postgres's 4,727 carry one —
// the Gemini digest pass has never produced output. If it ever does, it lands
// in council_resolution.summary_bg and the row can come back.
//
// THREE STATES, not two. A place is (a) not covered — 249 of 265, (b) covered
// but publishing no named votes — 11 of 16, or (c) covered with named votes —
// 5. The old tile rendered or vanished, which told a reader in Пловдив that
// nothing is known about their council while 151 of its resolutions are indexed.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Vote, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { useUrlExpandedSet } from "@/screens/utils/useUrlExpandedSet";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import { Tooltip } from "@/ux/Tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import {
  useCouncilMuni,
  useCouncilResolution,
  type CouncilResolutionRow,
  type CouncilVoteRow,
} from "@/data/council/useCouncilHub";
import { useMunicipalOfficials } from "@/data/officials/useMunicipalOfficials";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { rosterShardForObshtina } from "@/data/council/councilObshtinaMap";
import type { MunicipalIndexEntry } from "@/data/dataTypes";

type Props = {
  obshtina: string;
};

type VoteValue = CouncilVoteRow["vote"];

// Mirrors the MP-tile palette so green/red/amber read consistently across the
// national and local roll-call surfaces.
const VOTE_COLOR: Record<VoteValue, string> = {
  for: "#10b981",
  against: "#ef4444",
  abstain: "#f59e0b",
};

const VOTE_LABEL: Record<VoteValue, { bg: string; en: string }> = {
  for: { bg: "За", en: "For" },
  against: { bg: "Против", en: "Against" },
  abstain: { bg: "Въздържал се", en: "Abstained" },
};

// Dissenters first — the unanimous-За floor in Bulgarian council practice is
// real, so the interesting avatars must not be buried behind forty greens.
const VOTE_PRIORITY: Record<VoteValue, number> = {
  against: 0,
  abstain: 1,
  for: 2,
};

const PREVIEW_CAP = 5;

const totalCastOf = (r: CouncilResolutionRow): number =>
  (r.tallyFor ?? 0) + (r.tallyAgainst ?? 0) + (r.tallyAbstain ?? 0);

/**
 * (against + abstain) / cast — drives the „Спорни" chip.
 *
 * Folding abstention in is correct HERE and wrong for a person, which is why
 * this survives while the per-councillor "most often dissenting" block does
 * not. This describes a DECISION: a vote a third of the chamber declined to
 * back is contested, whatever the reason. Applied to a named individual the
 * same arithmetic asserts they disagreed, when „въздържал се" is the explicit
 * refusal to take a side — measured corpus-wide that fold was 62-78%
 * abstentions, and on Бургас and Казанлък every councillor it named qualified
 * on abstentions alone. 161 splits the two for the same reason.
 */
const dissentRatio = (r: CouncilResolutionRow): number => {
  const total = totalCastOf(r);
  if (total === 0) return 0;
  return ((r.tallyAgainst ?? 0) + (r.tallyAbstain ?? 0)) / total;
};

const hasTally = (r: CouncilResolutionRow): boolean =>
  r.tallyFor != null || r.tallyAgainst != null || r.tallyAbstain != null;

/**
 * One expanded row's named vote.
 *
 * A child component, not a lookup in the parent, because the votes are fetched
 * per resolution — a hook cannot be called inside the map callback, and pulling
 * every visible row's votes into the list payload would put the bucket-sized
 * download back that this tile exists to remove. Mounting only on expand means
 * the request is made when the reader asks for it and never otherwise.
 */
const CouncilVoteStrip: FC<{
  resolutionId: string;
  lang: "bg" | "en";
  rosterBySlug: Map<string, MunicipalIndexEntry>;
  resolveParty: (e: MunicipalIndexEntry | undefined) => {
    color: string;
    label: string | null;
  };
}> = ({ resolutionId, lang, rosterBySlug, resolveParty }) => {
  const { data, isLoading } = useCouncilResolution(resolutionId);

  const sorted = useMemo(() => {
    const votes = data?.votes ?? [];
    return [...votes].sort(
      (a, b) => VOTE_PRIORITY[a.vote] - VOTE_PRIORITY[b.vote],
    );
  }, [data]);

  if (isLoading) {
    return (
      <div className="pt-1 text-[10px] text-muted-foreground italic">
        {lang === "bg" ? "Зареждане…" : "Loading…"}
      </div>
    );
  }
  if (sorted.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {sorted.map((v) => {
        const voteColor = VOTE_COLOR[v.vote];
        const voteLabel = VOTE_LABEL[v.vote][lang];
        // Identity comes RESOLVED from the payload — no name matching here.
        const match = v.officialSlug
          ? rosterBySlug.get(v.officialSlug)
          : undefined;
        const displayName = match?.name ?? v.name;
        const party = resolveParty(match);
        const photoUrl = match?.candidateLink?.photoUrl;
        const aria = `${displayName} — ${voteLabel}`;
        // /person when the resolver gave us a servable page; /officials
        // otherwise. Never a link built from an id.
        const href = v.personSlug
          ? `/person/${v.personSlug}`
          : v.officialSlug
            ? `/officials/${v.officialSlug}`
            : null;

        const avatar = (
          <Avatar
            className="size-7 ring-[3px]"
            style={{
              ["--tw-ring-color" as string]: voteColor,
              backgroundColor: party.color,
            }}
          >
            {photoUrl ? (
              <AvatarImage src={photoUrl} alt="" />
            ) : (
              <AvatarFallback
                className="text-[9px] text-white"
                style={{ backgroundColor: party.color }}
              >
                {initials(displayName)}
              </AvatarFallback>
            )}
          </Avatar>
        );

        const tip = (
          <span>
            {displayName} — {voteLabel}
            {party.label ? ` · ${party.label}` : ""}
          </span>
        );

        return (
          <Tooltip key={`${v.name}-${v.vote}`} content={tip}>
            {href ? (
              <Link to={href} aria-label={aria}>
                {avatar}
              </Link>
            ) : (
              <span aria-label={aria}>{avatar}</span>
            )}
          </Tooltip>
        );
      })}
    </div>
  );
};

export const MyAreaCouncilTile: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";

  // ONE call, and it takes the FRONTEND code — /governance/:id is keyed on it,
  // and council_muni_code resolves it server-side so the client never carries a
  // copy of the two-code-space mapping.
  const { data, isLoading } = useCouncilMuni(obshtina);
  const rosterShard = rosterShardForObshtina(obshtina);
  const { roster } = useMunicipalOfficials(rosterShard);
  const { byId: partyById } = useCanonicalParties();

  const [contestedOnly, setContestedOnly] = useState(false);
  const { isExpanded, toggle: toggleExpand } =
    useUrlExpandedSet("expandedCouncil");

  // Keyed on the OFFICIALS SLUG the payload hands us, not on a name. This is
  // the whole point of the migration: no first+last heuristic, and no chance of
  // attributing a vote to the wrong person because two councillors share a name.
  const rosterBySlug = useMemo(() => {
    const map = new Map<string, MunicipalIndexEntry>();
    for (const e of roster?.entries ?? []) {
      if (e.slug) map.set(e.slug, e);
    }
    return map;
  }, [roster]);

  // Memoised: `data?.resolutions ?? []` mints a fresh array every render, so
  // the three useMemos below would recompute on each one and their memoisation
  // would be decorative.
  const resolutions = useMemo(() => data?.resolutions ?? [], [data]);

  // Councils publish the per-resolution PDF as the session wraps, but the full
  // protokol carrying the tally lands days-to-weeks later. Prefer tallied rows
  // for the visible cap so a reader during the gap does not see only untallied
  // ones — and say how many are held back, or the tile looks broken to someone
  // who knows what just happened in the chamber. Falls back to the full list
  // for councils that publish no tally-bearing protokol at all (Пловдив, Варна),
  // where there is no "pending" to wait for.
  const hasAnyTallied = useMemo(
    () => resolutions.some(hasTally),
    [resolutions],
  );
  const filtered = useMemo(() => {
    const base = hasAnyTallied ? resolutions.filter(hasTally) : resolutions;
    return contestedOnly ? base.filter((r) => dissentRatio(r) >= 0.1) : base;
  }, [resolutions, hasAnyTallied, contestedOnly]);

  const pendingTallyCount = useMemo(
    () => (hasAnyTallied ? resolutions.filter((r) => !hasTally(r)).length : 0),
    [resolutions, hasAnyTallied],
  );

  // All hooks are above this gate — keep new ones above it too.
  if (isLoading) return null;

  // (a) Not covered — 249 of 265 municipalities. The tile stays hidden rather
  // than printing "we have nothing", which would be noise on 94% of dashboards.
  if (!data) return null;

  // (b) Covered but no resolutions yet — a wired município whose ingest has not
  // landed. Distinct from (a), and from "covered, no NAMED votes" below.
  if (resolutions.length === 0) return null;

  const visible = filtered.slice(0, PREVIEW_CAP);

  const resolveParty = (
    entry: MunicipalIndexEntry | undefined,
  ): { color: string; label: string | null } => {
    const link = entry?.candidateLink;
    if (!link) return { color: "#9ca3af", label: null };
    const canonical = link.partyCanonicalId
      ? partyById.get(link.partyCanonicalId)
      : null;
    return {
      color: canonical?.color ?? "#9ca3af",
      label: canonical?.displayName ?? link.partyName ?? null,
    };
  };

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-2">
        <Vote className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">
          <Link to={`/council/${obshtina}`} className="hover:underline">
            <span lang="bg">{data.name}</span>
          </Link>
        </h3>
        {data.hasNamedVotes ? (
          <button
            type="button"
            onClick={() => setContestedOnly((v) => !v)}
            aria-pressed={contestedOnly}
            className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border leading-none transition-colors ${
              contestedOnly
                ? "bg-amber-500/15 text-amber-700 border-amber-500/40"
                : "text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            {lang === "bg" ? "Спорни" : "Contested"}
          </button>
        ) : null}
      </div>

      {/* (c) vs (b) — said in words. A council that publishes only an aggregate
          is not a council we know nothing about. */}
      {/* Two different absences, and saying the wrong one is a claim the
          corpus contradicts on the same screen. Пловдив, Варна and Сливен
          publish NO tally at all — 470 resolutions, 100% of each — so telling
          their readers the council "publishes only a total" is false. */}
      {!data.hasNamedVotes ? (
        <p className="mb-2 text-[11px] text-muted-foreground leading-snug">
          {hasAnyTallied
            ? t("council_tile_aggregate_only")
            : t("council_tile_no_tally")}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {visible.map((r) => {
          const cast = totalCastOf(r);
          const expanded = isExpanded(r.id);
          return (
            <li
              key={r.id}
              className="rounded-md border bg-card/40 p-2.5 flex flex-col gap-2"
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                {r.result === "adopted" ? (
                  <span className="inline-block text-[9px] tabular-nums px-1.5 py-0.5 rounded border leading-none bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                    {lang === "bg" ? "Прието" : "Adopted"}
                  </span>
                ) : r.result === "rejected" ? (
                  <span className="inline-block text-[9px] tabular-nums px-1.5 py-0.5 rounded border leading-none bg-rose-500/10 text-rose-700 border-rose-500/30">
                    {lang === "bg" ? "Отхвърлено" : "Rejected"}
                  </span>
                ) : null}
                {r.hasNamedVotes ? (
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.id)}
                    aria-expanded={expanded}
                    className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {lang === "bg" ? "Как гласуваха" : "How they voted"}
                    {expanded ? (
                      <ChevronUp className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                  </button>
                ) : null}
              </div>

              <div className="text-[10px] text-muted-foreground tabular-nums">
                {r.decidedOn}
                {cast > 0
                  ? ` · ${r.tallyFor ?? 0}-${r.tallyAgainst ?? 0}-${r.tallyAbstain ?? 0}`
                  : ""}
              </div>

              {/* The title links to OUR page for the decision, not out to the
                  PDF — that page is the only inbound route to the
                  function-served /council/resolution family. The source PDF is
                  one click further on, from there. */}
              <Link
                to={`/council/resolution/${r.id}`}
                className="group flex items-start gap-1 text-xs font-medium leading-snug hover:underline"
              >
                <span className="line-clamp-2" lang="bg">
                  {r.title}
                </span>
                <ChevronRight className="size-3 mt-0.5 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
              </Link>

              {r.hasNamedVotes && expanded ? (
                <CouncilVoteStrip
                  resolutionId={r.id}
                  lang={lang}
                  rosterBySlug={rosterBySlug}
                  resolveParty={resolveParty}
                />
              ) : null}
            </li>
          );
        })}
        {visible.length === 0 && contestedOnly ? (
          <li className="text-[11px] text-muted-foreground italic px-1 py-2">
            {lang === "bg"
              ? "Няма спорни решения в скорошните гласувания."
              : "No contested decisions among the recent votes."}
          </li>
        ) : null}
      </ul>

      {pendingTallyCount > 0 ? (
        <p className="mt-2 text-[10px] text-muted-foreground italic leading-snug">
          {lang === "bg"
            ? `${pendingTallyCount} по-нови решения чакат публикуване на протокола за гласовете.`
            : `${pendingTallyCount} more recent decisions are awaiting protocol publication for vote tallies.`}
        </p>
      ) : null}

      {data.hasNamedVotes ? (
        <div className="mt-3 pt-2 border-t flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {(["against", "abstain", "for"] as VoteValue[]).map((v) => (
              <span key={v} className="inline-flex items-center gap-1 mr-2">
                <span
                  className="inline-block h-3 w-3 rounded-full ring-[3px] ring-offset-0 bg-muted"
                  style={{ ["--tw-ring-color" as string]: VOTE_COLOR[v] }}
                />
                {VOTE_LABEL[v][lang]}
              </span>
            ))}
          </span>
          <span>
            {lang === "bg"
              ? "пръстен = вот, цвят = партия"
              : "ring = vote, fill = party"}
          </span>
          {/* The i18n wording, NOT data.attendanceBasis — that field is
              Bulgarian-only and rendering it verbatim put a Bulgarian sentence
              on /en, which is the regression CouncilScreen already fixed and
              commented. It stays in the payload as the contract for non-UI
              consumers. The rule it states still holds: the minutes list only
              who voted, so any participation figure is a share of named-vote
              decisions and never an attendance rate. */}
          <span className="italic ml-auto">
            {t("council_basis_attendance")}
          </span>
        </div>
      ) : null}
      <span className="sr-only">{t("my_area_council_ai_disclaimer")}</span>
    </Card>
  );
};
