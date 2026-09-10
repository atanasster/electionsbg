// T4.6 — the AI chat's presidential-polls arm. Decision 10's presidential file
// family (`data/polls/presidential/*.json`) is a SEPARATE corpus from the
// parliamentary one `pollsDepth.ts` reads — sharing a `Poll`/`PollLock` type
// and the `agencies.json` registry, but never the same numbers — so this is a
// sibling file, not an added branch there
// (`scripts/polls/consumer_race_isolation.test.ts` holds the two apart).
//
// ⚠ NEVER SURFACES A PLACEHOLDER-ONLY POLL AS "THE LATEST POLLS SHOW". A row
// published before a party has nominated anyone ("Кандидат на <party>",
// decision 12) names no person — presenting it as an answer to "what do the
// polls show" would be a claim about nobody, which is the exact worry the
// plan's own §11 item 7 raised about shipping this tool at all. The fix here
// is structural rather than a ship/wait policy call: the tool only ever
// answers for a poll that ALSO carries at least one named (real or
// provisional) candidate row, which the corpus already provides today (GM's
// July 2026 capture, decision 18) — so the placeholder-only case degrades to
// an honest "not yet" rather than ever needing to be guessed at.
//
// ⚠ ONLY "LATEST", NO ACCURACY/TREND ARM — the presidential corpus has no
// scored/accepted cycle yet (every real poll carries `cycle: null` until
// Tier 4b's historical backfill or a live cycle's results land), so an
// `agencyProfile`/`accuracyTrend` sibling would have nothing real to show.
// Same scope cut `PresidentialPollsTile.tsx`'s own header states for the
// client-side `AccuracyTrendsTile` equivalent — building it now would be UI
// (here, a tool) for data that does not exist yet.

import { fetchData } from "./dataClient";
import { round2 } from "./dataset";
import { fmtInt, fmtPct } from "./format";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// Same rule as `pollsDepth.ts`'s own `pollDate` — a poll id is
// `<agency>-<ISO date>` in both corpora (`src/data/polls/fieldwork.ts`'s
// `pollId` contract) — kept as a second copy rather than a shared import
// because every file in this directory carries its own narrow local types
// rather than depending on a sibling tool file.
const pollDate = (id: string): string => {
  const m = id.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
};

type Poll = {
  id: string;
  agencyId: string;
  fieldwork?: string;
  respondents?: number | null;
};
type PresidentialPollDetail = {
  pollId: string;
  candidateKey: string;
  candidateName_bg: string;
  candidateName_en: string;
  placeholderFor: string | null;
  support: number;
};
type Agency = { id: string; name_bg: string; name_en: string };

/** A row is a real, nameable candidate — never "none" (Не подкрепям никого) or
 *  a `placeholder:<party>` row minted before a party has nominated anyone.
 *  Same predicate as `src/data/polls/presidentialRow.ts`'s `isNamedCandidateRow`,
 *  duplicated rather than imported for the reason `pollDate` above states. */
const isNamedCandidateRow = (d: PresidentialPollDetail): boolean =>
  d.candidateKey !== "none" && d.placeholderFor === null;

// A candidate's own name is never translated by UI language — matches the
// reference UI (`PresidentialPollsSection.tsx`, `AgencyPresidentialPollsList.tsx`),
// which always renders `candidateName_bg` regardless of `ctx.lang`.
// `candidateName_en` is `""` for every row in today's corpus (the extractor
// leaves it blank by design, `global_metrics.ts`) and is only ever backfilled
// into the *derived* `candidates.json` projection once a cycle exists —
// never into `polls_details.json` itself.
const candidateLabel = (d: PresidentialPollDetail): string =>
  d.candidateName_bg;

export const latestPresidentialPoll = async (
  _args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const [polls, details, agencies] = await Promise.all([
    fetchData<Poll[]>("/polls/presidential/polls.json"),
    fetchData<PresidentialPollDetail[]>(
      "/polls/presidential/polls_details.json",
    ),
    fetchData<Agency[]>("/polls/agencies.json"),
  ]);
  const provenance = [
    "polls/presidential/polls.json",
    "polls/presidential/polls_details.json",
  ];
  const sorted = [...polls].sort((a, b) =>
    pollDate(b.id).localeCompare(pollDate(a.id)),
  );

  // The latest poll that ALSO names at least one real candidate — never the
  // bare latest, which may be placeholder-only. Skipping past a
  // placeholder-only capture to an older named one would misreport its own
  // recency, so this degrades to "not yet" rather than reaching backward.
  const latest = sorted[0];
  const rows = latest
    ? details
        .filter((d) => d.pollId === latest.id)
        .sort((a, b) => b.support - a.support)
    : [];
  const hasNamedCandidate = rows.some(isNamedCandidateRow);

  if (!latest || !hasNamedCandidate) {
    return {
      tool: "latestPresidentialPoll",
      domain: "elections",
      kind: "scalar",
      title:
        ctx.lang === "bg"
          ? "Няма президентско проучване с посочени кандидати"
          : "No presidential poll names specific candidates yet",
      viz: "none",
      facts: {},
      provenance,
    };
  }

  const ag = agencies.find((a) => a.id === latest.agencyId);
  const agName = ag
    ? ctx.lang === "bg"
      ? ag.name_bg
      : ag.name_en
    : latest.agencyId;

  const columns: Column[] = [
    { key: "candidate", label: ctx.lang === "bg" ? "Кандидат" : "Candidate" },
    {
      key: "support",
      label: ctx.lang === "bg" ? "Подкрепа" : "Support",
      numeric: true,
      format: "pct",
    },
  ];
  const tableRows: Row[] = rows.map((d) => ({
    candidate: candidateLabel(d),
    support: round2(d.support),
  }));

  const leader = rows[0];
  return {
    tool: "latestPresidentialPoll",
    domain: "elections",
    kind: "table",
    title:
      ctx.lang === "bg"
        ? `Последно президентско проучване — ${agName}`
        : `Latest presidential poll — ${agName}`,
    subtitle: latest.fieldwork
      ? ctx.lang === "bg"
        ? `Теренна работа: ${latest.fieldwork}`
        : `Fieldwork: ${latest.fieldwork}`
      : undefined,
    columns,
    rows: tableRows,
    categories: rows.map((d) => candidateLabel(d)),
    series: [
      {
        key: "support",
        label: ctx.lang === "bg" ? "Подкрепа %" : "Support %",
        points: rows.map((d) => ({
          x: candidateLabel(d),
          y: round2(d.support),
        })),
      },
    ],
    viz: "bar",
    facts: {
      agency: agName,
      date: pollDate(latest.id),
      respondents: latest.respondents
        ? fmtInt(latest.respondents, ctx.lang)
        : "—",
      leader: leader
        ? `${candidateLabel(leader)} (${fmtPct(round2(leader.support), ctx.lang)})`
        : "—",
    },
    provenance,
  } as Envelope;
};
