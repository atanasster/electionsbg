// Shared downloader for the two ИСУН 2020 public XLSX exports (Beneficiary +
// Project). Both endpoints return the current state of the register on every
// call, so we always fetch fresh and stash a snapshot for offline `--file`
// re-ingest.
//
// WHY THIS EXISTS AS A SHARED MODULE, and not two bare `fetch()` calls:
// 2020.eufunds.bg sits behind an F5 BIG-IP WAF that intermittently refuses a
// request with a ~245-byte "Request Rejected" HTML page served as **HTTP 200**.
// `res.ok` is therefore blind to it, and before this module the body flowed
// straight into the XLSX parser and resurfaced as "header row not found" —
// which reads as upstream schema drift and sends the operator to parse.ts,
// the wrong file entirely.
//
// The refusal is STATEFUL/rate-based, not a permanent client block: measured
// 2026-08-05, the watcher's plain fetch succeeded at 06:08, a cookie-jar curl
// succeeded at 14:40, and by 15:20 BOTH node and curl were refused from the
// same host — i.e. repeated probing tripped it, and it clears on its own. So
// the correct response is a bounded retry, NOT a fancier client (shelling out
// to curl was tried and fails identically once the WAF is tripped).
//
// ⚠️ [2026-09-02] That still describes the RATE-BASED mode, but it is no longer
// the whole picture, and the "not a fancier client" conclusion does not hold
// today. Measured this date, repeatedly and hours apart:
//
//   node fetch — the warm-up + cookie-jar path below, i.e. the most
//     browser-like request this module can make — is refused EVERY time, with
//     the 245-byte "Request Rejected" or the ASM JS challenge. On the sibling
//     listing endpoint the watcher had been refused on all 13 daily runs since
//     2026-08-20, never once succeeding.
//   curl — same URL, same headers, NO cookie jar — returns the real thing:
//     2,503,399-byte Beneficiary XLSX and 9,999,672-byte Project XLSX, correct
//     MIME, "PK" magic.
//
// Node loses under every header shape tried (source headers, Accept: */*, a
// full Chrome set, even curl's own UA); curl wins without trying. That is a
// TLS/HTTP handshake fingerprint (JA3), which no header can change.
//
// So the fallback below is ADDITIVE: node first, because when it works it is
// the cheaper path and the August note's rate-based mode is real; curl second,
// because a client-fingerprint refusal is not something retrying fixes. This is
// what removed the "both exports operator-downloaded" step the 2026-08-31
// ingest recorded.

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

// A browser UA, because the WAF scores the request. Kept generic — the point is
// to look ordinary, not to impersonate a specific build.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ACCEPT_LANGUAGE = "bg-BG,bg;q=0.9,en;q=0.8";
const HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9," +
  "image/avif,image/webp,*/*;q=0.8";

/** Backoff between attempts, ms. Bounded on purpose: an operator who is being
 *  refused for longer than this is better served by `--file` than by a script
 *  that hangs for ten minutes. */
const RETRY_DELAY_MS = [5_000, 20_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `name=value` pairs from a response's Set-Cookie headers, ready to send back. */
const cookieHeader = (res: Response): string =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

/** An XLSX is a zip, so it opens "PK". The WAF refusal is small HTML. */
const looksLikeXlsx = (buf: Buffer): boolean =>
  buf.length >= 1024 && buf.subarray(0, 2).toString("latin1") === "PK";

/**
 * The same GET through the `curl` binary. No shell: execFile-style argv.
 *
 * ⚠️ It sends NO `Referer`, and that is not an oversight — it is the second of
 * two independent triggers, isolated 2026-09-02:
 *
 *   curl, no Referer    -> 2,503,303-byte XLSX
 *   curl, with Referer  -> 245-byte "Request Rejected"
 *   node, no Referer    -> 245-byte "Request Rejected"
 *   node, with Referer  -> 245-byte "Request Rejected"
 *
 * So the WAF refuses the node CLIENT whatever it sends, and refuses ANY client
 * that sends a Referer on this endpoint — including the one the browser-shaped
 * node path above sets deliberately. The first cut of this fallback copied that
 * Referer across and was refused for the second reason while trying to fix the
 * first.
 */
const curlDownload = (exportUrl: string): Buffer => {
  const res = spawnSync(
    "curl",
    [
      "-sSL",
      "--compressed",
      "--max-time",
      "300",
      "-H",
      `User-Agent: ${UA}`,
      "-H",
      `Accept-Language: ${ACCEPT_LANGUAGE}`,
      exportUrl,
    ],
    { maxBuffer: 256 * 1024 * 1024, encoding: "buffer" },
  );
  if (res.error) throw res.error;
  if (res.status !== 0)
    throw new Error(
      `curl exited ${res.status}: ${(res.stderr?.toString() ?? "").trim()}`,
    );
  return Buffer.from(res.stdout);
};

const attemptDownload = async (exportUrl: string): Promise<Buffer> => {
  // Mint a session on the listing page the export button lives on, and carry
  // its cookies. This is what a browser does, and it is what the WAF expects.
  const listingUrl = exportUrl.replace(/\/ExportToExcel$/, "");
  const warm = await fetch(listingUrl, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": ACCEPT_LANGUAGE,
      Accept: HTML_ACCEPT,
    },
  });
  const cookie = cookieHeader(warm);

  const res = await fetch(exportUrl, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": ACCEPT_LANGUAGE,
      Referer: listingUrl,
      Accept: "*/*",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${exportUrl} → ${res.status} ${res.statusText}`);
  }
  const viaNode = Buffer.from(await res.arrayBuffer());
  if (looksLikeXlsx(viaNode)) return viaNode;

  // Node was refused. Retrying the same client only helps the rate-based mode;
  // try the one that is known to get through a fingerprint block before the
  // caller spends its backoff.
  console.warn(
    `  node fetch refused (${viaNode.length} bytes, not an XLSX) — retrying via curl`,
  );
  try {
    return curlDownload(exportUrl);
  } catch (e) {
    console.warn(`  curl also failed: ${(e as Error).message}`);
    return viaNode;
  }
};

/**
 * Download one ИСУН export, retrying past a transient WAF refusal, and refuse
 * to return anything that is not an XLSX.
 */
export const downloadIsunExport = async (
  exportUrl: string,
  snapshotFile: string,
): Promise<Buffer> => {
  let buf: Buffer | undefined;

  for (let attempt = 0; ; attempt++) {
    buf = await attemptDownload(exportUrl);
    if (looksLikeXlsx(buf)) break;
    if (attempt >= RETRY_DELAY_MS.length) break;
    const wait = RETRY_DELAY_MS[attempt];
    console.warn(
      `  WAF refused the export (${buf.length} bytes, not an XLSX) — ` +
        `retrying in ${wait / 1000}s (attempt ${attempt + 2}/${RETRY_DELAY_MS.length + 1})`,
    );
    await sleep(wait);
  }

  if (!looksLikeXlsx(buf)) {
    const head = buf
      .subarray(0, 200)
      .toString("utf8")
      .replace(/\s+/g, " ")
      .trim();
    throw new Error(
      `${exportUrl} did not return an XLSX after ${RETRY_DELAY_MS.length + 1} ` +
        `attempt(s) (${buf.length} bytes). The F5 WAF is refusing this host — it ` +
        `clears on its own, so retry later, or download the export in a browser ` +
        `and re-run with --file. Body starts: ${head}`,
    );
  }

  // Persist a snapshot so this run can be reproduced offline via `--file`.
  // Fire-and-forget — a failed write only loses that convenience.
  try {
    fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
    fs.writeFileSync(snapshotFile, buf);
  } catch (e) {
    console.warn(`  snapshot write failed: ${(e as Error).message}`);
  }
  return buf;
};
