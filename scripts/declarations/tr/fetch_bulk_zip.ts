/**
 * Stream the entire Commerce Registry (TR) open-data dataset to a single
 * `all-resources.zip` on disk. data.egov.bg's bulk-zip flow is two requests:
 *
 *   1. GET /dataset/{datasetId}/resources/download/json
 *      → JSON `{ uri, format, delete_only_zip }`
 *   2. GET /dataset/resources/download/zip/{format}/{uri}/{delete_only_zip}
 *      → application/zip stream (~540 MB for TR)
 *
 * Resume: if `all-resources.zip` already exists on disk, we send
 * `Range: bytes=<existingSize>-` and append. If the server does not honor the
 * range (no 206), the existing file is rewritten from scratch.
 */

import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

const TR_DATASET_ID = "2df0c2af-e769-4397-be33-fcbe269806f3";
const BASE = "https://data.egov.bg";
const UA = "electionsbg.com data pipeline";
const PROGRESS_INTERVAL_BYTES = 10 * 1024 * 1024; // 10 MB

type PrepareResponse = {
  uri: string;
  format: string;
  delete_only_zip: boolean;
};

const prepareZip = async (
  datasetId: string,
  format: "json" | "xml",
): Promise<PrepareResponse> => {
  const url = `${BASE}/dataset/${datasetId}/resources/download/${format}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`prepare GET ${url} → ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as PrepareResponse;
  if (!json.uri || !json.format) {
    throw new Error(
      `prepare returned malformed payload: ${JSON.stringify(json)}`,
    );
  }
  return json;
};

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

export type FetchBulkZipOpts = {
  /** Where to write the archive. Defaults to `<rawFolder>/tr/all-resources.zip`. */
  rawFolder: string;
  format?: "json" | "xml";
  /** Print one progress line every PROGRESS_INTERVAL_BYTES. */
  onProgress?: (bytesDone: number, totalBytes: number | null) => void;
};

export type FetchBulkZipResult = {
  outPath: string;
  totalBytes: number;
  bytesDownloaded: number;
  resumed: boolean;
};

export const fetchBulkZip = async (
  opts: FetchBulkZipOpts,
): Promise<FetchBulkZipResult> => {
  const format = opts.format ?? "json";
  const outDir = path.join(opts.rawFolder, "tr");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `all-resources.${format}.zip`);

  console.log(`[tr/bulk] preparing zip on data.egov.bg…`);
  const prep = await prepareZip(TR_DATASET_ID, format);
  const downloadUrl = `${BASE}/dataset/resources/download/zip/${prep.format}/${prep.uri}/${String(prep.delete_only_zip)}`;
  console.log(`[tr/bulk] download url: ${downloadUrl}`);

  // Resume: how much do we already have?
  let existingBytes = 0;
  if (fs.existsSync(outPath)) {
    existingBytes = fs.statSync(outPath).size;
  }

  const headers: Record<string, string> = { "User-Agent": UA };
  if (existingBytes > 0) {
    headers.Range = `bytes=${existingBytes}-`;
  }

  const res = await fetch(downloadUrl, { headers });
  if (!res.ok && res.status !== 206) {
    throw new Error(`download GET → ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error(`download returned empty body`);
  }

  const resumed = res.status === 206 && existingBytes > 0;
  if (existingBytes > 0 && !resumed) {
    console.warn(
      `[tr/bulk] server did not honor Range request (status ${res.status}); restarting from byte 0`,
    );
    existingBytes = 0;
  }

  const contentLengthHeader = res.headers.get("content-length");
  const remainingBytes = contentLengthHeader
    ? Number(contentLengthHeader)
    : null;
  const totalBytes =
    remainingBytes != null ? existingBytes + remainingBytes : null;

  console.log(
    `[tr/bulk] ${resumed ? "resuming from" : "starting at"} ${formatBytes(existingBytes)}` +
      (totalBytes != null ? ` of ${formatBytes(totalBytes)}` : ""),
  );

  const fileStream = fs.createWriteStream(outPath, {
    flags: resumed ? "a" : "w",
  });

  let bytesDone = existingBytes;
  let lastProgressAt = bytesDone;
  const reportProgress = (chunkLen: number) => {
    bytesDone += chunkLen;
    if (bytesDone - lastProgressAt >= PROGRESS_INTERVAL_BYTES) {
      lastProgressAt = bytesDone;
      const pct =
        totalBytes != null
          ? ` (${((bytesDone / totalBytes) * 100).toFixed(1)}%)`
          : "";
      console.log(`[tr/bulk]   ${formatBytes(bytesDone)}${pct}`);
      opts.onProgress?.(bytesDone, totalBytes);
    }
  };

  // Tee the body stream so we can count bytes for progress while piping to disk.
  const nodeStream = Readable.fromWeb(
    res.body as unknown as import("stream/web").ReadableStream,
  );
  nodeStream.on("data", (chunk: Buffer) => reportProgress(chunk.length));

  await pipeline(nodeStream, fileStream);

  const finalSize = fs.statSync(outPath).size;
  if (totalBytes != null && finalSize !== totalBytes) {
    throw new Error(
      `[tr/bulk] size mismatch: on-disk ${finalSize} vs expected ${totalBytes}. ` +
        `Re-run to retry the tail via Range resume.`,
    );
  }

  console.log(`[tr/bulk] done → ${outPath} (${formatBytes(finalSize)})`);
  return {
    outPath,
    totalBytes: finalSize,
    bytesDownloaded: finalSize - (resumed ? existingBytes : 0),
    resumed,
  };
};
