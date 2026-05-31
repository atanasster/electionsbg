// Dependency-free ZIP extractor with CP866 filename decoding.
//
// CIK's local-election `mi{YYYY}.zip` bundles store Cyrillic directory names
// ("ОС", "КО", "КК", "КР") as raw CP866 bytes WITHOUT the UTF-8 general-purpose
// flag set. Node's `unzipper` decodes those bytes as UTF-8 and irreversibly
// mangles them to replacement characters, so we can't recover the race-type
// folder name (which is the join key for "which ballot is this"). yauzl with
// decodeStrings:false would work but isn't a dependency, and shelling out to
// python3 ties the pipeline to an external runtime.
//
// Instead we parse the ZIP container ourselves — it's a simple format — and
// read the raw filename bytes straight from the central directory, decoding
// them with TextDecoder("cp866"). Only STORE (0) and DEFLATE (8) compression
// are handled; that's all CIK uses.

import fs from "fs";
import path from "path";
import zlib from "zlib";

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

const cp866 = new TextDecoder("cp866");

type CentralEntry = {
  name: string; // CP866-decoded
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const findEocd = (buf: Buffer): number => {
  // EOCD is at the end; the trailing comment is usually empty, so scan back
  // from the minimum EOCD size (22 bytes) over the max comment window (64 KB).
  const min = 22;
  const maxBack = Math.min(buf.length, 22 + 0xffff);
  for (let i = buf.length - min; i >= buf.length - maxBack && i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
};

const readCentralDirectory = (buf: Buffer): CentralEntry[] => {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("ZIP: end-of-central-directory not found");
  const cdCount = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries: CentralEntry[] = [];
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(off) !== SIG_CEN) {
      throw new Error(`ZIP: bad central header at ${off}`);
    }
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const uncompressedSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localHeaderOffset = buf.readUInt32LE(off + 42);
    const nameBytes = buf.subarray(off + 46, off + 46 + nameLen);
    entries.push({
      name: cp866.decode(nameBytes),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
};

const readEntryData = (buf: Buffer, entry: CentralEntry): Buffer => {
  const lo = entry.localHeaderOffset;
  if (buf.readUInt32LE(lo) !== SIG_LOC) {
    throw new Error(`ZIP: bad local header at ${lo}`);
  }
  // Local header name/extra lengths can differ from the central record.
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`ZIP: unsupported compression method ${entry.method}`);
};

/**
 * Extract `zipPath` into `destDir`, decoding entry names as CP866 so the
 * Cyrillic race-type folders survive. Returns the list of written file paths
 * (relative to destDir).
 */
export const extractZipCp866 = (zipPath: string, destDir: string): string[] => {
  const buf = fs.readFileSync(zipPath);
  const entries = readCentralDirectory(buf);
  const written: string[] = [];
  for (const entry of entries) {
    // Normalise separators and guard against path traversal.
    const rel = entry.name.replace(/\\/g, "/");
    if (rel.endsWith("/")) {
      fs.mkdirSync(path.join(destDir, rel), { recursive: true });
      continue;
    }
    const safeRel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
    const outPath = path.join(destDir, safeRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, readEntryData(buf, entry));
    written.push(safeRel);
  }
  return written;
};
