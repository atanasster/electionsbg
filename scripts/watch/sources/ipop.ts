// МРРБ IPOP execution feed watcher.
//
// Tracks the public CSV export at ipop.mrrb.bg/reports_projects_export.php
// — a daily-refreshed dump of all municipal projects funded by МРРБ
// (Инвестиционна програма за общински проекти) with per-project paid /
// submitted / awaiting amounts.
//
// The CSV is updated whenever MRRB processes new payments or receives
// new disbursement requests, so this fingerprint is highly mutable —
// expect daily re-uploads. Cadence: daily.
//
// The server only allows GET (HEAD returns 405) and streams the file with
// Transfer-Encoding: chunked / no Content-Length. We fingerprint the first
// SAMPLE_BYTES of the CSV body — enough to catch any data change — then
// abort the connection immediately so we never download the full file.
// On change, operator re-runs `tsx scripts/budget/ipop/ingest.ts`.

import { createHash } from "crypto";
import https from "https";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; " +
  "+https://electionsbg.com)";

export const IPOP_CSV_URL = "https://ipop.mrrb.bg/reports_projects_export.php";

// First N bytes to read for the content fingerprint.
const SAMPLE_BYTES = 32_768;

// ipop.mrrb.bg serves a Sectigo-signed cert but omits the intermediate CA in
// its TLS handshake. Node fetch (undici) fails; https.request with
// rejectUnauthorized:false is scoped to just this one request.
const sampleIpopCsv = (): Promise<{ statusCode: number; bytes: Buffer }> =>
  new Promise((resolve, reject) => {
    const req = https.request(
      IPOP_CSV_URL,
      {
        method: "GET",
        rejectUnauthorized: false,
        headers: { "User-Agent": UA, Accept: "*/*" },
      },
      (res) => {
        const statusCode = res.statusCode ?? 0;
        if (statusCode !== 200) {
          res.destroy();
          resolve({ statusCode, bytes: Buffer.alloc(0) });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          const remaining = SAMPLE_BYTES - total;
          if (remaining <= 0) return;
          chunks.push(chunk.subarray(0, remaining));
          total += Math.min(chunk.length, remaining);
          if (total >= SAMPLE_BYTES) res.destroy();
        });
        res.on("close", () =>
          resolve({ statusCode, bytes: Buffer.concat(chunks) }),
        );
        res.on("error", (err) => {
          // ECONNRESET from res.destroy() after we have enough bytes is fine.
          if ((err as NodeJS.ErrnoException).code === "ECONNRESET" && total > 0)
            resolve({ statusCode, bytes: Buffer.concat(chunks) });
          else reject(err);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

export const ipop: WatchSource = {
  id: "ipop_mrrb",
  label: "МРРБ — ИПОП (Инвестиционна програма за общински проекти) изпълнение",
  url: "https://ipop.mrrb.bg/",
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    try {
      const { statusCode, bytes } = await sampleIpopCsv();
      if (statusCode !== 200) {
        return {
          value: `status:${statusCode}`,
          detail: `GET ${statusCode} from ipop.mrrb.bg`,
        };
      }
      const digest = createHash("sha256")
        .update(bytes)
        .digest("hex")
        .slice(0, 16);
      return {
        value: digest,
        detail: `IPOP CSV sample ${bytes.length}B · hash ${digest}`,
        meta: { sampleBytes: bytes.length },
      };
    } catch (e) {
      const msg = (e as Error).message.slice(0, 80);
      return { value: `err:${msg}`, detail: `fetch failed: ${msg}` };
    }
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    if (prev.fingerprint === curr.value) return `${curr.detail} (no change)`;
    return `IPOP CSV re-uploaded — re-run \`tsx scripts/budget/ipop/ingest.ts\``;
  },
};
