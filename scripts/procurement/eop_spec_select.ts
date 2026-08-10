// The two identity decisions tier B makes per document, kept out of the CLI script
// so they can be tested without a network or a process launch (ingest_eop_spec_text.ts
// calls `run(cli, …)` at import time, so importing it from a test would execute it).

import { createHash } from "node:crypto";
import type { EopDossierStore } from "./eop_dossier_store";

/**
 * Which resume probe applies to a manifest entry.
 *
 * The register publishes `MD5Hash` for most documents but not all. With a hash we
 * can content-key BEFORE downloading, which is what lets the same bytes republished
 * under a new documentId (plan §9.1) be skipped. Without one there is nothing to
 * content-key on yet, so the documentId is the only pre-download handle.
 */
export const isCached = (
  store: EopDossierStore,
  md5: string,
  documentId: number,
): boolean =>
  md5 ? store.hasDocText(md5) : store.hasDocTextByDocumentId(documentId);

/**
 * The register's hash when it published one, else the real hash of the bytes.
 *
 * Never a synthetic `id:<n>`: that would defeat the content dedup the primary key
 * exists for and store one file twice under two ids. Because this computes the same
 * MD5 the register itself publishes, the two keying paths are interchangeable — a
 * document first seen without a hash and later seen with one lands on one row.
 */
export const contentKey = (md5: string, buf: Buffer): string =>
  md5 || createHash("md5").update(buf).digest("hex");
