// Unified council tile — absorbs the former MyAreaCouncilMinutesTile
// (digest list + tag chips + AI summary) and MyAreaCouncilVotesTile
// (per-councillor named-vote avatar strip) into one surface, since both
// drew from the same resolution set and showing them side-by-side caused
// users to scan the same decisions twice.
//
// Structure per row, top-down:
//   - Outcome chip (Прието / Отхвърлено) + tag chips (financial /
//     personnel / urban_planning / procurement / social — when the
//     Phase-4 Gemini digest has tagged this record)
//   - Date · tally totals (X-Y-Z when present)
//   - Title (linked to the source PDF / HTML when available)
//   - Optional 2-sentence AI summary (when the digest pass has run)
//   - Optional "Виж как гласуваха ⌄" expand control — appears only when
//     a per-councillor breakdown exists for this resolution. Expanded,
//     it renders the avatar strip (dissenters first, ring = vote, fill =
//     party, photo when councillor also served in NS).
//
// Top of the tile carries a "Спорни" chip — when toggled on, the list
// filters to only resolutions where dissent + abstain > 10% of cast
// votes. The unanimous-За floor in Bulgarian council reality is real,
// but politically the interesting rows are the contested ones — this
// makes them findable in one click without scrolling.
//
// Auto-hides when the município has no council data ingested yet.

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
  useCouncilMinutes,
  type CouncilTag,
  type CouncilResolution,
} from "@/data/council/useCouncilMinutes";
import { useCouncilVotes } from "@/data/council/useCouncilVotes";
import { useCouncillorSignals } from "@/data/council/useCouncillorSignals";
import { useMunicipalOfficials } from "@/data/officials/useMunicipalOfficials";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { rosterShardForObshtina } from "@/data/council/councilObshtinaMap";
import type { MunicipalIndexEntry } from "@/data/dataTypes";
import type {
  CouncilVoteValue,
  CouncilVoteRow,
} from "@/data/council/useCouncilVotes";

type Props = {
  obshtina: string;
};

// Mirrors the MP-tile palette so green/red/amber dots read consistently
// across the national + local roll-call surfaces.
const VOTE_COLOR: Record<CouncilVoteValue, string> = {
  for: "#10b981",
  against: "#ef4444",
  abstain: "#f59e0b",
};

const VOTE_LABEL: Record<CouncilVoteValue, { bg: string; en: string }> = {
  for: { bg: "За", en: "For" },
  against: { bg: "Против", en: "Against" },
  abstain: { bg: "Въздържал се", en: "Abstain" },
};

// Dissenters first — Против → Въздържал → За — so the few politically
// meaningful votes sit at the front of the strip.
const VOTE_PRIORITY: Record<CouncilVoteValue, number> = {
  against: 0,
  abstain: 1,
  for: 2,
};

const TAG_COLOR: Record<CouncilTag, string> = {
  financial: "#E0A22C",
  personnel: "#C97AAA",
  urban_planning: "#5E8AC7",
  procurement: "#A6792F",
  social: "#56A86F",
  other: "#888",
};

const PREVIEW_CAP = 5;
const CONTESTED_RATIO = 0.1; // ≥ 10% dissent counts as contested

// Strip diacritics + lowercase + collapse separators — matches the
// scrape pipeline's normaliseCouncillorName. Keep in sync with
// scripts/council/lib/tally.ts.
const normaliseName = (raw: string): string =>
  raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-\s]+/g, " ")
    .trim();

const firstLastKey = (fullName: string): string => {
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return normaliseName(fullName);
  return normaliseName(`${parts[0]} ${parts[parts.length - 1]}`);
};

const formatDate = (iso: string, lang: "bg" | "en"): string => {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
};

// Dissent ratio for a resolution — (against + abstain) / total cast.
// Used by the "Спорни" filter chip.
const dissentRatio = (r: CouncilResolution): number => {
  const t = r.tally;
  if (!t) return 0;
  const total = (t.for ?? 0) + (t.against ?? 0) + (t.abstain ?? 0);
  if (total === 0) return 0;
  return ((t.against ?? 0) + (t.abstain ?? 0)) / total;
};

export const MyAreaCouncilTile: FC<Props> = ({ obshtina }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";

  const { resolutions, data, councilKey } = useCouncilMinutes(obshtina);
  const { shard } = useCouncilVotes(obshtina);
  const rosterShard = rosterShardForObshtina(obshtina);
  const { roster } = useMunicipalOfficials(rosterShard);
  const { byId: partyById } = useCanonicalParties();

  const [contestedOnly, setContestedOnly] = useState(false);
  const { isExpanded, toggle: toggleExpand } =
    useUrlExpandedSet("expandedCouncil");

  // First+last → roster entry; identical heuristic to the per-município
  // join in scripts/council/lib/roster_join.ts so the matched-rate matches
  // what the ingest log reports.
  const rosterByKey = useMemo(() => {
    const map = new Map<string, MunicipalIndexEntry>();
    if (!roster?.entries) return map;
    for (const e of roster.entries) {
      if (
        e.role !== "councillor" &&
        e.role !== "council_chair" &&
        e.role !== "deputy_mayor" &&
        e.role !== "mayor"
      )
        continue;
      const key = firstLastKey(e.name);
      const existing = map.get(key);
      if (
        !existing ||
        (e.latestDeclarationYear ?? 0) > (existing.latestDeclarationYear ?? 0)
      ) {
        map.set(key, e);
      }
    }
    return map;
  }, [roster]);

  const councillorSlugs = useMemo(
    () =>
      Array.from(
        new Set(
          Array.from(rosterByKey.values())
            .map((e) => e.slug)
            .filter(Boolean),
        ),
      ),
    [rosterByKey],
  );
  const signalsBySlug = useCouncillorSignals(rosterShard, councillorSlugs);

  // Most councils publish the per-resolution PDF as soon as the session
  // wraps but the full session protokol (the source for vote tallies via
  // the OCR pass) lands days-to-weeks later. With PREVIEW_CAP = 5 and a
  // 2-week lag, users who got to the dashboard during the gap window would
  // see only untallied rows — and by the time tallies arrived, fresh
  // untallied rows would have replaced them on top. So we de-rank rows
  // without a tally: prefer the freshest tallied rows for the visible
  // cap, and surface a small "N awaiting protocol" hint footer when we
  // are hiding any. Falls back to the full list when the município has
  // zero tallied rows at all (PDV/VAR don't publish tally-bearing
  // protokoli — there's no "pending" to wait for).
  const hasAnyTallied = useMemo(
    () => resolutions.some((r) => r.tally != null),
    [resolutions],
  );
  const filtered = useMemo(() => {
    const base = hasAnyTallied
      ? resolutions.filter((r) => r.tally != null)
      : resolutions;
    if (!contestedOnly) return base;
    return base.filter((r) => dissentRatio(r) >= CONTESTED_RATIO);
  }, [resolutions, contestedOnly, hasAnyTallied]);
  // Count of fresh untallied rows we're hiding behind the tally filter —
  // shown as a "N awaiting protocol" footer note. Only counts rows newer
  // than the most recent tallied row, so older one-off gaps don't trigger
  // a misleading "pending" indicator.
  const pendingTallyCount = useMemo(() => {
    if (!hasAnyTallied) return 0;
    const latestTalliedDate = resolutions
      .filter((r) => r.tally != null)
      .reduce((acc, r) => (r.date > acc ? r.date : acc), "");
    return resolutions.filter(
      (r) => r.tally == null && r.date > latestTalliedDate,
    ).length;
  }, [resolutions, hasAnyTallied]);
  const contestedCount = useMemo(
    () =>
      (hasAnyTallied
        ? resolutions.filter((r) => r.tally != null)
        : resolutions
      ).filter((r) => dissentRatio(r) >= CONTESTED_RATIO).length,
    [resolutions, hasAnyTallied],
  );

  // Standouts — top 3 by party-dissent + bottom 3 by attendance.
  // Picks one name per (entry, metric) — the same councillor can show up
  // on both lists if they're a low-attendance habitual dissenter.
  // Independents / local-coalition councillors without a partyCanonicalId
  // are excluded from the dissent leaderboard (no party reference frame).
  // Avatars / parties come from the existing rosterByKey + candidateLink
  // decoration so no extra fetch is needed.
  const standouts = useMemo(() => {
    const all = Array.from(rosterByKey.values())
      .map((entry) => {
        const sig = signalsBySlug.get(entry.slug);
        if (!sig || sig.votesCast === 0) return null;
        return {
          entry,
          attendance: sig.attendance?.attendance ?? 0,
          dissent: sig.dissent?.pctValue ?? null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    // Lowest attendance (need ≥ 5 votes cast to be a meaningful sample so
    // a one-vote no-shower doesn't dominate the leaderboard).
    const byAttendance = all
      .filter((x) => (signalsBySlug.get(x.entry.slug)?.votesCast ?? 0) >= 5)
      .sort((a, b) => a.attendance - b.attendance)
      .slice(0, 3);
    // Highest party-dissent — drop nulls + only show entries above the
    // useCouncillorSignals badge threshold (10%) so the chip isn't shown
    // for a 1% deviation that's plausibly noise.
    const byDissent = all
      .filter((x) => x.dissent != null && x.dissent >= 0.1)
      .sort((a, b) => (b.dissent ?? 0) - (a.dissent ?? 0))
      .slice(0, 3);
    return { byAttendance, byDissent };
  }, [rosterByKey, signalsBySlug]);

  // Auto-hide when there's nothing for the município yet. All hooks above
  // this gate are unconditional — keep new hooks above too.
  if (!data || resolutions.length === 0) return null;

  const visible = filtered.slice(0, PREVIEW_CAP);
  const muniName = (councilKey && data.meta?.[councilKey]?.name) || "";

  // Per-row party resolver — uses candidateLink decoration when available,
  // falls back to neutral grey for local coalitions without a canonical id.
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

  const renderAvatar = (
    res: { id: string },
    v: CouncilVoteRow,
  ): React.ReactNode => {
    const voteColor = VOTE_COLOR[v.vote];
    const voteLabel = VOTE_LABEL[v.vote][lang];
    const match = rosterByKey.get(firstLastKey(v.name));
    const displayName = match?.name ?? v.name;
    const slug = match?.slug;
    const profileUrl = slug ? `/officials/${slug}` : null;
    const aria = `${displayName} — ${voteLabel}`;
    const party = resolveParty(match);
    const photoUrl = match?.candidateLink?.photoUrl;
    const signals = slug ? signalsBySlug.get(slug) : undefined;
    const attendanceLabel = signals?.attendance
      ? lang === "bg"
        ? signals.attendance.label_bg
        : signals.attendance.label_en
      : null;
    const dissentLabel = signals?.dissent
      ? lang === "bg"
        ? signals.dissent.label_bg
        : signals.dissent.label_en
      : null;

    const avatar = (
      <Avatar
        className="h-7 w-7 shrink-0 ring-[3px] ring-offset-1 ring-offset-card hover:scale-110 transition-transform"
        style={{ ["--tw-ring-color" as string]: voteColor }}
      >
        {photoUrl ? (
          <AvatarImage
            src={photoUrl}
            alt={displayName}
            className="object-cover"
          />
        ) : null}
        <AvatarFallback
          className="text-[9px] font-bold text-white"
          style={{ backgroundColor: party.color }}
        >
          {initials(displayName)}
        </AvatarFallback>
      </Avatar>
    );

    return (
      <Tooltip
        key={`${res.id}-${v.normKey}-${v.name}`}
        content={
          <div className="flex flex-col gap-1.5">
            <div className="font-semibold leading-tight">{displayName}</div>
            {party.label ? (
              <div>
                <span
                  className="inline-block text-[10px] font-medium rounded px-1.5 py-0.5 text-white leading-none"
                  style={{ backgroundColor: party.color }}
                >
                  {party.label}
                </span>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: voteColor }}
              />
              <span
                className="text-xs font-medium"
                style={{ color: voteColor }}
              >
                {voteLabel}
              </span>
            </div>
            {attendanceLabel || dissentLabel ? (
              <div className="text-[10px] text-muted-foreground mt-0.5">
                <span
                  className={signals?.attendance?.severe ? "text-rose-600" : ""}
                >
                  {attendanceLabel}
                </span>
                {attendanceLabel && dissentLabel ? " · " : ""}
                <span className={dissentLabel ? "text-amber-600" : ""}>
                  {dissentLabel}
                </span>
              </div>
            ) : null}
            {profileUrl ? (
              <div className="text-[10px] text-muted-foreground mt-1 italic">
                {lang === "bg" ? "Натиснете за профил" : "Click for profile"}
              </div>
            ) : null}
          </div>
        }
      >
        {profileUrl ? (
          <Link
            to={profileUrl}
            underline={false}
            aria-label={aria}
            className="block"
          >
            {avatar}
          </Link>
        ) : (
          <div aria-label={aria}>{avatar}</div>
        )}
      </Tooltip>
    );
  };

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Vote className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">
          {lang === "bg" ? "Общински съвет" : "Municipal council"}
        </h2>
        <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
          {resolutions.length}{" "}
          {lang === "bg"
            ? resolutions.length === 1
              ? "решение"
              : "решения"
            : resolutions.length === 1
              ? "decision"
              : "decisions"}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-2">
        {lang === "bg"
          ? `Последни решения${muniName ? " — " + muniName : ""}`
          : `Recent decisions${muniName ? " — " + muniName : ""}`}
      </p>

      {/* Standouts strip — top 3 dissenters + bottom 3 attendance. Auto-
          hides when no councillor signals are available (e.g. before the
          per-município ingest has run any named votes). */}
      {standouts.byAttendance.length > 0 || standouts.byDissent.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 mb-3 text-[11px]">
          {standouts.byDissent.length > 0 ? (
            <div className="rounded-md border bg-amber-500/5 p-2">
              <div className="text-[10px] uppercase tracking-wide text-amber-700/80 mb-1">
                {lang === "bg"
                  ? "Гласуват против партията"
                  : "Vote against party"}
              </div>
              <div className="flex flex-col gap-1">
                {standouts.byDissent.map((s) => {
                  const link = s.entry.candidateLink;
                  const party = link?.partyCanonicalId
                    ? partyById.get(link.partyCanonicalId)
                    : null;
                  const pct = Math.round((s.dissent ?? 0) * 100);
                  return (
                    <Link
                      key={s.entry.slug}
                      to={`/officials/${s.entry.slug}`}
                      underline={false}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <Avatar className="h-5 w-5 shrink-0">
                        {link?.photoUrl ? (
                          <AvatarImage
                            src={link.photoUrl}
                            alt={s.entry.name}
                            className="object-cover"
                          />
                        ) : null}
                        <AvatarFallback
                          className="text-[8px] font-bold text-white"
                          style={{ backgroundColor: party?.color ?? "#9ca3af" }}
                        >
                          {initials(s.entry.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate flex-1">{s.entry.name}</span>
                      <span className="tabular-nums text-amber-700 font-medium">
                        {pct}%
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}
          {standouts.byAttendance.length > 0 ? (
            <div className="rounded-md border bg-rose-500/5 p-2">
              <div className="text-[10px] uppercase tracking-wide text-rose-700/80 mb-1">
                {lang === "bg" ? "Най-ниска посещаемост" : "Lowest attendance"}
              </div>
              <div className="flex flex-col gap-1">
                {standouts.byAttendance.map((s) => {
                  const link = s.entry.candidateLink;
                  const party = link?.partyCanonicalId
                    ? partyById.get(link.partyCanonicalId)
                    : null;
                  const pct = Math.round(s.attendance * 100);
                  return (
                    <Link
                      key={s.entry.slug}
                      to={`/officials/${s.entry.slug}`}
                      underline={false}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <Avatar className="h-5 w-5 shrink-0">
                        {link?.photoUrl ? (
                          <AvatarImage
                            src={link.photoUrl}
                            alt={s.entry.name}
                            className="object-cover"
                          />
                        ) : null}
                        <AvatarFallback
                          className="text-[8px] font-bold text-white"
                          style={{ backgroundColor: party?.color ?? "#9ca3af" }}
                        >
                          {initials(s.entry.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate flex-1">{s.entry.name}</span>
                      <span className="tabular-nums text-rose-700 font-medium">
                        {pct}%
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Filter strip — single "Спорни" chip toggles the contested view */}
      {contestedCount > 0 ? (
        <div className="flex items-center gap-1.5 mb-3">
          <button
            type="button"
            onClick={() => setContestedOnly((v) => !v)}
            className={`text-[10px] px-2 py-0.5 rounded-full border tabular-nums ${
              contestedOnly
                ? "bg-amber-500/15 text-amber-700 border-amber-500/40"
                : "bg-muted/40 text-muted-foreground border-border hover:bg-amber-500/10"
            }`}
          >
            {lang === "bg" ? "Спорни" : "Contested"} · {contestedCount}
          </button>
          {contestedOnly ? (
            <button
              type="button"
              onClick={() => setContestedOnly(false)}
              className="text-[10px] text-muted-foreground hover:underline"
            >
              {lang === "bg" ? "(покажи всички)" : "(show all)"}
            </button>
          ) : null}
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {visible.map((r) => {
          const totalCast =
            (r.tally?.for ?? 0) +
            (r.tally?.against ?? 0) +
            (r.tally?.abstain ?? 0);
          const summary = lang === "bg" ? r.summary_bg : r.summary_en;
          const tags = r.tags ?? [];
          const votes = shard?.votesById[r.id];
          const hasVotes = !!votes && votes.length > 0;
          // Inline sort (cheap; runs only for expanded rows) — can't useMemo
          // inside the map callback without violating the rules of hooks.
          const sortedVotes = votes
            ? [...votes].sort((a, b) => {
                const va = VOTE_PRIORITY[a.vote];
                const vb = VOTE_PRIORITY[b.vote];
                if (va !== vb) return va - vb;
                return 0;
              })
            : [];
          const expanded = isExpanded(r.id);
          return (
            <li
              key={r.id}
              className="rounded-md border bg-card/40 p-2.5 flex flex-col gap-2"
            >
              {/* Top row — outcome chip + topic chips + date · tally */}
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
                {tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="inline-block text-[9px] px-1.5 py-0.5 rounded leading-none"
                    style={{
                      backgroundColor: `${TAG_COLOR[tag] ?? "#888"}22`,
                      color: TAG_COLOR[tag] ?? "#888",
                    }}
                  >
                    {data.tags[tag]?.[lang] ?? tag}
                  </span>
                ))}
                {hasVotes ? (
                  <button
                    type="button"
                    onClick={() => toggleExpand(r.id)}
                    aria-expanded={expanded}
                    aria-label={
                      lang === "bg"
                        ? expanded
                          ? "Скрий как гласуваха"
                          : "Виж как гласуваха"
                        : expanded
                          ? "Hide how they voted"
                          : "Show how they voted"
                    }
                    className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums hover:text-foreground transition-colors"
                  >
                    <span>
                      {formatDate(r.date, lang)}
                      {totalCast > 0
                        ? ` · ${r.tally?.for ?? 0}–${r.tally?.against ?? 0}–${r.tally?.abstain ?? 0}`
                        : ""}
                    </span>
                    {expanded ? (
                      <ChevronUp className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                  </button>
                ) : (
                  <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                    {formatDate(r.date, lang)}
                    {totalCast > 0
                      ? ` · ${r.tally?.for ?? 0}–${r.tally?.against ?? 0}–${r.tally?.abstain ?? 0}`
                      : ""}
                  </span>
                )}
              </div>

              {/* Title */}
              {r.sourceUrl ? (
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium leading-snug hover:underline group flex gap-1 items-start"
                >
                  <span className="line-clamp-2">{r.title}</span>
                  <ChevronRight className="size-3 mt-0.5 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
                </a>
              ) : (
                <div className="text-xs font-medium leading-snug">
                  {r.title}
                </div>
              )}

              {/* AI summary when present */}
              {summary ? (
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {summary}
                </p>
              ) : null}

              {/* Expanded per-councillor strip — toggled from the tally
                  chip in the top-right of the row. Only renders when the
                  shard carries a named-vote breakdown for this resolution. */}
              {hasVotes && expanded ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {sortedVotes.map((v) => renderAvatar(r, v))}
                </div>
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

      {/* "N awaiting protocol" footer note — councils typically publish
          per-resolution PDFs immediately after a session but the full
          protokol with the vote tally lands days-to-weeks later. Without
          this hint the tile silently de-ranks the freshest decisions and
          a user familiar with what just happened in the chamber would
          assume the data is broken. */}
      {pendingTallyCount > 0 ? (
        <p className="mt-2 text-[10px] text-muted-foreground italic leading-snug">
          {lang === "bg"
            ? `${pendingTallyCount} по-нови решения чакат публикуване на протокола за гласовете.`
            : `${pendingTallyCount} more recent decisions are awaiting protocol publication for vote tallies.`}
        </p>
      ) : null}

      {/* Bottom strip: legend + AI disclaimer */}
      <div className="mt-3 pt-2 border-t flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {(["against", "abstain", "for"] as CouncilVoteValue[]).map((v) => (
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
        <span className="italic ml-auto">
          {t("my_area_council_ai_disclaimer")}
        </span>
      </div>
    </Card>
  );
};
