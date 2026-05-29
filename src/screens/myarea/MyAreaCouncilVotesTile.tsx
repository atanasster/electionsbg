// "Как гласуваха" — но за общинския съвет. Mirror of
// MyAreaImportantVotesTile (which does the same thing for NS MPs) but for
// the local council. One row per municipal resolution that carries a
// поименно (named-vote) breakdown; each row carries a strip of mini-
// avatars — one per councillor — colored by how they voted.
//
// Visual encoding per avatar:
//   - Ring colour = vote outcome (green за / red против / amber въздържал)
//   - Fill colour = party affiliation (canonical-parties palette, falls
//     back to the vote colour for local-coalition / unmatched councillors)
//   - AvatarImage = parliament photo when the councillor also served in NS
//     (~3% of all councillors today via the candidate-link decoration)
//
// Dissenters first: within each row, avatars are sorted Против → Въздържал →
// За so the politically meaningful minority is left-aligned and visible at a
// glance instead of buried in the long За tail.
//
// Data flow:
//   1. useCouncilMinutes(area.obshtina) returns the slim resolution
//      records (date, title, tally aggregate, sourceUrl).
//   2. useCouncilVotes(area.obshtina) lazy-fetches the per-município
//      votes shard with the perCouncillor[] arrays keyed by resolution id.
//   3. useMunicipalOfficials(rosterShardForObshtina(area.obshtina))
//      gives us photos + slugs + the optional `candidateLink` enrichment
//      (party id, MP id, photo URL) written by
//      scripts/officials/decorate_candidate_links.ts.
//   4. useCanonicalParties().byId resolves the candidate-link's
//      partyCanonicalId to a palette colour.
//
// Auto-hides when council data hasn't been ingested for this município
// yet, when no resolutions in the shard carry перCouncillor data, or
// when the votes shard 404s on the GCS bucket.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Vote, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import { Tooltip } from "@/ux/Tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import { useCouncilMinutes } from "@/data/council/useCouncilMinutes";
import { useCouncilVotes } from "@/data/council/useCouncilVotes";
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

// Matches the MP-tile palette so the small dots read the same across the
// site whether you're looking at a national MP roll-call or a local
// resolution.
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

// Sort key — dissenters first. Против leads, Въздържал next, then За.
const VOTE_PRIORITY: Record<CouncilVoteValue, number> = {
  against: 0,
  abstain: 1,
  for: 2,
};

const PREVIEW_CAP = 5;

// Strip diacritics + lowercase + collapse separators — must match the
// scrape pipeline's normaliseCouncillorName in scripts/council/lib/tally.ts.
// Keep these two in sync; we deliberately don't import from scripts/ since
// that tree is tsx-only and not part of the Vite build.
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

export const MyAreaCouncilVotesTile: FC<Props> = ({ obshtina }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";

  const { resolutions, data, councilKey } = useCouncilMinutes(obshtina);
  const { shard, isLoading } = useCouncilVotes(obshtina);
  const { roster } = useMunicipalOfficials(rosterShardForObshtina(obshtina));
  const { byId: partyById } = useCanonicalParties();

  // Roster lookup: normalised first+last → entry. Mirrors the ingest-side
  // join in scripts/council/lib/roster_join.ts.
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
      // Most-recent declaration wins on tie — sufficient for the ~zero
      // collisions inside one município. Same heuristic as roster_join.ts.
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

  const itemsWithVotes = useMemo(() => {
    if (!shard) return [];
    return resolutions
      .filter((r) => shard.votesById[r.id]?.length)
      .map((r) => {
        // Sort dissenters first so the politically interesting rows lead.
        // Within a vote group keep the stable name order from the source.
        const sortedVotes = [...shard.votesById[r.id]].sort((a, b) => {
          const va = VOTE_PRIORITY[a.vote];
          const vb = VOTE_PRIORITY[b.vote];
          if (va !== vb) return va - vb;
          return 0;
        });
        return { res: r, votes: sortedVotes };
      });
  }, [resolutions, shard]);

  // Auto-hide when there's nothing to show. Wait for either the votes
  // fetch to finish OR the index to confirm zero named-vote rows.
  if (!data) return null;
  if (isLoading) return null;
  if (itemsWithVotes.length === 0) return null;

  const visible = itemsWithVotes.slice(0, PREVIEW_CAP);
  // data.meta is keyed by council key (SOF, VTR01), not frontend code.
  const muniName = (councilKey && data.meta?.[councilKey]?.name) || "";

  // Local helper: resolve party colour + display label for a councillor.
  // candidateLink is written by scripts/officials/decorate_candidate_links.ts;
  // when absent (or when the slate was a local coalition without a canonical
  // id) we fall through to a neutral grey fill so the avatar still reads.
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
      <div className="flex items-center gap-2 mb-1">
        <Vote className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">
          {lang === "bg" ? "Как гласуваха в съвета" : "How the council voted"}
        </h2>
        <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
          {itemsWithVotes.length}{" "}
          {lang === "bg"
            ? itemsWithVotes.length === 1
              ? "гласуване"
              : "гласувания"
            : itemsWithVotes.length === 1
              ? "vote"
              : "votes"}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        {lang === "bg"
          ? `Последни поименни гласувания${muniName ? " — " + muniName : ""}`
          : `Recent named votes${muniName ? " — " + muniName : ""}`}
      </p>

      <div className="flex flex-col gap-2">
        {visible.map(({ res, votes }) => {
          const totalCast =
            (res.tally?.for ?? 0) +
            (res.tally?.against ?? 0) +
            (res.tally?.abstain ?? 0);
          return (
            <div
              key={res.id}
              className="rounded-md border bg-card/40 p-2.5 flex flex-col gap-2"
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                {res.result === "adopted" ? (
                  <span className="inline-block text-[9px] tabular-nums px-1.5 py-0.5 rounded border leading-none bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                    {lang === "bg" ? "Прието" : "Adopted"}
                  </span>
                ) : res.result === "rejected" ? (
                  <span className="inline-block text-[9px] tabular-nums px-1.5 py-0.5 rounded border leading-none bg-rose-500/10 text-rose-700 border-rose-500/30">
                    {lang === "bg" ? "Отхвърлено" : "Rejected"}
                  </span>
                ) : null}
                <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">
                  {formatDate(res.date, lang)}
                  {totalCast > 0
                    ? ` · ${res.tally?.for ?? 0}–${res.tally?.against ?? 0}–${res.tally?.abstain ?? 0}`
                    : ""}
                </span>
              </div>
              {res.sourceUrl ? (
                <a
                  href={res.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium leading-snug hover:underline group flex gap-1 items-start"
                >
                  <span className="line-clamp-2">{res.title}</span>
                  <ChevronRight className="size-3 mt-0.5 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
                </a>
              ) : (
                <div className="text-xs font-medium leading-snug">
                  {res.title}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {votes.map((v) => renderAvatar(res, v))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend pinned at the bottom — explains the ring colour (vote) and
          notes that the fill carries party. */}
      <div className="mt-3 pt-2 border-t flex flex-wrap gap-3 text-[10px] text-muted-foreground">
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
        <span className="text-muted-foreground">
          {lang === "bg"
            ? "· пръстен = вот, цвят на кръга = партия"
            : "· ring = vote, fill = party"}
        </span>
      </div>
    </Card>
  );
};
