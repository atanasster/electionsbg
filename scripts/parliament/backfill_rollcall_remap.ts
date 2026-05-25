// One-off backfill: re-apply the (id, name) → canonical-id remap to every
// already-ingested session file under data/parliament/votes/sessions/.
//
// Parliament.bg's stenogram CSV id space diverged from the deduped MP roster
// (data/parliament/index.json) long before the remap step was added to the
// scraper — so historical session files still carry the per-NS CSV ids that
// either point to the wrong person (mismatch) or aren't in the deduped roster
// at all (older NS ids that the dedup merged into a canonical newer id).
//
// This script applies the same buildSessionRemap logic the live scraper now
// uses, but locally — no parliament.bg re-fetch. Output: each session file
// gets its mpNames/mpParty keys renamed, votes[*].mpId substituted, and
// unresolvedMpIds rewritten. Idempotent: a session that's already canonical
// is left untouched.
//
// CLI:
//   tsx scripts/parliament/backfill_rollcall_remap.ts [--dry-run] [--ns 52]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { buildSessionRemap } from "./rollcall/roster";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOTES_DIR = path.resolve(__dirname, "../../data/parliament/votes");
const SESSIONS_DIR = path.join(VOTES_DIR, "sessions");
const MP_INDEX_FILE = path.resolve(
  __dirname,
  "../../data/parliament/index.json",
);

interface SessionVote {
  mpId: number;
  vote: "yes" | "no" | "abstain" | "absent";
}

interface SessionItemFile {
  item: number;
  tallies: { yes: number; no: number; abstain: number; absent: number };
  votes: SessionVote[];
}

interface SessionFile {
  ns: string;
  date: string;
  stenogramId: number;
  scrapedAt: string;
  unresolvedMpIds?: number[];
  mpNames?: Record<string, string>;
  mpParty?: Record<string, string>;
  itemTitles?: Record<string, string>;
  itemSlugs?: Record<string, string>;
  itemTopics?: Record<string, string>;
  pdfUrl?: string;
  sessions: SessionItemFile[];
}

const canonicalJson = (data: unknown): string =>
  JSON.stringify(data, null, 2) + "\n";

const remapSession = (
  sf: SessionFile,
): { changed: boolean; remapCount: number; collisionCount: number } => {
  const pairs: Array<{ csvId: number; csvName: string }> = [];
  for (const [k, name] of Object.entries(sf.mpNames ?? {})) {
    const cid = parseInt(k, 10);
    if (!Number.isFinite(cid)) continue;
    pairs.push({ csvId: cid, csvName: name });
  }
  const remap = buildSessionRemap(MP_INDEX_FILE, sf.ns ?? "", pairs);
  if (remap.byCsvId.size === 0) {
    return {
      changed: false,
      remapCount: 0,
      collisionCount: remap.collisions.size,
    };
  }

  // Rewrite mpNames / mpParty / votes / unresolvedMpIds in place. Keys not in
  // the remap stay as-is; keys in the remap move to the canonical id (and the
  // old key is deleted).
  const remapId = (id: number): number => remap.byCsvId.get(id) ?? id;

  const newNames: Record<string, string> = {};
  for (const [k, v] of Object.entries(sf.mpNames ?? {})) {
    const cid = parseInt(k, 10);
    newNames[String(remapId(cid))] = v;
  }
  sf.mpNames = newNames;

  if (sf.mpParty) {
    const newParty: Record<string, string> = {};
    for (const [k, v] of Object.entries(sf.mpParty)) {
      const cid = parseInt(k, 10);
      newParty[String(remapId(cid))] = v;
    }
    sf.mpParty = newParty;
  }

  for (const it of sf.sessions) {
    it.votes = it.votes
      .map((v) => ({ ...v, mpId: remapId(v.mpId) }))
      .sort((a, b) => a.mpId - b.mpId);
  }

  if (sf.unresolvedMpIds) {
    // unresolvedMpIds are CSV ids the validator didn't find in the local
    // profiles dir. After remap, the canonical id IS in profiles (since we
    // remap only to entries that exist in index.json). So drop any old id
    // that was remapped, and de-dup.
    sf.unresolvedMpIds = [
      ...new Set(sf.unresolvedMpIds.filter((id) => !remap.byCsvId.has(id))),
    ].sort((a, b) => a - b);
  }

  return {
    changed: true,
    remapCount: remap.byCsvId.size,
    collisionCount: remap.collisions.size,
  };
};

const main = async (args: { dryRun: boolean; ns?: string }): Promise<void> => {
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.log("✗ sessions directory missing — nothing to backfill");
    return;
  }
  const files = fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  let touched = 0;
  let totalRemaps = 0;
  let totalCollisions = 0;
  const perNs = new Map<
    string,
    { sessions: number; touched: number; remaps: number; collisions: number }
  >();

  for (const f of files) {
    const full = path.join(SESSIONS_DIR, f);
    const sf = JSON.parse(fs.readFileSync(full, "utf8")) as SessionFile;
    if (args.ns && sf.ns !== args.ns) continue;
    const ns = sf.ns || "?";
    const bucket = perNs.get(ns) ?? {
      sessions: 0,
      touched: 0,
      remaps: 0,
      collisions: 0,
    };
    bucket.sessions++;
    const result = remapSession(sf);
    bucket.remaps += result.remapCount;
    bucket.collisions += result.collisionCount;
    if (result.changed) {
      bucket.touched++;
      touched++;
      totalRemaps += result.remapCount;
      totalCollisions += result.collisionCount;
      if (!args.dryRun) {
        fs.writeFileSync(full, canonicalJson(sf));
      }
    }
    perNs.set(ns, bucket);
  }

  console.log(`\n${args.dryRun ? "[DRY RUN] " : ""}Per-NS summary:`);
  console.log(
    `${"NS".padStart(4)}  ${"sessions".padStart(8)}  ${"touched".padStart(7)}  ${"remaps".padStart(7)}  ${"collisions".padStart(10)}`,
  );
  for (const [ns, b] of [...perNs.entries()].sort()) {
    console.log(
      `${ns.padStart(4)}  ${String(b.sessions).padStart(8)}  ${String(b.touched).padStart(7)}  ${String(b.remaps).padStart(7)}  ${String(b.collisions).padStart(10)}`,
    );
  }
  console.log(
    `\n${args.dryRun ? "[DRY RUN] " : ""}touched ${touched}/${files.length} session(s), ${totalRemaps} total remap(s), ${totalCollisions} collision(s)`,
  );
};

const cli = command({
  name: "backfill_rollcall_remap",
  args: {
    dryRun: flag({
      type: optional(boolean),
      long: "dry-run",
      description: "Read and remap but don't write any files",
      defaultValue: () => false,
    }),
    ns: option({
      type: optional(string),
      long: "ns",
      description: "Limit to a single NS folder (e.g. --ns 47)",
    }),
  },
  handler: (a) => main({ dryRun: !!a.dryRun, ns: a.ns }),
});

run(cli, process.argv.slice(2));
