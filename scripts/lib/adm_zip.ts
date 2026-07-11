// Minimal typed wrapper over `adm-zip`, which ships no bundled types (and we
// don't pull @types/adm-zip). Only the members our budget ingests touch —
// `new AdmZip(buffer)`, `getEntries()`, and each entry's `entryName` +
// `getData()`. Mirrors how scripts/budget/noi/parse_pension_yearbook.ts wraps
// the untyped pdfjs via createRequire.
//
// `AdmZip` is exported as BOTH a value (the constructor) and a type (the
// instance), so callers can write `new AdmZip(buf)` and `zip: AdmZip`.

import { createRequire } from "module";

const require = createRequire(import.meta.url);

export interface ZipEntry {
  entryName: string;
  getData(): Buffer;
}

export interface AdmZipInstance {
  getEntries(): ZipEntry[];
}

export interface AdmZipConstructor {
  new (input: Buffer): AdmZipInstance;
}

export const AdmZip = require("adm-zip") as AdmZipConstructor;
export type AdmZip = AdmZipInstance;
