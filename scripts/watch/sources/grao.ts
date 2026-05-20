// ГРАО — settlement-level registered population. The quarterly
// `t41nm-DD-MM-YYYY_N.txt` table feeds the `update-grao` skill. The file URL
// changes each quarter, so we resolve the latest from the index page and
// fingerprint its content — a new quarterly release flips the hash.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const INDEX_URL = "https://www.grao.bg/tables.html";
const BASE_URL = "https://www.grao.bg/";
const UA = "electionsbg.com data pipeline";

const findLatest = async (): Promise<{ file: string; asOf: string }> => {
  const res = await fetch(INDEX_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${INDEX_URL}`);
  const html = await res.text();
  const matches = [
    ...html.matchAll(/tna\/t41nm-(\d{2})-(\d{2})-(\d{4})_(\d+)\.txt/g),
  ];
  if (matches.length === 0)
    throw new Error("no t41nm settlement files on the ГРАО index page");
  let best: { file: string; asOf: string; key: number } | undefined;
  for (const m of matches) {
    const [full, dd, mm, yyyy] = m;
    const key = Number(yyyy) * 10000 + Number(mm) * 100 + Number(dd);
    if (!best || key > best.key)
      best = { file: full, asOf: `${yyyy}-${mm}-${dd}`, key };
  }
  return { file: best!.file, asOf: best!.asOf };
};

export const grao: WatchSource = {
  id: "grao",
  label: "ГРАО: население по постоянен и настоящ адрес (по населени места)",
  url: INDEX_URL,
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const { file, asOf } = await findLatest();
    const res = await fetch(BASE_URL + file, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${BASE_URL + file}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      value: createHash("sha256").update(buf).digest("hex"),
      detail: `${asOf} · ${buf.length} bytes`,
      meta: { asOf, byteLength: buf.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevAsOf = (prev.meta?.asOf ?? "?") as string;
    const currAsOf = (curr.meta?.asOf ?? "?") as string;
    if (prevAsOf !== currAsOf)
      return `new quarterly table ${prevAsOf} → ${currAsOf}`;
    return curr.detail;
  },
};
