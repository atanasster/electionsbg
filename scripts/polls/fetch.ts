// `npm run polls:fetch` — Tier 2, T2a (docs/plans/polls-agency-watchers-v1.md
// §6.2, decisions 7, 13, 17). For each electoral publication newer than the
// last ingest: save the page HTML, every PDF attachment, and (Sova Harris)
// the bulletin images under `raw_data/polls/<agency>/<pubId>/`, with a
// `SOURCE.json` stamp. Skips an already-captured `pubId` unless `--force`;
// a changed hash on a forced re-fetch is captured as `.v2` (or `.v3`, …).
//
//   npm run polls:fetch                       # every pending site item, all 7 fetchable agencies
//   npm run polls:fetch -- --agency TR        # just Trend
//   npm run polls:fetch -- --agency TR --pub 1052
//   npm run polls:fetch -- --since 2026-01-01 --agency GIB   # backlog walk, past what the watcher tracks
//   npm run polls:fetch -- --url <outletArticleUrl> --agency MD   # third-party press capture (decision 2)
//   npm run polls:fetch -- --archive <waybackUrl> --agency AR     # decision 17
//   npm run polls:fetch -- --force            # re-check every pending item's hash, version if changed
//
// The watcher never opens an individual post or PDF (the "one request per
// source" rule) — that request is this command's job, which is also why a
// lister's `Publication.publishedAt` can be null (AR) and gets filled in
// here from the captured page, at extraction time (Tier 2, T2b — not this
// file).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchText } from "../watch/fingerprint";
import { UA } from "./agencies/wp_lister";
import { agencyById } from "./lib/agencies";
import {
  type CaptureTarget,
  FETCHABLE_SITE_AGENCIES,
  backlogTargets,
  captureDir,
  combinedSha256,
  discoverPdfLinks,
  discoverSovaHarrisBulletinImages,
  latestVersionSuffix,
  nextVersionSuffix,
  pendingPressNotices,
  pendingSiteTargets,
  targetFromArchive,
  targetFromUrl,
} from "./lib/capture";

const PROD_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let REPO_ROOT = PROD_REPO_ROOT;

/** TEST-ONLY seam: redirect writes to a scratch directory instead of the
 *  real repo tree. Production code never calls this. Pass no argument (or
 *  `undefined`) to restore the real repo root — `fetch.test.ts`'s `afterEach`
 *  does this, matching `scripts/council/lib/fetch.ts`'s `__setTimingForTests`
 *  convention, so a later test added to this file (or a reorder) cannot
 *  silently inherit a deleted scratch directory. */
export const __setCaptureRootForTests = (root?: string): void => {
  REPO_ROOT = root ?? PROD_REPO_ROOT;
};

interface SourceStamp {
  url: string;
  fetchedAt: string;
  sha256: string;
  bytes: number;
  archiveUrl?: string;
  /** Attachment URLs `discoverPdfLinks`/`discoverSovaHarrisBulletinImages`
   *  found but could not fetch — e.g. Market Links' `/storage/` PDFs
   *  currently answer every request (curl, Node, no UA/Referer variation
   *  helped) with a bare WAF `403`, measured live 2026-09-09. Present only
   *  when non-empty, so a capture with every attachment fetched carries no
   *  such key at all and cannot be mistaken for "checked, found none". */
  attachmentFailures?: string[];
}

// `fetchText` (scripts/watch/fingerprint.ts) times out and retries transient
// 5xx failures; a bare `fetch()` here would let one hung PDF connection block
// the whole capture indefinitely (every attachment is awaited via
// `Promise.all`) or one transient 5xx abort an otherwise-good capture. Same
// 30 s ceiling, one retry for a transient 5xx — attachments are a courtesy
// fetch alongside the page that already succeeded, not worth the page's own
// 3-retry budget.
//
// ⚠️ A NON-5xx failure and a genuine timeout must NOT retry. A 403 (Market
// Links' `/storage/` PDFs — a bare WAF block, measured live 2026-09-09: curl,
// Node, with or without Referer/browser headers, all get the identical
// response) is PERMANENT — retrying just hits the same block twice on a site
// already documented elsewhere as sensitive to repeated requests. And an
// `AbortSignal.timeout` firing means the server is unresponsive, not
// transiently failing — the same distinction `fetchText` already makes.
const FETCH_BINARY_TIMEOUT_MS = 30_000;

const fetchBinary = async (url: string): Promise<Uint8Array> => {
  for (let attempt = 0; attempt <= 1; attempt++) {
    // The fetch CALL itself (network error, DNS failure, a genuine timeout)
    // is the only thing this try/catch guards — deliberately narrower than
    // wrapping the whole iteration, because throwing for a PERMANENT
    // response status (below, outside this block) must propagate straight
    // out on attempt 0 rather than being caught by this same catch and
    // silently retried, which is the exact bug a wider try introduced here
    // once (a 403 got fetched twice before this was narrowed).
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(FETCH_BINARY_TIMEOUT_MS),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw e; // never retry a timeout
      if (attempt === 1) throw e;
      continue; // a network-level error — retry once
    }
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    if (res.status >= 500 && attempt === 0) continue; // transient — retry once
    throw new Error(`HTTP ${res.status} fetching ${url}`); // permanent — fail now
  }
  throw new Error(`unreachable: ${url}`); // satisfies the return type; the loop above always returns or throws
};

interface AttachmentResult {
  url: string;
  bytes: Uint8Array | null;
  error?: string;
}

/** Fetches every URL independently — one failed attachment (a dead link, a
 *  WAF block) must not lose the page HTML and every OTHER attachment that
 *  DID succeed. */
const fetchAttachments = (urls: string[]): Promise<AttachmentResult[]> =>
  Promise.all(
    urls.map(async (url): Promise<AttachmentResult> => {
      try {
        return { url, bytes: await fetchBinary(url) };
      } catch (e) {
        return {
          url,
          bytes: null,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

/** A basename derived from `url`, disambiguated against every name already
 *  used IN THIS CAPTURE — two distinct attachments (e.g. `/2025/report.pdf`
 *  and `/2026/report.pdf`) sharing a basename would otherwise silently
 *  clobber one another on disk despite `discoverPdfLinks` correctly treating
 *  them as two separate URLs. */
const filenameFor = (
  url: string,
  kind: "pdf" | "image",
  index: number,
  used: Set<string>,
): string => {
  let name: string | null = null;
  try {
    const base = path.basename(new URL(url).pathname);
    if (base) name = base;
  } catch {
    // malformed URL — fall through to the generic name
  }
  name ??= kind === "pdf" ? `attachment-${index}.pdf` : `bulletin-${index}.jpg`;
  if (used.has(name)) {
    const ext = path.extname(name);
    name = `${path.basename(name, ext)}-${index}${ext}`;
  }
  used.add(name);
  return name;
};

const readStamp = (dir: string): SourceStamp | null => {
  const file = path.join(REPO_ROOT, dir, "SOURCE.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as SourceStamp;
};

/**
 * Capture one publication. Four possible outcomes:
 *  - SKIP — already captured and `force` is false; nothing is fetched.
 *  - UNCHANGED — `force` is true, the re-fetch's combined hash matches the
 *    latest existing version's; nothing is (re)written.
 *  - FRESH CAPTURE — nothing exists yet at `baseDir`; writes with no suffix.
 *  - NEW VERSION — `force` is true and the hash changed; writes to the next
 *    unused `.vN` suffix, leaving every earlier version untouched.
 */
const captureOne = async (
  target: CaptureTarget,
  force: boolean,
): Promise<void> => {
  const baseDir = captureDir(target.agencyId, target.pubId);
  const exists = (suffix: string) =>
    fs.existsSync(path.join(REPO_ROOT, `${baseDir}${suffix}`, "SOURCE.json"));
  const latest = latestVersionSuffix(exists);

  if (latest !== null && !force) {
    console.log(
      `skip ${target.agencyId} ${target.pubId} — already captured (${baseDir}${latest})`,
    );
    return;
  }

  console.log(
    `fetching ${target.agencyId} ${target.pubId} — ${target.fetchUrl}`,
  );
  const html = await fetchText(target.fetchUrl, {
    headers: { "User-Agent": UA },
  });
  if (html === null) throw new Error(`empty response: ${target.fetchUrl}`);

  const pdfUrls = discoverPdfLinks(html, target.fetchUrl);
  const imageUrls =
    target.agencyId === "SH" ? discoverSovaHarrisBulletinImages(html) : [];
  const [pdfResults, imageResults] = await Promise.all([
    fetchAttachments(pdfUrls),
    fetchAttachments(imageUrls),
  ]);
  const failures = [...pdfResults, ...imageResults].filter((r) => r.error);
  for (const f of failures)
    console.error(`  attachment FAILED: ${f.url} — ${f.error}`);

  const okBytes = (rs: AttachmentResult[]): Uint8Array[] =>
    rs.filter((r) => r.bytes !== null).map((r) => r.bytes!);
  const newHash = combinedSha256(html, [
    ...okBytes(pdfResults),
    ...okBytes(imageResults),
  ]);

  if (latest !== null && readStamp(`${baseDir}${latest}`)?.sha256 === newHash) {
    console.log(
      `unchanged ${target.agencyId} ${target.pubId} — same content as ${baseDir}${latest}, no re-capture`,
    );
    return;
  }

  const suffix = nextVersionSuffix(exists);
  const outDir = path.join(REPO_ROOT, `${baseDir}${suffix}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "page.html"), html, "utf8");
  const usedNames = new Set<string>(["page.html", "SOURCE.json"]);
  let attachmentBytes = 0;
  pdfResults.forEach((r, i) => {
    if (!r.bytes) return;
    fs.writeFileSync(
      path.join(outDir, filenameFor(r.url, "pdf", i, usedNames)),
      r.bytes,
    );
    attachmentBytes += r.bytes.byteLength;
  });
  imageResults.forEach((r, i) => {
    if (!r.bytes) return;
    fs.writeFileSync(
      path.join(outDir, filenameFor(r.url, "image", i, usedNames)),
      r.bytes,
    );
    attachmentBytes += r.bytes.byteLength;
  });

  const totalBytes = Buffer.byteLength(html, "utf8") + attachmentBytes;
  const stamp: SourceStamp = {
    url: target.originalUrl,
    fetchedAt: new Date().toISOString(),
    sha256: newHash,
    bytes: totalBytes,
    ...(target.archiveUrl ? { archiveUrl: target.archiveUrl } : {}),
    ...(failures.length > 0
      ? { attachmentFailures: failures.map((f) => f.url) }
      : {}),
  };
  fs.writeFileSync(
    path.join(outDir, "SOURCE.json"),
    JSON.stringify(stamp, null, 2) + "\n",
    "utf8",
  );

  const pdfOk = pdfResults.length - pdfResults.filter((r) => r.error).length;
  const imageOk =
    imageResults.length - imageResults.filter((r) => r.error).length;
  console.log(
    `captured ${target.agencyId} ${target.pubId}${suffix} — ${pdfOk}/${pdfResults.length} pdf(s), ${imageOk}/${imageResults.length} image(s), ${totalBytes} bytes` +
      (failures.length > 0 ? ` (${failures.length} attachment FAILED)` : ""),
  );
};

export interface Opts {
  /** ISO date — a backlog walk past what the watcher currently tracks,
   *  reading the agency's own lister directly instead of watch state. */
  since?: string;
  /** A registry id (e.g. "TR") — scopes every path to one agency. */
  agency?: string;
  /** Narrows the resolved target list to one pubId (site items only). */
  pub?: string;
  /** A resolved, fetchable outlet article URL — the third-party press path
   *  (decision 2); requires `agency`. */
  url?: string;
  /** A Wayback Machine snapshot URL of the agency's OWN page (decision 17);
   *  requires `agency`. Combine with `url` to also record the canonical
   *  original address when it cannot be recovered from the snapshot URL
   *  itself. */
  archive?: string;
  /** Re-check every already-captured pubId's hash, writing a new version
   *  when it changed, instead of skipping it outright. */
  force: boolean;
}

export const parseArgv = (argv: string[]): Opts => {
  // A flag with no value (trailing, or immediately followed by another
  // `--flag`) resolves to `undefined` rather than swallowing the next
  // flag's own name as its value — `--agency --force` must not set
  // `agency: "--force"`.
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    return v !== undefined && !v.startsWith("--") ? v : undefined;
  };
  return {
    since: flag("since"),
    agency: flag("agency"),
    pub: flag("pub"),
    url: flag("url"),
    archive: flag("archive"),
    force: argv.includes("--force"),
  };
};

export const main = async (argv: string[]): Promise<void> => {
  const opts = parseArgv(argv);

  if (opts.agency && !agencyById(opts.agency)) {
    console.error(
      `unknown --agency "${opts.agency}" — not in the agency registry`,
    );
    process.exitCode = 1;
    return;
  }

  // A Wayback snapshot of the agency's OWN page (decision 17) — checked
  // BEFORE `--url` alone, because `--archive --url` together is a supported
  // combination (`--url` supplies the canonical original address
  // alongside the snapshot); routing through the `--url`-only branch first
  // would fetch the LIVE url instead of the archived one and drop
  // `archiveUrl` from the provenance stamp entirely.
  if (opts.archive) {
    if (!opts.agency) {
      console.error("--archive needs --agency <ID>");
      process.exitCode = 1;
      return;
    }
    try {
      await captureOne(
        targetFromArchive(opts.agency, opts.archive, opts.url, opts.pub),
        opts.force,
      );
    } catch (e) {
      console.error(
        `FAILED ${opts.agency} (archive): ${e instanceof Error ? e.message : String(e)}`,
      );
      process.exitCode = 1;
    }
    return;
  }

  // Third-party press capture (decision 2, §6.2's "press" row): the
  // operator has already resolved a Google-News-discovered item to a real,
  // fetchable outlet URL — this module cannot do that itself (see
  // pendingPressNotices below).
  if (opts.url) {
    if (!opts.agency) {
      console.error(
        "--url needs --agency <ID> — which agency this article covers",
      );
      process.exitCode = 1;
      return;
    }
    try {
      await captureOne(targetFromUrl(opts.agency, opts.url), opts.force);
    } catch (e) {
      console.error(
        `FAILED ${opts.agency} (url): ${e instanceof Error ? e.message : String(e)}`,
      );
      process.exitCode = 1;
    }
    return;
  }

  const agencies = opts.agency ? [opts.agency] : [...FETCHABLE_SITE_AGENCIES];
  let targets: CaptureTarget[] = [];

  let anyFailed = false;

  for (const agencyId of agencies) {
    if (opts.since) {
      // Isolated per agency — the sibling watcher sources (polls_gallup.ts,
      // polls_press.ts) already establish "one agency's failure never stops
      // the rest" for this exact class of network call, and a plain
      // multi-agency `--since` walk (the common case) must not die on the
      // first unreachable site (Gallup's own has had broken TLS since
      // 2026-09-05).
      try {
        const backlog = await backlogTargets(agencyId, opts.since);
        if (backlog === null) {
          console.log(
            `${agencyId} has no site to walk a backlog against — press-only agencies need --url per item (see below)`,
          );
          continue;
        }
        targets.push(...backlog);
      } catch (e) {
        console.error(
          `${agencyId}: backlog walk failed — ${e instanceof Error ? e.message : String(e)}`,
        );
        anyFailed = true;
      }
    } else {
      const pending = pendingSiteTargets(agencyId);
      if (pending === null) {
        console.log(
          `${agencyId} has no fetchable watcher — press-only agencies need --url per item (see below)`,
        );
        continue;
      }
      targets.push(...pending);
    }
  }

  if (opts.pub) targets = targets.filter((t) => t.pubId === opts.pub);

  if (targets.length === 0) console.log("nothing pending to capture");

  for (const target of targets) {
    try {
      await captureOne(target, opts.force);
    } catch (e) {
      console.error(
        `FAILED ${target.agencyId} ${target.pubId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      anyFailed = true;
    }
  }

  if (anyFailed) process.exitCode = 1;

  // Gallup's press arm and every press-only agency's items are watched but
  // never auto-fetchable (google_news_rss.ts's header) — surface them so an
  // operator knows what to go resolve on the outlet next.
  if (!opts.agency) {
    const notices = pendingPressNotices();
    if (notices.length > 0) {
      console.log(
        `\n${notices.length} press item(s) need a manual --url capture:`,
      );
      for (const n of notices)
        console.log(
          `  ${n.agencyId}  ${n.title}  (${n.sourceName ?? "unknown outlet"}, ${n.pubDate})`,
        );
    }
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
