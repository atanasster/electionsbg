// Per-MP shards. One JSON file per (NS, MP) pair containing everything the
// candidate page reads — loyalty headline, dissent list, voting peers.
//
// Purpose: cut the candidate-page first-paint cost from ~3 MB gzipped (full
// loyalty + dissents + similarity for every MP in the NS) to ~5 KB (one
// shard). The aggregate files stay for screens that browse the whole
// chamber (cohesion ribbon, similarity-ranking screen).
//
// Idempotent: only writes files whose content actually changed, so re-runs
// don't churn the Firebase deploy diff.

import fs from "fs";
import path from "path";
import type { CohesionSlice } from "./types";
import type { LoyaltyOutput, LoyaltyEntry } from "./loyalty";
import type { SimilarityOutput, SimilarityEntry } from "./similarity";
import type { DissentOutput, DissentEntry } from "./dissents";

export interface MpShard {
  mpId: number;
  ns: string;
  partyShort: string;
  loyalty: {
    votesCast: number;
    withParty: number;
    loyaltyPct: number;
    windowFrom: string;
    windowTo: string;
    totalVoteItems: number;
  };
  dissents: {
    totalCast: number;
    dissentCount: number;
    recent: DissentEntry["recent"];
  };
  similarity: {
    topK: SimilarityEntry["topK"];
    bottomK: SimilarityEntry["bottomK"];
  };
}

interface WriteContext {
  ns: string;
  outDir: string; // <derivedDir>/per-mp/<ns>
  loyaltyByMp: Map<number, LoyaltyEntry>;
  dissentsByMp: Map<number, DissentEntry>;
  similarityByMp: Map<number, SimilarityEntry>;
  loyaltyMeta: {
    windowFrom: string;
    windowTo: string;
    totalVoteItems: number;
  };
}

const canonicalJson = (obj: unknown): string =>
  JSON.stringify(obj, null, 2) + "\n";

// File-content comparison: same bytes ⇒ skip the write so the file's mtime
// doesn't bump and the next deploy pass doesn't list it as "changed".
const writeIfChanged = (filePath: string, content: string): boolean => {
  if (fs.existsSync(filePath)) {
    try {
      const existing = fs.readFileSync(filePath, "utf8");
      if (existing === content) return false;
    } catch {
      // Fall through and overwrite.
    }
  }
  fs.writeFileSync(filePath, content);
  return true;
};

const buildShard = (mpId: number, ctx: WriteContext): MpShard | null => {
  const l = ctx.loyaltyByMp.get(mpId);
  if (!l) return null; // Loyalty is the authoritative roster — no loyalty,
  // no shard. An MP who never cast a vote can't have a useful candidate-
  // page voting tile anyway.

  const s = ctx.similarityByMp.get(mpId);
  const d = ctx.dissentsByMp.get(mpId);

  return {
    mpId,
    ns: ctx.ns,
    partyShort: l.partyShort,
    loyalty: {
      votesCast: l.votesCast,
      withParty: l.withParty,
      loyaltyPct: l.loyaltyPct,
      windowFrom: ctx.loyaltyMeta.windowFrom,
      windowTo: ctx.loyaltyMeta.windowTo,
      totalVoteItems: ctx.loyaltyMeta.totalVoteItems,
    },
    dissents: {
      totalCast: d?.totalCast ?? l.votesCast,
      dissentCount: d?.dissentCount ?? 0,
      recent: d?.recent ?? [],
    },
    similarity: {
      topK: s?.topK ?? [],
      bottomK: s?.bottomK ?? [],
    },
  };
};

export interface ShardRunInput {
  ns: string;
  loyalty: LoyaltyOutput;
  similarity: SimilarityOutput;
  dissents: DissentOutput;
  // Unused today but pass-through in case a future revision wants to embed
  // the MP's party-cohesion context (e.g. "this MP's group has 0.92
  // cohesion" in the loyalty tile).
  cohesion?: CohesionSlice;
}

export interface ShardRunResult {
  ns: string;
  written: number;
  unchanged: number;
  pruned: number;
}

export const writeMpShards = (
  derivedDir: string,
  input: ShardRunInput,
): ShardRunResult => {
  const outDir = path.join(derivedDir, "per-mp", input.ns);
  fs.mkdirSync(outDir, { recursive: true });

  const loyaltyByMp = new Map<number, LoyaltyEntry>();
  for (const e of input.loyalty.entries) loyaltyByMp.set(e.mpId, e);
  const dissentsByMp = new Map<number, DissentEntry>();
  for (const e of input.dissents.entries) dissentsByMp.set(e.mpId, e);
  const similarityByMp = new Map<number, SimilarityEntry>();
  for (const e of input.similarity.entries) similarityByMp.set(e.mpId, e);

  const ctx: WriteContext = {
    ns: input.ns,
    outDir,
    loyaltyByMp,
    dissentsByMp,
    similarityByMp,
    loyaltyMeta: {
      windowFrom: input.loyalty.windowFrom,
      windowTo: input.loyalty.windowTo,
      totalVoteItems: input.loyalty.totalVoteItems,
    },
  };

  const wantedFiles = new Set<string>();
  let written = 0;
  let unchanged = 0;

  for (const mpId of loyaltyByMp.keys()) {
    const shard = buildShard(mpId, ctx);
    if (!shard) continue;
    const fileName = `${mpId}.json`;
    wantedFiles.add(fileName);
    const filePath = path.join(outDir, fileName);
    if (writeIfChanged(filePath, canonicalJson(shard))) {
      written++;
    } else {
      unchanged++;
    }
  }

  // Prune stale shards — an MP that disappeared from the loyalty roster
  // (a re-ingest dropped them, or they were merged with a duplicate id)
  // should not leave a ghost shard behind.
  let pruned = 0;
  if (fs.existsSync(outDir)) {
    for (const f of fs.readdirSync(outDir)) {
      if (!f.endsWith(".json")) continue;
      if (wantedFiles.has(f)) continue;
      fs.unlinkSync(path.join(outDir, f));
      pruned++;
    }
  }

  return { ns: input.ns, written, unchanged, pruned };
};
