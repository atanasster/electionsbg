/**
 * Backfill the per-MP roster shards from an existing parliament/index.json.
 *
 *   tsx scripts/parliament/build_mp_by_id.ts            # data/parliament
 *   tsx scripts/parliament/build_mp_by_id.ts <dir>      # custom roster dir
 *
 * Normally `scrape_mps.ts` writes these alongside index.json on every run; this
 * one-shot regenerates them from the current index without re-scraping (useful
 * after a fresh clone, or to ship the shards without a full parliament scrape).
 */
import fs from "fs";
import path from "path";
import { writeMpByIdShards } from "./lib/writeMpById";

const dir = process.argv[2] ?? path.resolve(process.cwd(), "data/parliament");
const indexPath = path.join(dir, "index.json");

if (!fs.existsSync(indexPath)) {
  console.error(`✗ no index.json at ${indexPath}`);
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
  mps: { id: number }[];
};
const n = writeMpByIdShards(index.mps ?? [], dir);
console.log(`✓ wrote ${n} per-MP shards under ${path.join(dir, "by-id")}/`);
