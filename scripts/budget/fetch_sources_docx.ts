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
  const docxEntry = dir.files.find((f) =>
    f.path.toLowerCase().endsWith(".docx"),
  );
  if (!docxEntry) {
    throw new Error("docx extractor: no .docx inside the archive");
  }
  return new Uint8Array(await docxEntry.buffer());
};
