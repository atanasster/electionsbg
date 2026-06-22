// Slim avatar projection of parliament/index.json.
//
// The full roster index is ~970 KB — names, regions, nsFolders, birthDates and
// several normalized name forms for ~2,100 MPs (everyone who has ever served).
// That is far more than the <MpAvatar> component needs to draw a 20px face +
// party-colour ring. Pages that surface an MP only via a *connection*
// (/company/:eik, /awarder/:eik, /officials/:slug, political links) were
// pulling the entire index just to render those avatars — see the network
// audit that motivated this file.
//
// This emits parliament/avatars.json (~36 KB): per-MP party group (the only
// thing the ring colour needs) plus the list of MPs that have no photo. The
// photo path itself is derived from the id (/parliament/photos/<id>.webp) —
// every cached photo follows that pattern (verified: 0 absolute/legacy URLs in
// the current index) — so it costs no bytes to store. Any future non-standard
// URL is carried explicitly in `extra` so the projection stays lossless.
//
// CLI:
//   tsx scripts/parliament/build_avatars.ts                     # data/parliament
//   tsx scripts/parliament/build_avatars.ts <parliamentDir>     # explicit dir
// Also exported as buildAvatars() so scrape_mps.ts can regenerate it inline
// whenever index.json is rewritten.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

interface IndexMp {
  id: number;
  photoUrl: string;
  currentPartyGroupShort: string | null;
}
interface IndexFile {
  scrapedAt: string;
  total: number;
  mps: IndexMp[];
}

export interface AvatarsFile {
  scrapedAt: string;
  total: number;
  /** id → parliament.bg currentPartyGroupShort (raw; the SPA strips the "ПГ"
   *  prefix and resolves the ring colour via parliament_groups.json). */
  groups: Record<string, string | null>;
  /** ids with no usable photo — the SPA renders initials for these. */
  noPhoto: number[];
  /** id → photoUrl for the rare MP whose URL isn't /parliament/photos/<id>.webp
   *  (legacy absolute parliament.bg links). Empty for current data. */
  extra: Record<string, string>;
}

export const buildAvatarsFromIndex = (index: IndexFile): AvatarsFile => {
  const groups: Record<string, string | null> = {};
  const noPhoto: number[] = [];
  const extra: Record<string, string> = {};
  for (const m of index.mps) {
    groups[m.id] = m.currentPartyGroupShort ?? null;
    const url = m.photoUrl || "";
    if (!url) noPhoto.push(m.id);
    else if (url !== `/parliament/photos/${m.id}.webp`) extra[m.id] = url;
  }
  return {
    scrapedAt: index.scrapedAt,
    total: index.total,
    groups,
    noPhoto,
    extra,
  };
};

/** Read <parliamentDir>/index.json and (re)write <parliamentDir>/avatars.json.
 *  Returns the byte size of the emitted file. */
export const buildAvatars = (
  parliamentDir: string,
): { bytes: number; total: number } => {
  const indexPath = path.join(parliamentDir, "index.json");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`build_avatars: ${indexPath} not found`);
  }
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as IndexFile;
  const out = buildAvatarsFromIndex(index);
  const json = JSON.stringify(out);
  fs.writeFileSync(path.join(parliamentDir, "avatars.json"), json);
  return { bytes: Buffer.byteLength(json), total: out.total };
};

const __filename = fileURLToPath(import.meta.url);
const invokedDirectly =
  !!process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  const dir =
    process.argv[2] ??
    path.resolve(path.dirname(__filename), "../../data/parliament");
  const { bytes, total } = buildAvatars(dir);
  console.log(
    `✓ wrote ${path.join(dir, "avatars.json")} — ${total} MPs, ${(bytes / 1024).toFixed(0)} KB`,
  );
}
