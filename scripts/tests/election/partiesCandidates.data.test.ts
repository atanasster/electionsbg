// Regression net over the PARTY / CANDIDATE / PREFERENCE sharded outputs inside
// each dated election folder:
//
//   parties/by_{region,municipality,section,settlement}/<num>.json
//                                         per-party geographic vote breakdown
//   preferences/country.json              per-candidate preferential votes
//   candidates.json + candidates/by-slug/ candidate roster
//   problem_sections.json + problem_membership.json  Roma-neighbourhood risk set
//
// The party breakdowns are reconciled EXACTLY back against the authoritative
// per-election shards (region_votes / section / settlement / municipality) — each
// verified zero-violation across the current corpus. Preferences, candidates and
// problem-sections get internal-consistency + cross-reference checks. Everything
// adapts to the cycle: preferential voting only exists from 2014, problem_sections
// only from 2009, so those blocks skip when the file is absent.
//
//   npm run test:unit -- scripts/tests/election/partiesCandidates

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import type { Votes } from "@/data/dataTypes";
import {
  listParliamentaryElections,
  loadSections,
  loadRegions,
  electionPath,
  readJson,
  listJsonFiles,
  partyUniverse,
} from "./electionData";

const elections = listParliamentaryElections();
const suite = elections.length ? describe : describe.skip;

interface PartyGeoRow {
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  section?: string;
  totalVotes: number;
  machineVotes?: number;
  paperVotes?: number;
}

suite("party / candidate / preference shards", () => {
  for (const election of elections) {
    describe(election, () => {
      const parties = partyUniverse(election);

      // ── parties/by_* reconcile with the authoritative vote shards ────────
      describe("parties geographic breakdown", () => {
        // Build the source vote maps keyed the way each breakdown level keys
        // its rows: region → oblast, section → section id, settlement → ekatte,
        // municipality → obshtina (via the dated muni shard, 1:1).
        const sections = loadSections(election);

        const bySectionSrc = new Map<string, Record<number, number>>();
        const byEkatteSrc = new Map<string, Record<number, number>>();
        for (const s of sections) {
          const votes = s.results?.votes ?? [];
          const sec: Record<number, number> = {};
          for (const v of votes)
            sec[v.partyNum] = (sec[v.partyNum] ?? 0) + (v.totalVotes ?? 0);
          // A few 2009 sections list a party twice in the raw protocol; summing
          // doubles that party, but parties/by_section stores the deduplicated
          // value, so those sections legitimately don't reconcile — skip them
          // (the duplicate quirk itself is asserted rare in the shard suite).
          const hasDup =
            votes.length !== new Set(votes.map((v) => v.partyNum)).size;
          if (!hasDup) bySectionSrc.set(s.section, sec);
          if (s.ekatte) {
            const e = byEkatteSrc.get(s.ekatte) ?? {};
            for (const v of s.results?.votes ?? [])
              e[v.partyNum] = (e[v.partyNum] ?? 0) + (v.totalVotes ?? 0);
            byEkatteSrc.set(s.ekatte, e);
          }
        }
        const byOblastSrc = new Map<string, Record<number, number>>();
        for (const r of loadRegions(election)) {
          const m: Record<number, number> = {};
          for (const v of r.results.votes) m[v.partyNum] = v.totalVotes;
          byOblastSrc.set(r.key, m);
        }
        const muniVotesCache = new Map<string, Record<number, number> | null>();
        const muniVotes = (key: string): Record<number, number> | null => {
          if (muniVotesCache.has(key)) return muniVotesCache.get(key)!;
          const f = electionPath(election, "municipalities", `${key}.json`);
          if (!fs.existsSync(f)) {
            muniVotesCache.set(key, null);
            return null;
          }
          const m: Record<number, number> = {};
          for (const v of readJson<{ results: { votes: Votes[] } }>(f).results
            .votes)
            m[v.partyNum] = v.totalVotes;
          muniVotesCache.set(key, m);
          return m;
        };

        const levels: {
          sub: string;
          src: (row: PartyGeoRow) => Record<number, number> | null | undefined;
        }[] = [
          { sub: "by_region", src: (r) => byOblastSrc.get(r.oblast ?? "") },
          {
            sub: "by_section",
            src: (r) => bySectionSrc.get(r.section ?? ""),
          },
          {
            sub: "by_settlement",
            src: (r) => byEkatteSrc.get(r.ekatte ?? ""),
          },
          { sub: "by_municipality", src: (r) => muniVotes(r.obshtina ?? "") },
        ];

        for (const { sub, src } of levels) {
          test(`${sub}: total = paper+machine and totalVotes == source shard`, () => {
            const dir = electionPath(election, "parties", sub);
            if (!fs.existsSync(dir)) return;
            const bad: string[] = [];
            for (const f of listJsonFiles(dir)) {
              const num = Number(f.replace(".json", ""));
              const rows = readJson<PartyGeoRow[]>(`${dir}/${f}`);
              for (const row of rows) {
                if (
                  row.paperVotes != null &&
                  row.machineVotes != null &&
                  row.totalVotes !== row.paperVotes + row.machineVotes
                )
                  bad.push(`${sub}/${num} total != paper+machine`);
                if (row.totalVotes < 0) bad.push(`${sub}/${num} negative`);
                const s = src(row);
                if (s && (s[num] ?? 0) !== row.totalVotes)
                  bad.push(
                    `${sub}/${num}@${row.oblast ?? row.obshtina ?? row.ekatte ?? row.section}: file ${row.totalVotes} vs shard ${s[num] ?? 0}`,
                  );
              }
            }
            expect(bad.slice(0, 8), `${bad.length} ${sub} violations`).toEqual(
              [],
            );
          });
        }
      });

      // ── preferences/country.json ─────────────────────────────────────────
      describe("preferences", () => {
        test("non-negative, well-formed pref codes, partyVotes ≤ allVotes, arithmetic mostly holds", () => {
          const f = electionPath(election, "preferences", "country.json");
          if (!fs.existsSync(f)) return; // preferential voting is a 2014+ feature
          const prefs = readJson<
            {
              partyNum: number;
              pref?: string | number;
              totalVotes: number;
              paperVotes?: number;
              machineVotes?: number;
              partyVotes?: number;
              allVotes?: number;
            }[]
          >(f);
          const bad: string[] = [];
          let arithViol = 0;
          for (const p of prefs) {
            if (p.totalVotes < 0) bad.push(`p${p.partyNum} negative`);
            if (!parties.has(p.partyNum))
              bad.push(`unknown party ${p.partyNum}`);
            if (p.pref != null && !/^\d{2,3}$/.test(String(p.pref)))
              bad.push(`bad pref code ${p.pref}`);
            if (
              p.partyVotes != null &&
              p.allVotes != null &&
              p.partyVotes > p.allVotes
            )
              bad.push(`p${p.partyNum} partyVotes > allVotes`);
            if (
              p.paperVotes != null &&
              p.machineVotes != null &&
              p.totalVotes !== p.paperVotes + p.machineVotes
            )
              arithViol++;
          }
          expect(
            bad.slice(0, 8),
            `${bad.length} preference violations`,
          ).toEqual([]);
          // total = paper+machine holds for every cycle except 2021_04_04 (the
          // machine-pilot, ~1.9% off); guard only against wholesale breakage.
          expect(
            arithViol / Math.max(1, prefs.length),
            `${arithViol}/${prefs.length} preference arithmetic violations`,
          ).toBeLessThan(0.05);
        });
      });

      // ── candidates.json + candidates/by-slug ─────────────────────────────
      describe("candidates", () => {
        const cands = readJson<
          { name: string; partyNum: number; oblast: string; pref: string }[]
        >(electionPath(election, "candidates.json"));

        test("roster: known party, oblast + pref present", () => {
          const bad: string[] = [];
          for (const c of cands) {
            if (!parties.has(c.partyNum))
              bad.push(`${c.name} unknown party ${c.partyNum}`);
            if (!c.oblast) bad.push(`${c.name} missing oblast`);
            if (c.pref != null && !/^\d{2,3}$/.test(String(c.pref)))
              bad.push(`${c.name} bad pref ${c.pref}`);
          }
          expect(bad.slice(0, 8), `${bad.length} candidate violations`).toEqual(
            [],
          );
        });

        test("by-slug cikRows are all present in candidates.json", () => {
          const dir = electionPath(election, "candidates", "by-slug");
          if (!fs.existsSync(dir)) return; // pre-2014 cycles have no by-slug
          const rosterKey = new Set(
            cands.map((c) => `${c.partyNum}|${c.oblast}|${c.pref}|${c.name}`),
          );
          const files = listJsonFiles(dir);
          // deterministic stride sample to bound runtime on the ~6.5k roster
          const stride = Math.max(1, Math.floor(files.length / 400));
          const bad: string[] = [];
          let checked = 0;
          for (let i = 0; i < files.length; i += stride) {
            const s = readJson<{
              slug: string;
              partyNum: number;
              cikRows: {
                name: string;
                partyNum: number;
                oblast: string;
                pref: string;
              }[];
            }>(`${dir}/${files[i]}`);
            for (const r of s.cikRows) {
              checked++;
              if (
                !rosterKey.has(`${r.partyNum}|${r.oblast}|${r.pref}|${r.name}`)
              )
                bad.push(
                  `${s.slug}: ${r.name}/${r.oblast}/${r.pref} not in roster`,
                );
            }
          }
          expect(checked, "some cikRows checked").toBeGreaterThan(50);
          expect(bad.slice(0, 8), `${bad.length} by-slug violations`).toEqual(
            [],
          );
        });
      });

      // ── problem_sections.json + membership ───────────────────────────────
      describe("problem sections", () => {
        test("neighbourhoods non-empty, sections exist, membership consistent", () => {
          const f = electionPath(election, "problem_sections.json");
          if (!fs.existsSync(f)) return; // 2009+ only
          const { neighborhoods } = readJson<{
            neighborhoods: {
              id: string;
              sections: { section: string }[];
            }[];
          }>(f);
          const secIds = new Set(loadSections(election).map((s) => s.section));
          const bad: string[] = [];
          const nbSections = new Set<string>();
          for (const n of neighborhoods) {
            if (!n.sections || n.sections.length === 0)
              bad.push(`${n.id} has no sections`);
            for (const s of n.sections ?? []) {
              nbSections.add(s.section);
              if (!secIds.has(s.section))
                bad.push(`${n.id}: section ${s.section} not in corpus`);
            }
          }
          const memFile = electionPath(election, "problem_membership.json");
          if (fs.existsSync(memFile)) {
            const mem = readJson<Record<string, unknown>>(memFile);
            for (const s of Object.keys(mem)) {
              if (!nbSections.has(s))
                bad.push(`membership ${s} not in any neighbourhood`);
            }
          }
          expect(
            bad.slice(0, 8),
            `${bad.length} problem-section violations`,
          ).toEqual([]);
        });
      });
    });
  }
});
