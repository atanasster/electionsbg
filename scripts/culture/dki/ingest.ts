// МК ДКИ register ingest (plan T3.1) — fetch МК's three ДКИ listing pages, parse
// them, resolve each institute to an EIK against the corpus, and write
// data/culture/dki_register.json.
//
//   npx tsx scripts/culture/dki/ingest.ts            # dry run, prints the diff
//   npx tsx scripts/culture/dki/ingest.ts --apply    # write the artifact
//   npx tsx scripts/culture/dki/ingest.ts --apply --offline   # re-parse the cache
//
// A DRY RUN STILL REFRESHES THE RAW CACHE (`raw_data/culture/dki/`, gitignored).
// That is deliberate — it is what makes the `--offline` re-parse afterwards read
// what you just fetched — but it does mean the „dry" run mutates on-disk state.
//
// The artifact is COMMITTED and `data/culture/` is bucket-synced, so it ships to
// the serving bucket (42 KB) even though its only consumer today is the
// reconciliation gate, which reads it from the repo. That is a decision, not an
// oversight: excluding one file from a synced directory takes four coordinated
// edits (`bucket_sync_paths.ts`'s `isExcluded` + `CHILD_EXCLUDES`, and the `-x`
// regex in BOTH `bucket:sync` and `bucket:sync:dry`), which is more machinery
// than 42 KB justifies while a /culture surface citing the register's directors
// and coverage line is a plausible near-term reader.
//
// WHAT THIS ARTIFACT IS FOR, and what it is not: it is the INDEPENDENT EVIDENCE
// that `src/lib/kulturaReferenceData.ts` is right about who МК is the principal
// of. It never becomes the allowlist. The allowlist is hand-classified, four
// lists deep, and carries bodies this register does not list at all; this one
// carries bodies the corpus sweep could never see, because they have never run a
// ЗОП procedure. Each catches what the other structurally cannot.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_UA, DKI_COVERAGE, DKI_PAGES } from "./sources";
import { parseDkiPage, type DkiEntry } from "./parse";
import type { DkiInstitute, DkiRegister } from "./types";
import { loadBuyerCandidates, resolveEntry } from "./resolve";
import { end } from "../../db/lib/pg";
import { fetchText } from "../../watch/fingerprint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../../../data/culture/dki_register.json");
const RAW = path.resolve(__dirname, "../../../raw_data/culture/dki");

const cacheFile = (id: string): string => path.join(RAW, `${id}.html`);

const fetchPage = async (
  id: string,
  url: string,
  offline: boolean,
): Promise<string> => {
  const dest = cacheFile(id);
  if (offline) {
    if (!fs.existsSync(dest))
      throw new Error(
        `--offline but no cached copy of ${id} at ${dest}. Run once online first.`,
      );
    return fs.readFileSync(dest, "utf8");
  }
  // `insecureTls` because mc.government.bg serves an INCOMPLETE CERTIFICATE
  // CHAIN — the leaf is valid, the intermediate is missing, so curl and browsers
  // accept it (they ship more intermediates) and Node's bundled CA list does
  // not. Same case as register.cacbg.bg, which is why the shared fetcher already
  // has the flag. Read-only public pages; nothing is sent.
  const html = await fetchText(url, {
    headers: { "User-Agent": BROWSER_UA },
    insecureTls: true,
  });
  if (html === null) throw new Error(`${id}: no body from ${url}`);
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(dest, html);
  return html;
};

/** A page that parses to nothing is a TEMPLATE CHANGE, not an empty register —
 *  МК does not close every theatre in the country overnight. Writing the
 *  artifact anyway would replace a good file with an empty one and every
 *  consumer would render „no institutes" at a 200. */
export const MIN_PER_PAGE = 5;

const main = async (): Promise<void> => {
  const apply = process.argv.includes("--apply");
  const offline = process.argv.includes("--offline");

  const entries: DkiEntry[] = [];
  for (const page of DKI_PAGES) {
    const html = await fetchPage(page.id, page.url, offline);
    const rows = parseDkiPage(html, page);
    if (rows.length < MIN_PER_PAGE)
      throw new Error(
        `${page.id}: parsed ${rows.length} institutes (floor ${MIN_PER_PAGE}). ` +
          `МК almost certainly changed the page template. Refusing to write — ` +
          `an empty register looks exactly like a closed sector.`,
      );
    console.log(`  ${page.id}: ${rows.length} institute(s)`);
    entries.push(...rows);
  }

  const candidates = await loadBuyerCandidates();
  if (!candidates.length)
    throw new Error(
      "no buyers in contracts/tenders — the corpus is empty, so every institute " +
        "would be written as unmatched and the artifact would assert that МК's " +
        "register matches nothing.",
    );
  console.log(
    `  corpus buyers: ${candidates.length.toLocaleString()} spellings`,
  );

  const institutes: DkiInstitute[] = entries.map((e) => {
    const r = resolveEntry(e, candidates);
    return {
      ...e,
      eik: r.status === "resolved" ? r.eik : null,
      eikBasis: r.status === "resolved" ? r.basis : r.status,
      corpusName: r.status === "resolved" ? r.corpusName : null,
      // A refusal is meant to be adjudicated by hand, so it must carry WHAT it
      // collided with. Without this the artifact says only „ambiguous" and the
      // adjudicator has to re-run the resolver under a debugger.
      ...(r.status === "ambiguous"
        ? { ambiguousCandidates: r.candidates }
        : {}),
    };
  });

  const count = (b: DkiInstitute["eikBasis"]) =>
    institutes.filter((i) => i.eikBasis === b).length;
  const register: DkiRegister = {
    source: {
      pages: DKI_PAGES.map((p) => ({ id: p.id, label: p.label, url: p.url })),
      // Date only: the pages carry no publication date of their own, and a
      // timestamp would churn the committed file on every re-run.
      fetchedAt: new Date().toISOString().slice(0, 10),
    },
    coverage: {
      ...DKI_COVERAGE,
      listed: institutes.length,
      resolved: count("exact") + count("tokens"),
      ambiguous: count("ambiguous"),
      unmatched: count("unmatched"),
    },
    institutes: institutes.sort(
      (a, b) =>
        a.pageId.localeCompare(b.pageId) || a.name.localeCompare(b.name),
    ),
  };

  const c = register.coverage;
  console.log(
    `\n  ${c.listed} listed · ${c.resolved} resolved to an EIK · ` +
      `${c.ambiguous} ambiguous (refused) · ${c.unmatched} not in the corpus`,
  );
  console.log(
    `  МК states ${c.dkiTotalPerMinistry} ДКИ; these three pages list ${c.listed}.`,
  );

  if (!apply) {
    console.log(
      "\n(dry run — pass --apply to write data/culture/dki_register.json)",
    );
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(register, null, 2)}\n`);
  console.log(`\n✓ wrote ${path.relative(process.cwd(), OUT)}`);
};

main()
  .then(() => end())
  .catch(async (err) => {
    console.error(err);
    await end();
    process.exit(1);
  });
