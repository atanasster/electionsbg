// Candidate preferential-vote results by name. Resolves a person name to a
// candidate in the election's candidates.json, then reads their per-район
// preferential vote counts from candidates/<name>/preferences_stats.json.
// Numbers are computed from the official files, never generated.

import { cikSlug } from "../../src/data/candidates/candidateSlug";
import { clarifyEnvelope } from "./clarify";
import { fetchData, fetchNationalSummary } from "./dataClient";
import { electionFullLabel, fmtInt } from "./format";
import { partyResult } from "./national";
import { OBLASTS } from "./place";
import { fuzzyBestMatch } from "./resolve";
import type { Envelope, ToolArgs, ToolContext } from "./types";

type CandidateRow = {
  name: string;
  name_en: string;
  oblast: string;
  partyNum: number;
  pref: string;
};
type NSParty = { partyNum: number; nickName?: string; name?: string };
type PrefEntry = {
  elections_date: string;
  party?: { name?: string; nickName?: string };
  preferences?: { oblast: string; pref: string; preferences: number }[];
};
type PrefStats = { stats?: PrefEntry[] };

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

const oblastName = (code: string, lang: "bg" | "en"): string =>
  OBLASTS[code]?.[lang] ?? code;

const notFound = (
  query: string,
  lang: "bg" | "en",
  election: string,
): Envelope => ({
  tool: "candidateResult",
  kind: "scalar",
  viz: "none",
  // "candidate OR party": this tool also resolves a party name typed as a
  // results query (see the fallback below), so a miss can be either — and for a
  // party that simply didn't run in the selected election, naming only the
  // candidate would be misleading.
  title:
    lang === "bg"
      ? `Не е намерен кандидат или партия „${query}“`
      : `No candidate or party found for "${query}"`,
  facts: {
    [lang === "bg" ? "търсене" : "query"]: query,
    [lang === "bg" ? "избор" : "election"]: electionFullLabel(election, lang),
    [lang === "bg" ? "подсказка" : "hint"]:
      lang === "bg"
        ? "Опитайте с пълно име (име и фамилия) или име на партия."
        : "Try a full first + last name, or a party name.",
  },
  provenance: [`${election}/candidates.json`],
});

export const candidateResult = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const lang = ctx.lang;
  const election = (args.election as string) || ctx.election;
  const query = String(args.name ?? "").trim();
  if (!query) return notFound(query, lang, election);

  const list = await fetchData<CandidateRow[]>(`/${election}/candidates.json`);
  const qt = norm(query).split(" ").filter(Boolean);
  const first = qt[0];
  const last = qt[qt.length - 1];
  // Latin query -> match the transliterated name; Cyrillic -> the BG name.
  const useEn = /[a-z]/i.test(query) && !/[Ѐ-ӿ]/.test(query);
  let matches = list.filter((c) => {
    const toks = norm(useEn ? c.name_en : c.name)
      .split(" ")
      .filter(Boolean);
    return (
      toks.length >= 2 && toks[0] === first && toks[toks.length - 1] === last
    );
  });
  if (!matches.length) {
    // The offline router can't always tell a coalition/party name ("Синя
    // България") from a person's name — both are 2–3 capitalized words — so a
    // party asked about as "results of X" lands on this candidate tool. If the
    // query resolves to a party for this election, answer with the party's
    // result instead of a dead "candidate not found". partyResult declines
    // (no `party` fact) for a genuine non-candidate person name, so the
    // candidate "not found" still surfaces in that case. Tried BEFORE the typo
    // fallback so a real party name can't be mis-corrected to a lookalike person.
    const asParty = await partyResult({ party: query, election }, ctx);
    if (asParty.facts?.party != null) return asParty;

    // typo / reordered candidate name: fuzzy-match the full romanized name (BG
    // and EN aliases). The same person recurs across районs, so each entry's item
    // is ALL their rows. tokenSort handles "Василев Асен". The index (≈6k names)
    // is built once per election via cacheKey, not on every miss; the thunk skips
    // the row build entirely on a cache hit.
    const hit = fuzzyBestMatch<CandidateRow[]>(
      query,
      () => {
        const byName = new Map<string, CandidateRow[]>();
        for (const c of list) {
          const arr = byName.get(c.name);
          if (arr) arr.push(c);
          else byName.set(c.name, [c]);
        }
        return [...byName.values()].map((rows) => ({
          item: rows,
          keys: [rows[0].name, rows[0].name_en].filter(Boolean) as string[],
        }));
      },
      {
        threshold: 0.3,
        minLen: 5,
        tokenSort: true,
        cacheKey: `candidate:${election}`,
      },
    );
    if (hit) matches = hit.item;
    if (!matches.length) return notFound(query, lang, election);
  }

  // The match keys on first + last token only (so a missing/typo'd middle name
  // still resolves). When the user DID type a full name that hits exactly, prefer
  // those rows — otherwise a precise "Георги Иванов Георгиев" would be drowned out
  // by every other "Георги … Георгиев". A partial query keeps the broad set.
  const qn = norm(query);
  const exactFull = matches.filter(
    (m) => norm(useEn ? m.name_en || m.name : m.name) === qn,
  );
  if (exactFull.length) matches = exactFull;

  // Disambiguation: distinct people who share a name surface as the SAME name
  // listed under DIFFERENT parties (the same person across районs keeps one
  // party). A prior pick re-arrives with `partyNum` pinned — narrow to it;
  // otherwise, when more than one party remains, ask the user which candidate.
  const pinnedParty = args.partyNum != null ? Number(args.partyNum) : undefined;
  // The picked party's name (authoritative for a disambiguated answer): the
  // per-candidate prefs file is keyed by NAME, so same-name people share it and
  // it holds at most one party per election — never trust its label/counts over
  // the party the user actually picked.
  let pinnedNick: string | undefined;
  if (pinnedParty != null) {
    matches = matches.filter((m) => m.partyNum === pinnedParty);
    if (!matches.length) return notFound(query, lang, election);
    const ns = await fetchNationalSummary<{ parties: NSParty[] }>(
      election,
    ).catch(() => ({ parties: [] as NSParty[] }));
    const p = ns.parties.find((x) => x.partyNum === pinnedParty);
    pinnedNick = p?.nickName || p?.name || undefined;
  } else {
    const partyNums = [...new Set(matches.map((m) => m.partyNum))];
    if (partyNums.length > 1) {
      const ns = await fetchNationalSummary<{ parties: NSParty[] }>(
        election,
      ).catch(() => ({ parties: [] as NSParty[] }));
      const byNum = new Map(ns.parties.map((p) => [p.partyNum, p]));
      const options = partyNums.map((pn) => {
        const row = matches.find((m) => m.partyNum === pn)!;
        const nm = useEn ? row.name_en || row.name : row.name;
        const p = byNum.get(pn);
        const nick = p?.nickName || p?.name || `#${pn}`;
        return {
          label: nm,
          sublabel: nick,
          tool: "candidateResult",
          args: { ...args, name: query, partyNum: pn },
        };
      });
      const prompt =
        lang === "bg"
          ? `Кой кандидат „${query}“ имате предвид?`
          : `Which candidate "${query}" do you mean?`;
      return clarifyEnvelope(prompt, options, [`${election}/candidates.json`]);
    }
  }

  // the same person can appear across several районs; canonical BG name is stable
  const cand = matches[0];

  let stats: PrefStats | undefined;
  try {
    stats = await fetchData<PrefStats>(
      `/${election}/candidates/${cand.name}/preferences_stats.json`,
    );
  } catch {
    /* no per-candidate prefs file — fall back to candidates.json below */
  }
  const entry = stats?.stats?.find((s) => s.elections_date === election);
  const entryNick = entry?.party?.nickName || entry?.party?.name || "";
  // For a disambiguated pick the picked party wins; the prefs counts are only
  // this person's when the name-keyed file's party matches it (otherwise they
  // belong to a different same-name candidate and we fall back to the candidacy
  // record, which IS party-specific).
  const party = pinnedNick ?? entryNick;
  const prefsMatch = pinnedNick == null || entryNick === pinnedNick;
  const who = lang === "bg" ? cand.name : cand.name_en || cand.name;
  const title =
    lang === "bg"
      ? `Преференции — ${who}${party ? ` (${party})` : ""} — ${electionFullLabel(election, lang)}`
      : `Preferential votes — ${who}${party ? ` (${party})` : ""} — ${electionFullLabel(election, lang)}`;

  if (prefsMatch && entry?.preferences?.length) {
    const rows = entry.preferences
      .map((p) => ({
        oblast: oblastName(p.oblast, lang),
        votes: p.preferences,
      }))
      .sort((a, b) => b.votes - a.votes);
    const total = rows.reduce((s, r) => s + r.votes, 0);
    return {
      tool: "candidateResult",
      kind: "table",
      viz: "none",
      title,
      columns: [
        {
          key: "oblast",
          label: lang === "bg" ? "Район (МИР)" : "Region (MIR)",
        },
        {
          key: "votes",
          label: lang === "bg" ? "Преференции" : "Preferential votes",
          numeric: true,
          format: "int",
        },
      ],
      rows: rows.map((r) => ({ oblast: r.oblast, votes: r.votes })),
      facts: {
        name: who,
        party,
        total_preferences: fmtInt(total, lang),
        regions: rows.length,
        top_region: rows[0]
          ? `${rows[0].oblast}: ${fmtInt(rows[0].votes, lang)}`
          : "",
        // deep-link key (hidden from the UI; consumed by ai/render/links.ts)
        candidate_id: cikSlug(cand.partyNum, cand.name),
      },
      provenance: [
        `${election}/candidates/${cand.name}/preferences_stats.json`,
      ],
    };
  }

  // fallback: candidates.json only (party + район + ballot number, no counts)
  const regions = [...new Set(matches.map((m) => oblastName(m.oblast, lang)))];
  return {
    tool: "candidateResult",
    kind: "scalar",
    viz: "none",
    title,
    facts: {
      name: who,
      [lang === "bg" ? "район" : "region"]: regions.join(", "),
      [lang === "bg" ? "преф. №" : "ballot #"]: [
        ...new Set(matches.map((m) => m.pref)),
      ].join(", "),
      // deep-link key (hidden from the UI; consumed by ai/render/links.ts)
      candidate_id: cikSlug(cand.partyNum, cand.name),
    },
    provenance: [`${election}/candidates.json`],
  };
};
