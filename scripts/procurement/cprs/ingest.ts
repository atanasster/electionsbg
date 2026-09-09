// ЦПРС ingest (plan P2) — crawl register.ksb.bg's licence register and write
// data/procurement/cprs.json.
//
//   npx tsx scripts/procurement/cprs/ingest.ts --probe            # 3 областi × 6 classes
//   npx tsx scripts/procurement/cprs/ingest.ts --apply            # the full 30 × 54
//   npx tsx scripts/procurement/cprs/ingest.ts --apply --refresh  # a watcher flip — re-fetch
//   npx tsx scripts/procurement/cprs/ingest.ts --apply --offline  # re-parse the cache
//
// ⚠️ WITHOUT --refresh EVERY CACHED CELL IS REUSED, so on a `cprs_register`
// watcher flip a bare --apply re-parses the PREVIOUS crawl, fetches nothing and
// writes only a new artifact. Measured 2026-09-08: --apply finished in 6 s at
// 106,508 licences / 8,379 firms (the 2026-08-19 cache); --apply --refresh took
// 42 s and found 107,034 / 8,414. The cache is the RESUME mechanism, not a
// freshness claim — see fetchCell. The run says so out loud when it happens.
//
// Output shape: one row per (eik, class), carrying every област the firm is
// listed in for that class and the EARLIEST protocol date seen. The register is
// queried per област, so the same licence appears once per област a firm
// operates in; folding on (eik, class) is what turns 1,620 pages into a register.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROWSER_UA,
  CONCURRENCY,
  CPRS_LIST_URL,
  isGroupHeader,
  parseOblasti,
  parseTaxonomy,
  type CprsClass,
  type CprsOblast,
} from "./sources";
import { isEikShaped, parseFirmList } from "./parse";
import { fetchText } from "../../watch/fingerprint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../../data/procurement/cprs.json");
const RAW = path.resolve(__dirname, "../../../raw_data/procurement/cprs");

export type CprsLicence = {
  eik: string;
  name: string;
  classCode: string;
  classLabel: string;
  /** Group header (`10`,`20`…) rather than a specific class. Kept because it is
   *  the only way a firm licensed for a whole group with no sub-class appears. */
  isGroup: boolean;
  oblasti: string[];
  firstProtocolNo: string | null;
  firstProtocolDate: string | null;
  /** The id is not ЕИК-shaped — a foreign builder or a register typo. Kept and
   *  flagged rather than dropped: it cannot join `contracts.contractor_eik`, and
   *  silently discarding it would understate the register. */
  unjoinable: boolean;
};

const cacheKey = (pod: string, group: string) =>
  path.join(RAW, `${pod}_${group.replace(/\./g, "-")}.html`);

/** Under --refresh a cached cell is still reused when it was fetched this
 *  recently — the window in which a re-run after a mid-crawl timeout is a
 *  RESUME of the same refresh rather than a second one. A full refresh is
 *  ~42 s, so one hour covers any retry; a flip is never twice in an hour. */
export const REFRESH_RESUME_WINDOW_MS = 60 * 60 * 1000;

type Cell = {
  html: string;
  /** `cache` = read from raw_data/, `fetch` = pulled from register.ksb.bg this
   *  run, `missing` = --offline and no cached copy. */
  source: "cache" | "fetch" | "missing";
  /** The cached copy's mtime — the crawl vintage a reused cell carries. */
  mtimeMs: number;
};

const fetchCell = async (
  pod: string,
  group: string,
  offline: boolean,
  /** Reuse a cached cell only if it was written at or after this instant;
   *  null reuses any cached cell (the default — resume — behaviour). */
  reuseSince: number | null,
): Promise<Cell> => {
  const dest = cacheKey(pod, group);
  const cached = (): Cell => ({
    html: fs.readFileSync(dest, "utf8"),
    source: "cache",
    mtimeMs: fs.statSync(dest).mtimeMs,
  });
  if (offline) {
    if (!fs.existsSync(dest))
      return { html: "", source: "missing", mtimeMs: 0 };
    return cached();
  }
  // RESUME. A 1,620-cell crawl over somebody's PHP app will meet a timeout, and
  // the first cut had no resume and no per-cell tolerance: one 30 s abort at
  // page ~900 killed the run and wrote nothing, discarding 900 good fetches.
  //
  // The same reuse is what makes a bare run on a watcher flip a NO-OP — every
  // cell is already on disk, so nothing is fetched and the previous crawl is
  // re-parsed. `--refresh` does not disable the cache; it moves `reuseSince`
  // to one REFRESH_RESUME_WINDOW_MS ago, so an explicit refresh re-fetches the
  // register while a `--refresh` re-run after a timeout still resumes — and
  // never mixes a half-refreshed grid with the old one, which is what a re-run
  // WITHOUT the flag would do.
  if (
    fs.existsSync(dest) &&
    (reuseSince === null || fs.statSync(dest).mtimeMs >= reuseSince)
  )
    return cached();
  const body = new URLSearchParams({
    Pod: pod,
    GroupType: group,
    Podphp: pod,
    GroupTypephp: group,
    filter: "Покажи строителите",
  }).toString();
  const html = await fetchText(CPRS_LIST_URL, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    body,
  });
  if (html === null)
    throw new Error(`no body for Pod=${pod} GroupType=${group}`);
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(dest, html);
  return { html, source: "fetch", mtimeMs: Date.now() };
};

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const mapPool = async <T>(
  items: readonly T[],
  limit: number,
  fn: (t: T, i: number) => Promise<void>,
): Promise<void> => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i], i);
      }
    }),
  );
};

const main = async (): Promise<void> => {
  const apply = process.argv.includes("--apply");
  const offline = process.argv.includes("--offline");
  const probe = process.argv.includes("--probe");
  const refresh = process.argv.includes("--refresh");

  const seed = offline
    ? fs.readFileSync(path.join(RAW, "_index.html"), "utf8")
    : ((await fetchText(CPRS_LIST_URL, {
        headers: { "User-Agent": BROWSER_UA },
      })) ?? "");
  if (!seed) throw new Error("could not read the ЦПРС search page");
  if (!offline) {
    fs.mkdirSync(RAW, { recursive: true });
    fs.writeFileSync(path.join(RAW, "_index.html"), seed);
  }

  let classes: CprsClass[] = parseTaxonomy(seed);
  let oblasti: CprsOblast[] = parseOblasti(seed);
  if (classes.length < 20 || oblasti.length < 25)
    throw new Error(
      `taxonomy looks wrong: ${classes.length} classes / ${oblasti.length} области. ` +
        `КСБ changed the page — refusing rather than crawling a partial grid.`,
    );
  if (probe) {
    classes = classes.slice(0, 6);
    oblasti = oblasti.slice(0, 3);
  }

  const cells = oblasti.flatMap((o) => classes.map((c) => ({ o, c })));
  console.log(
    `→ ${oblasti.length} области × ${classes.length} classes = ${cells.length} queries`,
  );

  const byKey = new Map<string, CprsLicence>();
  let pages = 0;
  let rows = 0;
  // Cache accounting — so „this run fetched nothing" is a line in the log
  // rather than a fact to be inferred from a 6 s runtime.
  let fetched = 0;
  let cached = 0;
  let cacheOldest = Number.POSITIVE_INFINITY;
  let cacheNewest = 0;
  const reuseSince = refresh ? Date.now() - REFRESH_RESUME_WINDOW_MS : null;
  const failed: { pod: string; group: string; why: string }[] = [];
  await mapPool(cells, CONCURRENCY, async ({ o, c }) => {
    let html = "";
    try {
      const cell = await fetchCell(o.code, c.code, offline, reuseSince);
      html = cell.html;
      if (cell.source === "fetch") fetched++;
      else if (cell.source === "cache") {
        cached++;
        cacheOldest = Math.min(cacheOldest, cell.mtimeMs);
        cacheNewest = Math.max(cacheNewest, cell.mtimeMs);
      }
    } catch (e) {
      // One cell failing is not the crawl failing. Record it, keep going, and
      // let the completeness guard below decide whether the result is publishable.
      failed.push({ pod: o.code, group: c.code, why: String(e).slice(0, 80) });
    }
    pages++;
    if (pages % 200 === 0)
      console.log(`  … ${pages}/${cells.length} pages, ${byKey.size} licences`);
    if (!html) return;
    for (const r of parseFirmList(html)) {
      rows++;
      const key = `${r.eik}|${c.code}`;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, {
          eik: r.eik,
          name: r.name,
          classCode: c.code,
          classLabel: c.label,
          isGroup: isGroupHeader(c.code),
          oblasti: [o.label],
          firstProtocolNo: r.protocolNo,
          firstProtocolDate: r.protocolDate,
          unjoinable: !isEikShaped(r.eik),
        });
        continue;
      }
      if (!prev.oblasti.includes(o.label)) prev.oblasti.push(o.label);
      // EARLIEST protocol wins: the question this register answers is „since
      // when", so a later re-entry must not overwrite the original date.
      if (
        r.protocolDate &&
        (!prev.firstProtocolDate || r.protocolDate < prev.firstProtocolDate)
      ) {
        prev.firstProtocolDate = r.protocolDate;
        prev.firstProtocolNo = r.protocolNo;
      }
    }
  });

  const rawRel = path.relative(process.cwd(), RAW);
  const vintage = !cached
    ? "—"
    : isoDay(cacheOldest) === isoDay(cacheNewest)
      ? isoDay(cacheNewest)
      : `${isoDay(cacheOldest)} … ${isoDay(cacheNewest)}`;
  console.log(
    `\n  ${fetched.toLocaleString()} cell(s) fetched from register.ksb.bg · ` +
      `${cached.toLocaleString()} served from ${rawRel} (cache vintage ${vintage})`,
  );
  if (offline) {
    console.log(
      `  (offline — re-parsed the ${vintage} cache, nothing fetched)`,
    );
  } else if (fetched === 0 && cached > 0 && refresh) {
    // An explicit refresh that fetched nothing is the resume window firing on
    // a grid that was refreshed within the hour — say so rather than let it
    // read as the register being unchanged.
    console.log(
      `  ⚠ --refresh fetched NOTHING: every cell was fetched within the last ` +
        `${REFRESH_RESUME_WINDOW_MS / 3_600_000} h, so the resume window reused it. ` +
        `Wait, or delete ${rawRel} to force a full re-fetch.`,
    );
  } else if (fetched === 0 && cached > 0) {
    // LOUD, because the alternative is invisible: the run exits 0, the counts
    // look plausible, and the only tell is a 6 s runtime. On a watcher flip
    // this is the documented command doing nothing.
    console.log(
      `\n  ⚠⚠ EVERY ONE OF THE ${cached.toLocaleString()} CELLS CAME FROM THE CACHE — ` +
        `this run re-parsed the ${vintage} crawl and fetched NOTHING from ` +
        `register.ksb.bg.\n` +
        `     On a cprs_register watcher flip that is a NO-OP that republishes the ` +
        `previous register. Re-run with --refresh to re-fetch every cell (~42 s).`,
    );
  }

  const licences = [...byKey.values()].sort(
    (a, b) =>
      a.eik.localeCompare(b.eik) || a.classCode.localeCompare(b.classCode),
  );
  const firms = new Set(licences.map((l) => l.eik));
  const unjoinable = licences.filter((l) => l.unjoinable);
  console.log(
    `\n  ${rows.toLocaleString()} table rows → ${licences.length.toLocaleString()} ` +
      `(eik, class) licences across ${firms.size.toLocaleString()} firms`,
  );
  console.log(
    `  ${licences.filter((l) => l.firstProtocolDate).length.toLocaleString()} dated · ` +
      `${unjoinable.length} with a non-ЕИК id`,
  );

  if (failed.length)
    console.log(
      `  ⚠ ${failed.length} cell(s) failed: ` +
        `${failed
          .slice(0, 5)
          .map((f) => `${f.pod}/${f.group}`)
          .join(", ")}${failed.length > 5 ? " …" : ""}\n` +
        `    Re-run the SAME command to retry them — cells already fetched are ` +
        `skipped (under --refresh, those fetched within the hour), so it is cheap.`,
    );

  if (!apply) {
    console.log(
      "\n(dry run — pass --apply to write data/procurement/cprs.json)",
    );
    return;
  }
  // ⚠️ A PARTIAL CRAWL MUST NOT PUBLISH AS A COMPLETE REGISTER. Per-cell
  // tolerance is what stops a transient timeout discarding 900 good fetches;
  // this is what stops that same tolerance quietly shipping a register with a
  // hole in it, which would read as „these firms hold no licence".
  const failRate = failed.length / cells.length;
  if (!probe && failRate > 0.02)
    throw new Error(
      `${failed.length}/${cells.length} cells failed (${(failRate * 100).toFixed(1)}%). ` +
        `Re-run the SAME command to retry — cells already fetched are skipped, so ` +
        `it is cheap. Refusing to write a register with that much missing.`,
    );
  // A near-empty crawl is a site change, not an empty register.
  if (!probe && firms.size < 1000)
    throw new Error(
      `only ${firms.size} firms — the ЦПРС holds tens of thousands. Refusing to ` +
        `overwrite a good file with a broken crawl.`,
    );
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // NORMALISED, and not as a micro-optimisation: the first cut repeated the
  // ~100-character class label and the firm name on every one of 106,508 rows
  // and produced a 43 MB artifact for what is a few thousand distinct strings.
  // Labels and names are dictionaries; области are indices into one list.
  const classLabels: Record<string, string> = {};
  for (const l of licences) classLabels[l.classCode] = l.classLabel;
  fs.writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        source: {
          url: CPRS_LIST_URL,
          // The day the register was actually READ. A run that fetched nothing
          // re-parsed the cache, so it carries the cache's vintage rather than
          // today — stamping today was the only thing a no-op run changed in
          // the artifact, which is how the no-op passed for a refresh.
          fetchedAt:
            fetched > 0 || !cached ? isoDay(Date.now()) : isoDay(cacheNewest),
        },
        counts: {
          firms: firms.size,
          licences: licences.length,
          dated: licences.filter((l) => l.firstProtocolDate).length,
          unjoinable: unjoinable.length,
        },
        classes: classLabels,
        // MEASURED, not assumed: every licence carries exactly ONE област and
        // no firm's област varies by class (0 of 8,379). So it is the firm's
        // SEAT, not a per-licence territory — it belongs here, once per firm,
        // not repeated across its ~13 licence rows.
        firms: Object.fromEntries(
          [...new Map(licences.map((l) => [l.eik, l])).values()].map((l) => [
            l.eik,
            { name: l.name, oblast: l.oblasti[0] ?? null },
          ]),
        ),
        licences: licences.map((l) => ({
          eik: l.eik,
          classCode: l.classCode,
          isGroup: l.isGroup,
          firstProtocolNo: l.firstProtocolNo,
          firstProtocolDate: l.firstProtocolDate,
          unjoinable: l.unjoinable,
        })),
      },
      null,
      1,
    )}\n`,
  );
  console.log(`\n✓ wrote ${path.relative(process.cwd(), OUT)}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
