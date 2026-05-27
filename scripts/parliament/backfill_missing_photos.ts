/**
 * One-off backfill: re-check parliament.bg for MPs we previously marked as
 * having no photo, then download the real images that parliament.bg has since
 * added (or that we missed due to the old .png-only downloader).
 *
 * Caused by: parliament.bg uses .jpg for older MPs and .png for newer ones,
 * but the original scraper's downloadPhoto() hardcoded .png. Their server
 * returns 200 OK with a text/html error page for the wrong extension, which
 * sharp couldn't decode — so download silently failed and photoUrl got
 * cleared on the index. The downloader has since been fixed (see
 * scrape_mps.ts: downloadPhoto + Content-Type guard); this script repairs
 * the existing data.
 *
 * Usage:
 *   tsx scripts/parliament/backfill_missing_photos.ts
 *   tsx scripts/parliament/backfill_missing_photos.ts --dry-run
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";

const DATA_DIR = path.resolve(process.cwd(), "data/parliament");
const PROFILES_DIR = path.join(DATA_DIR, "profiles");
const PHOTOS_DIR = path.join(DATA_DIR, "photos");
const INDEX_FILE = path.join(DATA_DIR, "index.json");

const API = "https://www.parliament.bg/api/v1";
const PHOTO_BASE = "https://www.parliament.bg/images/Assembly/";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "X-Requested-With": "XMLHttpRequest",
  "Accept-Language": "bg,en;q=0.7",
};

const hasRealPhoto = (img: string | null | undefined): img is string =>
  !!img && !/blank/i.test(img);

const fetchJson = async <T>(url: string, attempt = 0): Promise<T | null> => {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      return fetchJson<T>(url, attempt + 1);
    }
    return null;
  }
};

const PHOTO_EXTS = ["png", "jpg", "jpeg"] as const;

const tryDownloadExt = async (url: string, file: string): Promise<boolean> => {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return false;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return false;
    const src = Buffer.from(await res.arrayBuffer());
    if (src.length < 100) return false;
    const out = await sharp(src).webp({ quality: 82 }).toBuffer();
    fs.writeFileSync(file, out);
    return true;
  } catch {
    return false;
  }
};

const downloadPhoto = async (
  id: number,
  file: string,
  filename?: string | null,
): Promise<boolean> => {
  if (filename && !/blank/i.test(filename)) {
    if (await tryDownloadExt(`${PHOTO_BASE}${filename}`, file)) return true;
  }
  for (const ext of PHOTO_EXTS) {
    if (await tryDownloadExt(`${PHOTO_BASE}${id}.${ext}`, file)) return true;
  }
  return false;
};

type IndexEntry = {
  id: number;
  name: string;
  photoUrl: string;
  isCurrent: boolean;
  scrapedAt: string;
  [k: string]: unknown;
};

type Index = {
  scrapedAt: string;
  currentNs: string;
  total: number;
  rawTotal: number;
  mps: IndexEntry[];
};

const localPhotoUrl = (id: number): string => `/parliament/photos/${id}.webp`;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as Index;
  const missing = index.mps.filter((m) => !m.photoUrl);
  console.log(`→ ${missing.length} MPs have empty photoUrl in index.json`);
  console.log(`  dry-run: ${dryRun}`);

  const concurrency = 8;
  let idx = 0;
  let probed = 0;
  let foundPhoto = 0;
  let downloaded = 0;
  let stillBlank = 0;
  let errors = 0;
  const recovered: { id: number; name: string; img: string }[] = [];

  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  fs.mkdirSync(PROFILES_DIR, { recursive: true });

  const next = async (): Promise<void> => {
    while (idx < missing.length) {
      const i = idx++;
      const mp = missing[i];
      probed++;
      type Raw = { A_ns_MP_id?: number; A_ns_MP_img?: string | null };
      const raw = await fetchJson<Raw>(`${API}/mp-profile/bg/${mp.id}`);
      if (!raw || !raw.A_ns_MP_id) {
        errors++;
        continue;
      }
      if (!hasRealPhoto(raw.A_ns_MP_img)) {
        stillBlank++;
        continue;
      }
      foundPhoto++;
      if (dryRun) {
        recovered.push({
          id: mp.id,
          name: mp.name,
          img: raw.A_ns_MP_img,
        });
        continue;
      }
      const file = path.join(PHOTOS_DIR, `${mp.id}.webp`);
      const ok = await downloadPhoto(mp.id, file, raw.A_ns_MP_img);
      if (ok) {
        downloaded++;
        mp.photoUrl = localPhotoUrl(mp.id);
        recovered.push({
          id: mp.id,
          name: mp.name,
          img: raw.A_ns_MP_img,
        });
        // Refresh the cached profile so the canonical scraper agrees.
        try {
          const profileFile = path.join(PROFILES_DIR, `${mp.id}.json`);
          const existing = fs.existsSync(profileFile)
            ? (JSON.parse(fs.readFileSync(profileFile, "utf8")) as Record<
                string,
                unknown
              >)
            : {};
          existing.A_ns_MP_img = raw.A_ns_MP_img;
          fs.writeFileSync(profileFile, JSON.stringify(existing));
        } catch {
          // non-fatal
        }
      } else {
        errors++;
      }
      if (probed % 50 === 0) {
        console.log(
          `  ${probed}/${missing.length}  found=${foundPhoto} dl=${downloaded} blank=${stillBlank} err=${errors}`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, next));

  console.log(`✓ probed:        ${probed}`);
  console.log(`  found photo:   ${foundPhoto}`);
  console.log(`  downloaded:    ${downloaded}`);
  console.log(`  still blank:   ${stillBlank}`);
  console.log(`  errors:        ${errors}`);

  if (!dryRun && downloaded > 0) {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index));
    console.log(`✓ rewrote ${INDEX_FILE}`);
  }

  if (recovered.length > 0) {
    console.log(`\n${dryRun ? "Would recover" : "Recovered"} photos:`);
    for (const r of recovered.slice(0, 50)) {
      console.log(`  ${r.id}  ${r.name}  ${r.img}`);
    }
    if (recovered.length > 50) {
      console.log(`  ... and ${recovered.length - 50} more`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
