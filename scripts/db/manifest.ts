// Tier 1 of the regression net: a checksum manifest of the generated
// procurement JSON. The compact form (per-category digests + headline totals)
// is committed as data/db/procurement.manifest.json — small, git-friendly, and
// the documented baseline. With --full it also writes the per-file hash map to
// scripts/db/.cache (gitignored), the drill-down baseline for the Phase 2
// byte-level diff.
//
// All hashing is volatile-insensitive (see lib/canonical.ts) so a plain
// regeneration produces an identical manifest — only real data changes move it.
//
//   npm run db:manifest        # write compact + full
//   tsx scripts/db/manifest.ts # compact only
//
// See docs/plans/sql-migration-v1.md (Phase 1).

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PROC_DIR,
  DB_DIR,
  MANIFEST_FILE,
  FULL_MANIFEST_FILE,
} from "./lib/paths";
import {
  walkJsonFiles,
  hashJsonFile,
  sha256,
  stripVolatile,
} from "./lib/canonical";

export interface CategoryDigest {
  fileCount: number;
  totalBytes: number;
  digest: string;
}

export interface ProcurementManifest {
  domain: "procurement";
  fileCount: number;
  totalBytes: number;
  totals: unknown;
  categories: Record<string, CategoryDigest>;
}

const categoryOf = (rel: string): string => {
  const seg = rel.split(path.sep);
  return seg.length === 1 ? "_root" : seg[0];
};

/** Compute the manifest (compact + full per-file map) without writing. */
export const computeManifest = (): {
  manifest: ProcurementManifest;
  full: Record<string, string>;
} => {
  const files = walkJsonFiles(PROC_DIR);
  const full: Record<string, string> = {};
  const cats: Record<
    string,
    { fileCount: number; totalBytes: number; lines: string[] }
  > = {};
  let totalBytes = 0;

  for (const abs of files) {
    const rel = path.relative(PROC_DIR, abs);
    const { hash, bytes } = hashJsonFile(abs);
    full[rel] = hash;
    totalBytes += bytes;
    const c = (cats[categoryOf(rel)] ||= {
      fileCount: 0,
      totalBytes: 0,
      lines: [],
    });
    c.fileCount++;
    c.totalBytes += bytes;
    c.lines.push(`${rel}\t${hash}`);
  }

  const categories: Record<string, CategoryDigest> = {};
  for (const k of Object.keys(cats).sort()) {
    const c = cats[k];
    categories[k] = {
      fileCount: c.fileCount,
      totalBytes: c.totalBytes,
      digest: sha256(c.lines.sort().join("\n")),
    };
  }

  const idxPath = path.join(PROC_DIR, "index.json");
  const totals = existsSync(idxPath)
    ? ((
        stripVolatile(JSON.parse(readFileSync(idxPath, "utf8"))) as {
          totals?: unknown;
        }
      ).totals ?? null)
    : null;

  return {
    manifest: {
      domain: "procurement",
      fileCount: files.length,
      totalBytes,
      totals,
      categories,
    },
    full,
  };
};

export const writeManifest = (writeFull: boolean): ProcurementManifest => {
  const { manifest, full } = computeManifest();
  mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  if (writeFull) {
    mkdirSync(path.dirname(FULL_MANIFEST_FILE), { recursive: true });
    writeFileSync(
      FULL_MANIFEST_FILE,
      `${JSON.stringify({ domain: "procurement", files: full })}\n`,
    );
  }
  return manifest;
};

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  if (!existsSync(path.join(PROC_DIR, "index.json"))) {
    console.error(
      `No procurement data at ${PROC_DIR} — nothing to snapshot. ` +
        `Run the procurement ingest first.`,
    );
    process.exit(1);
  }
  const full = process.argv.includes("--full");
  const m = writeManifest(full);
  const mb = (n: number): string => `${(n / 1e6).toFixed(1)}MB`;
  console.log(
    `procurement manifest → ${path.relative(process.cwd(), MANIFEST_FILE)}`,
  );
  console.log(`  ${m.fileCount} files, ${mb(m.totalBytes)}`);
  for (const [k, c] of Object.entries(m.categories)) {
    console.log(
      `    ${k.padEnd(20)} ${String(c.fileCount).padStart(6)} files  ${mb(
        c.totalBytes,
      ).padStart(8)}  ${c.digest.slice(0, 12)}`,
    );
  }
  if (full)
    console.log(
      `  full map → ${path.relative(process.cwd(), FULL_MANIFEST_FILE)}`,
    );
}
