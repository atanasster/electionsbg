// Fetch NOI B1 per-fund cash-execution XLS files from nssi.bg into
// raw_data/budget/noi/.
//
// nssi.bg 302-redirects B1 GET requests to its homepage for most clients
// (HEAD returns 200 with the real content-length — that's what the nssi_b1
// watcher fingerprints — but GET bounces). Sending a Referer of the
// "отчети и баланси" listing page the files are linked from defeats the
// redirect and serves the real BIFF8 body. We validate the OLE2 magic bytes so
// a stray redirect landing (the HTML homepage) is never written out as a .xls.

import fs from "fs";
import path from "path";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget/1.0; +https://electionsbg.com)";
// The public listing page that links the B1 files — required as Referer or the
// server 302s the download to its homepage.
const REFERER =
  "https://www.nssi.bg/budjet-i-finansi/otkrito-upravlenie/otcheti-i-balansi/";
// OLE2 / BIFF8 (legacy .xls) magic — D0 CF 11 E0 A1 B1 1A E1.
const OLE2_MAGIC = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

const mm = (month: number): string => String(month).padStart(2, "0");

export const b1FileName = (year: number, month: number, fund: string): string =>
  `B1_${year}_${mm(month)}_${fund}.xls`;

export const b1Url = (year: number, month: number, fund: string): string =>
  `https://www.nssi.bg/wp-content/uploads/${b1FileName(year, month, fund)}`;

export type B1FetchResult = "saved" | "unchanged" | "unavailable";

/** Download one B1 file into destDir, overwriting only when the bytes differ.
 *  Returns 'unavailable' when the server redirects (file not yet published for
 *  that month) or serves non-OLE2 content — the caller keeps any existing cache
 *  and moves on. Never writes a partial/HTML body. */
export const fetchB1File = async (
  year: number,
  month: number,
  fund: string,
  destDir: string,
): Promise<B1FetchResult> => {
  let res: Response;
  try {
    res = await fetch(b1Url(year, month, fund), {
      headers: { "User-Agent": UA, Referer: REFERER, Accept: "*/*" },
      redirect: "follow",
    });
  } catch {
    return "unavailable";
  }
  if (!res.ok) return "unavailable";
  const body = Buffer.from(await res.arrayBuffer());
  // A redirect that slipped through lands on the HTML homepage — reject anything
  // that isn't a real OLE2 workbook.
  if (body.length < 512 || !body.subarray(0, 8).equals(OLE2_MAGIC))
    return "unavailable";
  const dest = path.join(destDir, b1FileName(year, month, fund));
  if (fs.existsSync(dest) && fs.readFileSync(dest).equals(body))
    return "unchanged";
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(dest, body);
  return "saved";
};
