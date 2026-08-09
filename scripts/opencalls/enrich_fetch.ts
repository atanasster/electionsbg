// Stage 7, step 1 — fetch an ИСУН procedure document and get its text out.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// EVERYTHING HERE IS MEASURED, not assumed. The plan flagged the file format as unverified and
// said to probe before writing an extractor; this is what the probe found on 2026-08-09, against
// live `eumis2020.government.bg`:
//
//   1. THE `InfoDownload?fileKey=` URL IS A 302, and the redirect is the whole download. It goes
//      to `files2020.government.bg/<blob>?access_token=<JWT>`, and the JWT carries a short `exp`
//      — so the link cannot be stored and re-used later, and a fetch without `redirect: follow`
//      gets an empty body and a 302 that looks like a soft failure.
//   2. `Content-Type` IS ALWAYS `application/octet-stream`. It types nothing. The real name is in
//      `Content-Disposition` (URL-encoded, `filename*=UTF-8''…`), and the real FORMAT is only in
//      the magic bytes.
//   3. THREE FORMATS, and the plan anticipated two:
//        %PDF (25504446)  — „Условия за кандидатстване", 50–52 pages
//        PK\x03\x04       — .docx („Обява", and other „Условия")
//        \xd0\xcf\x11\xe0 — LEGACY .doc, an OLE2 compound file („Покана"). Not anticipated, and
//                           `unzip` cannot read it, so it must be recognised rather than fed to
//                           the docx reader and failing as „corrupt zip".
//   4. „УСЛОВИЯ ЗА КАНДИДАТСТВАНЕ" IS NOT AN ARCHIVE. The plan expected a ZIP/RAR bundle; all
//      four sampled were single PDFs or DOCX. Archive handling is still here as a skip-with-
//      reason, because „Приложения" plausibly is one — but it is not the common case.
//
// A ZIP CONTAINER IS AMBIGUOUS BY CONSTRUCTION: `PK\x03\x04` is both .docx and .zip. The
// discriminator is the filename, which is why the name is parsed rather than ignored.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// DOCUMENT CHOICE IS A PREFERENCE ORDER, not a single label. The plan says to prefer the short
// „Обява за откриване на процедурата" over the multi-annex „Условия" — right in principle, but
// measured over the 55 live procedures „Обява" exists on only 7 while „Условия за кандидатстване"
// is on 26. A single-label rule would leave four fifths of the corpus unenriched, so the order
// falls back through what ИСУН actually publishes.

import { extractDocxText } from "../council/lib/docx";
import { extractPdfText, looksLikeScannedPdf } from "../council/lib/pdf_text";

const UA = "electionsbg-opencalls/1.0 (+https://electionsbg.com)";
const TIMEOUT_MS = 120_000;
/** Measured: the largest sampled document was 398 KB. 64 MB is far above anything ИСУН
 *  publishes and far below anything that would matter to this process. */
const MAX_DOC_BYTES = 64_000_000;

/** Shortest and most on-point first. Measured coverage over the 55 live procedures in brackets. */
export const DOC_PREFERENCE: readonly string[] = [
  "Обява", // [7]  the short announcement the plan prefers
  "Покана", // [8]  its equivalent for a named-beneficiary procedure
  "Условия за кандидатстване", // [26] the long one; where the money and eligibility actually are
  "Насоки за кандидатстване",
  "Заповед", // [7]  usually just approves the Насоки, but carries the figures often enough
];

export type DocKind = "pdf" | "docx" | "doc" | "archive" | "unknown";

export interface FetchedDoc {
  url: string;
  label: string;
  /** From `Content-Disposition`, percent-decoded. Empty when the header is absent. */
  filename: string;
  kind: DocKind;
  bytes: number;
  /** Absent for a kind we cannot read; `skipReason` says why. */
  text?: string;
  skipReason?: string;
}

/** The one document to enrich from, or null when a procedure publishes none we can use. */
export const pickDoc = (
  docs: { label: string; url: string }[],
): { label: string; url: string } | null => {
  for (const want of DOC_PREFERENCE) {
    // startsWith, not equality: ИСУН appends qualifiers („Условия за кандидатстване - изменени").
    const hit = docs.find((d) => (d.label ?? "").trim().startsWith(want));
    if (hit) return hit;
  }
  return null;
};

/**
 * Format from the MAGIC BYTES, with the filename as the tie-break.
 *
 * Content-Type is useless here (always octet-stream) and the extension alone is not trustworthy
 * either — but a ZIP container is genuinely ambiguous between .docx and a real archive, and only
 * the name can settle that.
 */
export const sniffKind = (buf: Buffer, filename: string): DocKind => {
  const name = filename.toLowerCase();
  if (buf.length >= 4) {
    const m = buf.subarray(0, 4).toString("hex");
    if (m === "25504446") return "pdf"; // %PDF
    if (m === "d0cf11e0") return "doc"; // OLE2 compound — legacy Word
    if (m.startsWith("504b03")) {
      // PK: .docx and .zip are the same container. The name decides.
      if (name.endsWith(".docx")) return "docx";
      if (name.endsWith(".zip")) return "archive";
      // An OOXML package always has [Content_Types].xml at the very start of the archive; a
      // plain zip of PDFs does not. Cheap discriminator when the name is missing or unhelpful.
      return buf.subarray(0, 2000).includes(Buffer.from("[Content_Types].xml"))
        ? "docx"
        : "archive";
    }
    if (m.startsWith("52617221")) return "archive"; // Rar!
    if (m.startsWith("377abcaf")) return "archive"; // 7z
  }
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".doc")) return "doc";
  return "unknown";
};

/** `Content-Disposition` → a plain filename. ИСУН sends both the ASCII and the RFC 5987 form. */
export const filenameFrom = (header: string | null): string => {
  if (!header) return "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  const plain = /filename="([^"]*)"/i.exec(header)?.[1];
  const raw = star ?? plain ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed percent-escape must not take the whole fetch down; the name is a hint, and
    // `sniffKind` reads the magic bytes first anyway.
    return raw;
  }
};

/**
 * Download one document and extract its text.
 *
 * NEVER THROWS on a document we simply cannot read — an archive, a scanned PDF, a legacy .doc —
 * because a procedure we cannot enrich must leave the pipeline with a REASON rather than abort a
 * run over the other fifty-four. A network or HTTP failure does throw: that is worth retrying,
 * and silently treating it as „unreadable" would let a bad day look like a bad corpus.
 */
export const fetchDoc = async (doc: {
  label: string;
  url: string;
}): Promise<FetchedDoc> => {
  const res = await fetch(doc.url, {
    // FOLLOW. The InfoDownload URL is a 302 to a signed, short-lived blob URL — without this the
    // body is empty and the failure looks like an empty document rather than a missing redirect.
    redirect: "follow",
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok)
    throw new Error(`${doc.label}: HTTP ${res.status} ${res.statusText}`);

  const filename = filenameFrom(res.headers.get("content-disposition"));
  // A declared length over the cap is refused BEFORE the body is read. ИСУН is a government
  // host rather than a hostile one, but this runs unattended against a URL from a crawl, and
  // `arrayBuffer()` buffers whatever arrives into this process with no ceiling of its own.
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_DOC_BYTES)
    return {
      url: doc.url,
      label: doc.label,
      filename,
      kind: "unknown",
      bytes: declared,
      skipReason: `document is ${(declared / 1e6).toFixed(1)} MB, over the ${MAX_DOC_BYTES / 1e6} MB cap`,
    };
  const buf = Buffer.from(await res.arrayBuffer());
  const kind = sniffKind(buf, filename);
  const base: FetchedDoc = {
    url: doc.url,
    label: doc.label,
    filename,
    kind,
    bytes: buf.length,
  };

  if (buf.length === 0)
    return {
      ...base,
      skipReason: "empty body — the redirect was probably not followed",
    };

  if (kind === "archive")
    return {
      ...base,
      skipReason:
        "archive (zip/rar/7z) — extracting the right member is a separate problem; enrich from a single-file document instead",
    };
  if (kind === "doc")
    return {
      ...base,
      // Legacy OLE2. `unzip` cannot open it and there is no reader for it in this repo, so it is
      // named rather than crashed on. Measured: „Покана" arrives this way.
      skipReason:
        "legacy .doc (OLE2) — no reader in this repo; prefer another document for this procedure",
    };
  if (kind === "unknown")
    return {
      ...base,
      skipReason: `unrecognised format (magic ${buf.subarray(0, 4).toString("hex")})`,
    };

  try {
    const text =
      kind === "pdf" ? await extractPdfText(buf) : await extractDocxText(buf);
    // SCANNED FIRST. The 200-character floor below would swallow most scans and report them as
    // „too little text", which sends the reader looking for a parsing bug instead of at a
    // document that has no text layer at all — a different problem with a different answer.
    if (kind === "pdf" && text && looksLikeScannedPdf(text))
      return {
        ...base,
        // A scanned PDF yields a handful of stray glyphs. Enriching from it would mean quoting
        // text that is not really there, which is exactly what the grounding gate exists to stop
        // — better to say so here than to fail every quote later.
        skipReason: "scanned PDF (no text layer) — nothing to quote",
      };
    if (!text || text.trim().length < 200)
      return {
        ...base,
        skipReason: `extracted only ${text?.trim().length ?? 0} characters — too little to quote from`,
      };
    return { ...base, text };
  } catch (e) {
    return {
      ...base,
      skipReason: `extraction failed: ${(e as Error).message}`,
    };
  }
};
