// ЦПРС ingest (plan P2) — crawl register.ksb.bg's licence register and write
// data/procurement/cprs.json.
//
//   npx tsx scripts/procurement/cprs/ingest.ts --probe          # 3 областi × 6 classes
//   npx tsx scripts/procurement/cprs/ingest.ts --apply          # the full 30 × 54
//   npx tsx scripts/procurement/cprs/ingest.ts --apply --offline # re-parse the cache
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

const fetchCell = async (
  pod: string,
  group: string,
  offline: boolean,
  refresh: boolean,
): Promise<string> => {
  const dest = cacheKey(pod, group);
  if (offline) {
    if (!fs.existsSync(dest)) return "";
    return fs.readFileSync(dest, "utf8");
  }
  // RESUME. A 1,620-cell crawl over somebody's PHP app will meet a timeout, and
  // the first cut had no resume and no per-cell tolerance: one 30 s abort at
  // page ~900 killed the run and wrote nothing, discarding 900 good fetches.
  if (!refresh && fs.existsSync(dest)) return fs.readFileSync(dest, "utf8");
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
  return html;
};

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
  const failed: { pod: string; group: string; why: string }[] = [];
  await mapPool(cells, CONCURRENCY, async ({ o, c }) => {
    let html = "";
    try {
      html = await fetchCell(o.code, c.code, offline, refresh);
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
        `    Re-run to retry them — cached cells are skipped, so a re-run is cheap.`,
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
        `Re-run to retry — cached cells are skipped, so it is cheap. Refusing to ` +
        `write a register with that much missing.`,
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
          fetchedAt: new Date().toISOString().slice(0, 10),
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
