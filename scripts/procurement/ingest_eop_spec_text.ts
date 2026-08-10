// Tier B of the tender dossier ingest — the ONE download per tender.
// docs/plans/tender-dossier-ingest-v1.md §5 (tier B).
//
// For each tender in the tier-A store, pick the техническа спецификация out of the
// attachment manifest, mint a 30-minute signed URL, download it to a temp file,
// extract the text, store the TEXT, and DELETE THE BYTES.
//
// ⚠️ THE BYTES ARE NEVER RETAINED, and that is a hard constraint, not a preference.
// The local disk has ~25 GB free against a 3.65 TB blob corpus; a 1 MB per-file cap
// on the announcement tier alone still landed at 81 GB (plan §12.1). Peak disk here
// is `concurrency × one file`, not the corpus.
//
// Scope, measured (plan §5): specs are 57 GB of transfer for ~68% of tenders and
// ~0.3 GB of extracted text — versus 2,574 GB for all attachments. That ratio is the
// entire reason this tier exists in this shape.
//
// What we give up by discarding bytes: any later improvement to the extractor costs
// another crawl. Accepted — but it is why `extractor` AND `extractor_version` are
// recorded per document, so a future pass can re-fetch only the rows an older
// extractor build actually handled. The name alone cannot identify those.
//
//   tsx scripts/procurement/ingest_eop_spec_text.ts --probe          # 200 tenders, dry
//   tsx scripts/procurement/ingest_eop_spec_text.ts --probe --apply
//   tsx scripts/procurement/ingest_eop_spec_text.ts --apply          # full, resumable

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { eopCall, mapPool, throttleSummary } from "./eop_api";
import { EopDossierStore } from "./eop_dossier_store";
import { pickSpec } from "./eop_doc_kind";
import { contentKey, isCached } from "./eop_spec_select";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.resolve(
  __dirname,
  "../../raw_data/procurement/eop_dossier.sqlite",
);

const CONCURRENCY = 4; // lower than tier A: each unit is a file transfer, not a 500 KB JSON

/** Hard ceiling per file. The export-ZIP tail runs to 313 MB and specs are p50 ~270 KB,
 *  so anything past this is not a spec in any useful sense — and one runaway download
 *  must not be able to fill the temp dir. Skipped files are RECORDED, not silent. */
const MAX_BYTES_DEFAULT = 64 * 1024 * 1024;

type SpecDoc = {
  Id: number;
  Name: string;
  Extension?: string | null;
  Size?: number;
  MD5Hash?: string;
};

type Counters = {
  considered: number;
  noSpec: number;
  cached: number;
  fetched: number;
  emptyText: number;
  tooBig: number;
  failed: number;
  bytes: number;
};

/** First non-empty line of a probe's combined output, capped. `|| null` maps "" to
 *  null so an empty probe is absent rather than an empty-string "version". */
const firstLine = (...parts: (string | undefined)[]): string | null =>
  parts.join("").trim().split("\n")[0]?.slice(0, 80) || null;

/** A version string has to contain a number. A usage banner or an error message
 *  does not — and storing one of those as a version is worse than storing null,
 *  because the column then reads as populated while carrying no information. */
const looksLikeVersion = (s: string): boolean => /\d+\.\d+/.test(s);

const probeVersion = async (bin: string): Promise<string | null> => {
  try {
    // ⚠️ textutil has NO version flag, and answers `-v` with its usage banner at
    // exit 0 — so the naive probe stores that banner for every textutil row, a
    // constant that is identical on every macOS release. Probe the OS build
    // instead, which is what actually changes textutil's behaviour.
    const [cmd, argv] =
      bin === "textutil" ? ["sw_vers", ["-productVersion"]] : [bin, ["-v"]];
    const { stdout, stderr } = await execFileP(
      cmd as string,
      argv as string[],
      {
        timeout: 10_000,
      },
    );
    const line = firstLine(stdout, stderr) ?? "";
    if (!looksLikeVersion(line)) return null;
    return bin === "textutil" ? `macOS ${line}` : line;
  } catch (e) {
    // An error message is not a version either — null beats a plausible lie.
    const err = e as { stdout?: string; stderr?: string };
    const line = firstLine(err.stdout, err.stderr) ?? "";
    return looksLikeVersion(line) ? line : null;
  }
};

/** Version of an external extractor, probed once per process. Recorded per row
 *  because the bytes are discarded (plan §12): without it, a pdftotext upgrade that
 *  changes output leaves no way to tell which rows need re-crawling.
 *
 *  Caches the PROMISE, not the value — the workers run concurrently, so caching
 *  after the await lets up to `CONCURRENCY` of them all miss and all spawn a probe. */
const versionCache = new Map<string, Promise<string | null>>();
const extractorVersion = (bin: string): Promise<string | null> => {
  let p = versionCache.get(bin);
  if (!p) versionCache.set(bin, (p = probeVersion(bin)));
  return p;
};

/** Extract text. `pdftotext` for PDFs (8.5% of real specs have no text layer),
 *  macOS `textutil` for Word (verified 5/5). Both are external — a missing binary is
 *  a FAILURE, never an empty extraction, or every doc on that machine would be
 *  recorded as "no text layer". */
const extractText = async (
  file: string,
  ext: string,
): Promise<{
  text: string;
  extractor: string;
  version: string | null;
  pages: number | null;
}> => {
  if (ext === ".pdf") {
    const { stdout } = await execFileP(
      "pdftotext",
      ["-enc", "UTF-8", file, "-"],
      { maxBuffer: 256 * 1024 * 1024, timeout: 120_000 },
    );
    let pages: number | null = null;
    try {
      const { stdout: info } = await execFileP("pdfinfo", [file], {
        timeout: 30_000,
      });
      pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? "") || null;
    } catch {
      /* pdfinfo is optional — its absence must not fail the extraction */
    }
    return {
      text: stdout,
      extractor: "pdftotext",
      version: await extractorVersion("pdftotext"),
      pages,
    };
  }
  const { stdout } = await execFileP(
    "textutil",
    ["-convert", "txt", "-stdout", file],
    { maxBuffer: 256 * 1024 * 1024, timeout: 120_000 },
  );
  return {
    text: stdout,
    extractor: "textutil",
    version: await extractorVersion("textutil"),
    pages: null,
  };
};

const main = async (args: {
  probe: boolean;
  apply: boolean;
  limit?: string;
  maxBytes: number;
}): Promise<void> => {
  const store = new EopDossierStore(STORE_FILE);
  if (!args.apply)
    console.log("(dry run — nothing is fetched or written; pass --apply)");

  // Work set comes from the tier-A store's manifests, not from the network.
  const specs: { tenderId: number; doc: SpecDoc }[] = [];
  for (const { subjectId, body } of store.iterate<{
    TenderDescriptionDocuments?: SpecDoc[];
  }>("details")) {
    const doc = pickSpec(body.TenderDescriptionDocuments ?? []);
    if (doc?.Id) specs.push({ tenderId: subjectId, doc: doc as SpecDoc });
  }
  const totalTenders = [...store.answeredIds("details")].length;
  const explicit = args.limit ? parseInt(args.limit, 10) : null;
  const cap =
    explicit && Number.isFinite(explicit) ? explicit : args.probe ? 200 : null;
  const work = cap ? specs.slice(0, cap) : specs;

  console.log(
    `→ ${totalTenders.toLocaleString()} tender(s) in the tier-A store; ` +
      `${specs.length.toLocaleString()} carry a spec-named extractable file ` +
      `(${((100 * specs.length) / (totalTenders || 1)).toFixed(0)}%)` +
      (cap ? ` — processing ${work.length.toLocaleString()}` : ""),
  );

  const c: Counters = {
    considered: work.length,
    noSpec: totalTenders - specs.length,
    cached: 0,
    fetched: 0,
    emptyText: 0,
    tooBig: 0,
    failed: 0,
    bytes: 0,
  };

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "eop-spec-"));

  await mapPool(work, CONCURRENCY, async ({ doc }, i) => {
    const md5 = (doc.MD5Hash ?? "").toLowerCase();
    // Resume on the register's own MD5 where it has one: the same bytes recur under
    // different documentIds (plan §9.1), so id-keyed resume would re-fetch
    // duplicates. When the manifest omits MD5Hash we cannot content-key BEFORE the
    // download, so fall back to the documentId — otherwise those entries would be
    // re-fetched on every single run.
    if (isCached(store, md5, doc.Id)) {
      c.cached++;
      return;
    }
    const size = doc.Size ?? 0;
    if (size > args.maxBytes) {
      c.tooBig++;
      if (args.apply)
        store.putDocTextFailure(
          doc.Id,
          md5 || null,
          "too_big",
          `${size} bytes > ${args.maxBytes}`,
        );
      return;
    }
    if (!args.apply) return;

    const ext = (doc.Extension ?? "").toLowerCase();
    const tmp = path.join(tmpRoot, `${doc.Id}${ext || ".bin"}`);
    try {
      const signed = await eopCall<{ Url?: string }>(
        "GetSignedUrlByDocumentId",
        { documentId: doc.Id },
      );
      if (!signed.ok || !signed.body?.Url) {
        c.failed++;
        store.putDocTextFailure(
          doc.Id,
          md5 || null,
          signed.ok ? "no_signed_url" : signed.reason,
          signed.ok ? undefined : signed.detail,
        );
        return;
      }
      const res = await fetch(signed.body.Url);
      if (!res.ok) {
        c.failed++;
        store.putDocTextFailure(
          doc.Id,
          md5 || null,
          "http",
          String(res.status),
        );
        return;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      c.bytes += buf.length;
      fs.writeFileSync(tmp, buf);

      const { text, extractor, version, pages } = await extractText(tmp, ext);
      if (text.trim().length === 0) c.emptyText++;
      store.putDocText({
        md5: contentKey(md5, buf),
        documentId: doc.Id,
        name: doc.Name,
        ext: ext || null,
        sizeBytes: buf.length,
        text,
        pages,
        extractor,
        extractorVersion: version,
      });
      c.fetched++;
    } catch (e) {
      // A throw here is a NON-answer (missing binary, timeout, corrupt file). It
      // must never be persisted as "extracted, no text" — that is the failure mode
      // the whole answers/failures split exists to prevent.
      c.failed++;
      store.putDocTextFailure(
        doc.Id,
        md5 || null,
        "extract",
        (e as Error).message.slice(0, 160),
      );
    } finally {
      // Delete the bytes. This is the point of the whole design.
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* best effort */
      }
    }
    if ((i + 1) % 200 === 0)
      console.log(
        `  … ${(i + 1).toLocaleString()}/${work.length.toLocaleString()} ` +
          `(${c.fetched.toLocaleString()} extracted, ${c.failed} failed, ${(c.bytes / 1073741824).toFixed(2)} GB pulled)`,
      );
  });

  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best effort */
  }

  console.log(
    `\n✓ considered ${c.considered.toLocaleString()} | extracted ${c.fetched.toLocaleString()} | ` +
      `cached ${c.cached.toLocaleString()} | no spec named ${c.noSpec.toLocaleString()} | ` +
      `too big ${c.tooBig} | no text layer ${c.emptyText} | failed ${c.failed}`,
  );
  console.log(
    `  transferred ${(c.bytes / 1073741824).toFixed(2)} GB — none of it retained`,
  );
  const throttled = throttleSummary();
  if (throttled) console.log(throttled);
  const s = store.stats();
  console.log(
    `  store: ${s.docText.toLocaleString()} doc text row(s) ` +
      `(${s.docTextEmpty.toLocaleString()} with no text layer), ${s.docTextFailed.toLocaleString()} failed`,
  );
  store.close();
};

const cli = command({
  name: "ingest_eop_spec_text",
  args: {
    probe: flag({
      type: optional(boolean),
      long: "probe",
      description: "First 200 specs only — check yield before the full pass.",
      defaultValue: () => false,
    }),
    apply: flag({
      type: optional(boolean),
      long: "apply",
      description: "Fetch and extract (omit to report the work set only).",
      defaultValue: () => false,
    }),
    limit: option({
      type: optional(string),
      long: "limit",
      description: "Cap the number of specs processed.",
    }),
    maxBytes: option({
      type: optional(string),
      long: "max-bytes",
      description: `Skip files larger than this many bytes (default ${MAX_BYTES_DEFAULT}).`,
    }),
  },
  handler: (args) => {
    const parsed = args.maxBytes ? parseInt(args.maxBytes, 10) : NaN;
    return main({
      probe: !!args.probe,
      apply: !!args.apply,
      limit: args.limit,
      maxBytes: Number.isFinite(parsed) ? parsed : MAX_BYTES_DEFAULT,
    });
  },
});

run(cli, process.argv.slice(2));
