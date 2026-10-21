// Crawl the CURRENT assembly's bills from parliament.bg (see bills.ts for why only the current
// one) into a raw cache and a committed per-assembly file.
//
//   npx tsx scripts/parliament/bills/fetch_bills.ts          # list + every detail
//   npx tsx scripts/parliament/bills/fetch_bills.ts --dry    # report, write nothing
//
// Raw responses: raw_data/parliament/bills/<id>.json (gitignored). A PROMULGATED bill's cached
// detail is reused — a ДВ issue does not change — and every other bill is re-fetched, since
// pending is exactly the state that moves. Serial, DELAY_MS apart.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  PARLIAMENT_API,
  parseBillDetail,
  parseBillList,
  type BillDetail,
} from "./bills";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const RAW = path.join(ROOT, "raw_data/parliament/bills");
const OUT_DIR = path.join(ROOT, "data/parliament/bills");
const UA = "electionsbg-bills/1.0 (+https://electionsbg.com)";
const DELAY_MS = 1_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getJson = async (url: string, init?: RequestInit): Promise<unknown> => {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      if (!/json/i.test(res.headers.get("content-type") ?? ""))
        throw new Error(
          `${url} → ${res.headers.get("content-type")}, not JSON`,
        );
      return await res.json();
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(5_000 * attempt);
    }
  }
};

const main = async (): Promise<void> => {
  const dry = process.argv.includes("--dry");
  const list = parseBillList(
    await getJson(`${PARLIAMENT_API}/fn-bills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  const assemblies = new Set(list.map((b) => b.sign.split("-")[0]));
  if (assemblies.size !== 1)
    throw new Error(
      `fn-bills spans assemblies ${[...assemblies].join(", ")} — the API changed`,
    );
  const ns = [...assemblies][0];
  mkdirSync(RAW, { recursive: true });
  const bills: BillDetail[] = [];
  let reused = 0;
  for (const item of list) {
    const cached = path.join(RAW, `${item.id}.json`);
    let raw: unknown = null;
    if (existsSync(cached)) {
      const c = JSON.parse(readFileSync(cached, "utf8"));
      if (parseBillDetail(c).dvIssue) {
        raw = c;
        reused++;
      }
    }
    if (!raw) {
      await sleep(DELAY_MS);
      raw = await getJson(`${PARLIAMENT_API}/bill/${item.id}`);
      if (!dry) writeFileSync(cached, JSON.stringify(raw));
    }
    const d = parseBillDetail(raw);
    if (d.id !== item.id)
      throw new Error(`bill ${item.id} returned id ${d.id}`);
    bills.push(d);
  }
  bills.sort((a, b) => a.id - b.id);
  const promulgated = bills.filter((b) => b.dvIssue).length;
  console.log(
    `bills: assembly ${ns}, ${bills.length} bill(s), ${promulgated} promulgated in ДВ, ` +
      `${bills.filter((b) => b.withdrawn).length} withdrawn (${reused} promulgated details reused)`,
  );
  if (dry) {
    console.log("--dry: nothing written");
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `ns${ns}.json`);
  // A fresh fetchedAt alone is not worth a diff on a committed file.
  if (existsSync(out)) {
    const prev = JSON.parse(readFileSync(out, "utf8")) as {
      bills: BillDetail[];
    };
    if (JSON.stringify(prev.bills) === JSON.stringify(bills)) {
      console.log("no bill changed — file left as is");
      return;
    }
  }
  writeFileSync(
    out,
    JSON.stringify(
      { ns, fetchedAt: new Date().toISOString(), bills },
      null,
      1,
    ) + "\n",
  );
  console.log(`wrote ${path.relative(ROOT, out)}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
