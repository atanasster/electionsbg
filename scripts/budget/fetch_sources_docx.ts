// DOCX-specific helpers for the budget pipeline.
//
// Some ministries (MZH) bundle the program-budget execution DOCX inside a
// .zip; others (MZH 2023) publish the .docx directly. The fetcher in
// fetch_sources.ts caches whichever it gets; this helper normalises both
// shapes to "raw DOCX bytes" for the parser.

import unzipper from "unzipper";

// Detect whether a buffer is a raw .docx or a .zip wrapping one.
// Both start with the ZIP magic "PK\x03\x04" — a .docx IS a zip, but its
// internal layout is OOXML (word/document.xml etc.). A wrapper .zip
// containing a .docx has the docx as a top-level entry. We probe by
// listing the archive entries and looking for word/document.xml at the
// root vs a *.docx at the root.
export const extractDocxBytesFromZip = async (
  bytes: Uint8Array,
): Promise<Uint8Array> => {
  const dir = await unzipper.Open.buffer(Buffer.from(bytes));
  const hasOoxmlRoot = dir.files.some(
    (f) => f.path === "word/document.xml" || f.path === "[Content_Types].xml",
  );
  if (hasOoxmlRoot) {
    // The bytes ARE a docx; return as-is.
    return bytes;
  }
  // Otherwise look for a wrapped *.docx entry.
  const docxEntries = dir.files.filter((f) =>
    f.path.toLowerCase().endsWith(".docx"),
  );
  if (docxEntries.length === 0) {
    throw new Error("docx extractor: no .docx inside the archive");
  }
  if (docxEntries.length > 1) {
    // Multiple .docx files inside one archive — surface a warning so the
    // operator can verify we're picking the right one. Sort the candidates
    // by uncompressed size; the largest is almost always the main report.
    const candidates = docxEntries
      .map((e) => `${e.path} (${e.uncompressedSize ?? "?"} bytes)`)
      .join(", ");
    console.warn(
      `  ⚠ docx extractor: ${docxEntries.length} .docx entries in archive ` +
        `— picking the largest. Candidates: ${candidates}`,
    );
    docxEntries.sort(
      (a, b) => (b.uncompressedSize ?? 0) - (a.uncompressedSize ?? 0),
    );
  }
  return new Uint8Array(await docxEntries[0].buffer());
};
