// One-off historical backfill: walk parliament.bg stenogram ids BACKWARDS
// from a given starting id, ingest each session into data/parliament/votes/.
// Bypasses the regular scraper's diff-cap guard since the whole point of this
// run is to touch many files at once.
//
// Use:
//   npx tsx scripts/parliament/backfill_history.ts --from 11100 --max 200
//
// The walker stops after 30 consecutive ids with no roll-call CSV (procedural
// sessions don't ship one; long runs of those usually mean we've walked past
// the start of the NS).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, option, string, optional } from "cmd-ts";
import {
  fetchStenogram,
  findRollcallCsv,
  findGroupsCsv,
  findRollcallPdf,
  fetchCsv,
  publicUrl,
} from "./rollcall/api";
import { parseCsv, groupByItem, type SessionItem } from "./rollcall/parse";
import { extractItemTitles } from "./rollcall/titles";
import {
  canonicalJson,
  loadMpIndex,
  validateSessionItems,
} from "./rollcall/validate";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOTES_DIR = path.resolve(__dirname, "../../data/parliament/votes");
const SESSIONS_DIR = path.join(VOTES_DIR, "sessions");
const INDEX_FILE = path.join(VOTES_DIR, "index.json");

const main = async (args: {
  from: string;
  max: string;
  gapStop: string;
}): Promise<void> => {
  const from = parseInt(args.from, 10);
  const max = parseInt(args.max, 10);
  const gapStop = parseInt(args.gapStop, 10);
  if (!Number.isFinite(from) || !Number.isFinite(max)) {
    throw new Error("--from and --max must be integers");
  }

  const knownMpIds = loadMpIndex();
  const ctx = {
    knownMpIds,
    seatedCount: 240,
    // Wider tolerance for historical sessions — opening days and swearing-in
    // sessions vary more than the steady-state band allows.
    seatedTolerance: 30,
  };

  console.log(
    `→ walking backward from id ${from} (gap-stop ${gapStop}, max ${max})`,
  );

  // Load existing index so we can skip ids we've already ingested + update it.
  const idx = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as {
    sessions: Array<{
      date: string;
      stenogramId: number;
      items: number;
      file: string;
      ns?: string;
    }>;
    [k: string]: unknown;
  };
  const haveIds = new Set(idx.sessions.map((s) => s.stenogramId));

  fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  let gap = 0;
  let ingested = 0;
  let scanned = 0;
  for (let id = from - 1; scanned < max && id > 0; id--, scanned++) {
    if (haveIds.has(id)) {
      // Already covered — reset the gap counter and skip the network round trip.
      gap = 0;
      continue;
    }
    const sten = await fetchStenogram(id);
    if (!sten) {
      gap++;
      if (gap >= gapStop) {
        console.log(`  · gap of ${gap} reached at id ${id}; stopping`);
        break;
      }
      continue;
    }
    const csvRef = findRollcallCsv(sten);
    if (!csvRef) {
      gap++;
      console.log(
        `  · id ${id} (${sten.Pl_Sten_date}): no roll-call CSV — skipping`,
      );
      if (gap >= gapStop) {
        console.log(`  · gap of ${gap} reached; stopping`);
        break;
      }
      continue;
    }
    gap = 0;
    try {
      const csvText = await fetchCsv(csvRef.Pl_StenDfile);
      const rows = parseCsv(csvText);
      const items = groupByItem(rows);
      const result = validateSessionItems(items, ctx);
      const mpNames: Record<string, string> = {};
      const mpParty: Record<string, string> = {};
      for (const r of rows) {
        mpNames[String(r.mpId)] = r.mpName;
        mpParty[String(r.mpId)] = r.partyShort;
      }
      let itemTitles: Record<string, string> = {};
      const groupsRef = findGroupsCsv(sten);
      if (groupsRef) {
        try {
          const groupsCsv = await fetchCsv(groupsRef.Pl_StenDfile);
          itemTitles = extractItemTitles(groupsCsv);
        } catch {
          // best-effort
        }
      }
      const pdfRef = findRollcallPdf(sten);
      const pdfUrl = pdfRef ? publicUrl(pdfRef.Pl_StenDfile) : undefined;
      const sessionFile = {
        ns: rows[0]?.nsFolder ? `${rows[0].nsFolder}` : "",
        date: sten.Pl_Sten_date,
        stenogramId: sten.Pl_Sten_id,
        scrapedAt: new Date().toISOString(),
        unresolvedMpIds: [...result.unknownMpIds].sort((a, b) => a - b),
        mpNames,
        mpParty,
        ...(Object.keys(itemTitles).length > 0 ? { itemTitles } : {}),
        ...(pdfUrl ? { pdfUrl } : {}),
        sessions: items as Array<{
          item: number;
          tallies: SessionItem["tallies"];
          votes: SessionItem["votes"];
        }>,
      };
      const filename = `${sten.Pl_Sten_date}.json`;
      const fullPath = path.join(SESSIONS_DIR, filename);
      fs.writeFileSync(fullPath, canonicalJson(sessionFile));
      idx.sessions.push({
        date: sten.Pl_Sten_date,
        stenogramId: sten.Pl_Sten_id,
        items: items.length,
        file: `sessions/${filename}`,
        ns: sessionFile.ns,
      });
      haveIds.add(id);
      ingested++;
      console.log(
        `  + ${sten.Pl_Sten_date} (id ${id}): ${items.length} item(s), ${rows.length} rows`,
      );
    } catch (e) {
      console.log(
        `  ! id ${id} (${sten.Pl_Sten_date}): ${(e as Error).message}`,
      );
    }
  }

  if (ingested === 0) {
    console.log("✓ nothing to ingest");
    return;
  }

  // Sort + write back index.json. mpProfileByNs is updated by the regular
  // scraper, but since the backfill might extend an NS's date range we
  // recompute it here too.
  idx.sessions.sort((a, b) => a.date.localeCompare(b.date));
  const profile: Record<
    string,
    { mpNames: Record<string, string>; mpParty: Record<string, string> }
  > = {};
  const byNs = new Map<string, typeof idx.sessions>();
  for (const s of idx.sessions) {
    if (!s.ns) continue;
    const arr = byNs.get(s.ns) ?? [];
    arr.push(s);
    byNs.set(s.ns, arr);
  }
  for (const [ns, arr] of byNs) {
    arr.sort((a, b) => b.date.localeCompare(a.date));
    for (const entry of arr) {
      const p = path.join(VOTES_DIR, entry.file);
      if (!fs.existsSync(p)) continue;
      const sf = JSON.parse(fs.readFileSync(p, "utf8")) as {
        mpNames?: Record<string, string>;
        mpParty?: Record<string, string>;
      };
      if (sf.mpNames && sf.mpParty) {
        profile[ns] = { mpNames: sf.mpNames, mpParty: sf.mpParty };
        break;
      }
    }
  }
  idx.mpProfileByNs = profile;
  idx.scrapedAt = new Date().toISOString();
  fs.writeFileSync(INDEX_FILE, canonicalJson(idx));
  console.log(`✓ ingested ${ingested} session(s); updated ${INDEX_FILE}`);
};

const cli = command({
  name: "backfill_history",
  args: {
    from: option({
      type: string,
      long: "from",
      description: "Start id (walk decreases from here, exclusive)",
    }),
    max: option({
      type: optional(string),
      long: "max",
      description: "Max ids to scan (default 500)",
      defaultValue: () => "500",
    }),
    gapStop: option({
      type: optional(string),
      long: "gap-stop",
      description: "Stop after N consecutive missing/no-CSV ids (default 30)",
      defaultValue: () => "30",
    }),
  },
  handler: (a) => main({ from: a.from, max: a.max, gapStop: a.gapStop }),
});

run(cli, process.argv.slice(2));
