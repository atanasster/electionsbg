// Aggregate chmi (partial + new) elections across all ingested cycles into
// a single per-município index so the SPA can surface "extraordinary
// elections" contextually on the município page.
//
// Per the design decision, chmi cycles never appear in the elections
// dropdown — they're surfaced only on the município/settlement pages they
// affect. This index makes that lookup trivial:
//   { obshtinaCode: [{date, kmetstvoName, mayor, party, round, pctOfValid}] }
//
// Reads every data/<...>_chmi/municipalities/*.json, projects each
// município's mayor and kmetstvo winners into history entries, sorts by
// date descending, writes data/local_chmi_history.json.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LocalMunicipalityBundle } from "@/data/local/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_ROOT = path.resolve(__dirname, "../../data");

export type ChmiHistoryEvent = {
  /** Cycle slug folder name, e.g. "2024_06_23_chmi" */
  cycle: string;
  /** ISO date the partial was held (round 1). */
  date: string;
  /** "obshtina_mayor" when a município-wide mayor seat was contested,
   * "kmetstvo_mayor" for a village seat, "rayon_mayor" for a Sofia/Plovdiv/
   * Varna район, "council" for a full council re-election (нови избори за
   * общински съветници — the whole съвет dissolved and re-elected). */
  kind: "obshtina_mayor" | "kmetstvo_mayor" | "rayon_mayor" | "council";
  /** Município this event belongs to. Duplicated from the byObshtina key
   * so a flat national feed doesn't need an extra join. */
  obshtinaCode: string;
  obshtinaName: string;
  /** Kmetstvo (village) or район name when relevant; null for município-
   * wide partials. */
  kmetstvoName: string | null;
  candidateName: string;
  localPartyName: string;
  primaryCanonicalId: string | null;
  isIndependent: boolean;
  round: 1 | 2;
  pctOfValid: number;
  votes: number;
  /** Carried over from the per-município bundle when the winner also served
   * as an MP — drives `MpAvatar` photo reuse in the chmi feed. */
  mpId?: number;
  /** Council events only: seats the leading party won, and the council size.
   * For a council re-election the "winner" is the party with the most seats,
   * so `candidateName` is empty and `localPartyName` holds that party. */
  councilSeatsWon?: number;
  councilTotalSeats?: number;
};

export type ChmiHistory = {
  generatedAt: string;
  cyclesIncluded: string[];
  // Per obshtinaCode, newest event first.
  byObshtina: Record<string, ChmiHistoryEvent[]>;
  // Flat chronological feed (newest first) — used by the national chmi
  // overview screen so it doesn't have to flatten on every render.
  allEvents: ChmiHistoryEvent[];
};

const dateFromCycle = (cycle: string): string => {
  const m = cycle.match(/^(\d{4})_(\d{2})_(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
};

const readMunicipalityBundles = (
  cycleFolder: string,
): LocalMunicipalityBundle[] => {
  const dir = path.join(DATA_ROOT, cycleFolder, "municipalities");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map(
      (f) =>
        JSON.parse(
          fs.readFileSync(path.join(dir, f), "utf-8"),
        ) as LocalMunicipalityBundle,
    );
};

export const buildChmiHistory = (opts: {
  stringify: (o: object) => string;
}): void => {
  const { stringify } = opts;
  const chmiFolders = fs
    .readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /_(chmi|chmi_nov)$/.test(d.name))
    .map((d) => d.name)
    .sort();
  if (chmiFolders.length === 0) {
    return;
  }
  const byObshtina: Record<string, ChmiHistoryEvent[]> = {};
  for (const cycle of chmiFolders) {
    const date = dateFromCycle(cycle);
    const bundles = readMunicipalityBundles(cycle);
    for (const b of bundles) {
      const base = {
        cycle,
        date,
        obshtinaCode: b.obshtinaCode,
        obshtinaName: b.obshtinaName,
      };
      const events: ChmiHistoryEvent[] = [];
      // Detect Sofia район shards by code shape — their mayor.elected is
      // actually a район mayor (the parent SOF bundle's districts[] entry
      // was fanned out into this per-район shard).
      const isSofiaRayon = /^S2\d{3}$/.test(b.obshtinaCode);
      if (b.mayor.elected) {
        const m = b.mayor.elected;
        events.push({
          ...base,
          kind: isSofiaRayon ? "rayon_mayor" : "obshtina_mayor",
          kmetstvoName: isSofiaRayon ? b.obshtinaName : null,
          candidateName: m.candidateName,
          localPartyName: m.localPartyName,
          primaryCanonicalId: m.primaryCanonicalId,
          isIndependent: m.isIndependent,
          round: m.round,
          pctOfValid: m.pctOfValid,
          votes: m.votes,
          mpId: m.mpId,
        });
      }
      // Full council re-election ("нови избори за общински съветници"): the
      // only chmi shape that carries a populated council table, so seats > 0
      // is a clean signal. Headline = the party with the most seats.
      const councilTotalSeats = b.council.reduce(
        (a, p) => a + p.mandatesWon,
        0,
      );
      if (councilTotalSeats > 0 && !isSofiaRayon) {
        const lead = [...b.council]
          .filter((p) => p.mandatesWon > 0)
          .sort(
            (a, b) =>
              b.mandatesWon - a.mandatesWon || b.totalVotes - a.totalVotes,
          )[0];
        if (lead) {
          events.push({
            ...base,
            kind: "council",
            kmetstvoName: null,
            candidateName: "",
            localPartyName: lead.localPartyName,
            primaryCanonicalId: lead.primaryCanonicalId,
            isIndependent: lead.isIndependent,
            round: 1,
            pctOfValid: lead.pctOfValid,
            votes: lead.totalVotes,
            councilSeatsWon: lead.mandatesWon,
            councilTotalSeats,
          });
        }
      }
      for (const k of b.kmetstva) {
        const elected = k.candidates.find((c) => c.isElected);
        if (!elected) continue;
        events.push({
          ...base,
          kind: "kmetstvo_mayor",
          kmetstvoName: k.kmetstvoName,
          candidateName: elected.candidateName,
          localPartyName: elected.localPartyName,
          primaryCanonicalId: elected.primaryCanonicalId,
          isIndependent: elected.isIndependent,
          round: elected.round,
          pctOfValid: elected.pctOfValid,
          votes: elected.votes,
          mpId: elected.mpId,
        });
      }
      // SOF.districts[] duplicates the per-район shards created by the
      // Sofia fan-out — skip them on SOF to avoid double-counting. For
      // Plovdiv (PDV22) / Varna (VAR06) the catalogue has no per-район
      // shards, so the districts[] there IS the canonical source.
      if (b.obshtinaCode !== "SOF") {
        for (const d of b.districts) {
          const elected = d.candidates.find((c) => c.isElected);
          if (!elected) continue;
          events.push({
            ...base,
            kind: "rayon_mayor",
            kmetstvoName: d.districtName,
            candidateName: elected.candidateName,
            localPartyName: elected.localPartyName,
            primaryCanonicalId: elected.primaryCanonicalId,
            isIndependent: elected.isIndependent,
            round: elected.round,
            pctOfValid: elected.pctOfValid,
            votes: elected.votes,
            mpId: elected.mpId,
          });
        }
      }
      if (events.length === 0) continue;
      byObshtina[b.obshtinaCode] = (byObshtina[b.obshtinaCode] ?? []).concat(
        events,
      );
    }
  }
  // Sort each município's events newest-first.
  for (const code of Object.keys(byObshtina)) {
    byObshtina[code].sort((a, b) => b.date.localeCompare(a.date));
  }
  // Flat chronological feed (newest-first), used by the national chmi
  // overview screen.
  const allEvents = Object.values(byObshtina)
    .flat()
    .sort((a, b) => b.date.localeCompare(a.date));
  const history: ChmiHistory = {
    generatedAt: new Date().toISOString(),
    cyclesIncluded: chmiFolders,
    byObshtina,
    allEvents,
  };
  const outFile = path.join(DATA_ROOT, "local_chmi_history.json");
  fs.writeFileSync(outFile, stringify(history), "utf-8");

  // Per-município shards: every município page (and the settlement dashboard's
  // kметство-event filter) previously pulled the full 61KB global file just to
  // read byObshtina[code]. Shard so each município page fetches its own ≤1KB
  // file — or 404s, which is treated as "no events" by the consumer hook.
  // Keep the global file for the /local/chmi feed which needs everything.
  const shardDir = path.join(DATA_ROOT, "chmi_history");
  // Wipe and rewrite the shard dir so deleted municípios don't leak stale
  // events between runs. The directory is tiny (≤300 files, ≤1KB each).
  if (fs.existsSync(shardDir))
    fs.rmSync(shardDir, { recursive: true, force: true });
  fs.mkdirSync(shardDir, { recursive: true });
  for (const [code, events] of Object.entries(byObshtina)) {
    fs.writeFileSync(
      path.join(shardDir, `${code}.json`),
      stringify({ obshtinaCode: code, events }),
      "utf-8",
    );
  }

  console.log(
    `[build_chmi_history] wrote ${outFile} + ${Object.keys(byObshtina).length} chmi_history/<code>.json shards (${chmiFolders.length} cycle(s))`,
  );
};
