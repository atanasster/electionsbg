// Capture the register's COMPLETE listing — every declaration node list.xml publishes,
// with its raw `Sent` flag (audit T3.5).
//
// THE FLAG IS NOT A COMPLIANCE SIGNAL. T3.5 was written on the premise that Sent != "True"
// means "не е подал декларация". It does not: 2015/640E558D-…66791.xml is listed
// <Sent>False</Sent> and returns HTTP 200 with a complete 33,702-byte declaration. 3,052 of
// the 3,961 non-True rows name a real xmlFile. So the flag is an undocumented workflow
// state, it is stored UNINTERPRETED, and nothing here may be rendered as "did not declare".
//
// What the listing IS good for: knowing how much of what the register publishes we actually
// hold. It also exposes a real bug — every ingest skips Sent != "True"
// (scripts/officials/index.ts, scripts/declarations/index.ts, cacbg_register.ts), so those
// 3,052 real, fetchable declarations are being discarded.
//
// One request per folder; no per-declaration fetches, so it is cheap enough to re-run.
//
//   npx tsx scripts/officials/obligations.ts             # every folder the register lists
//   npx tsx scripts/officials/obligations.ts --year 2025

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";
import { Agent } from "undici";
import { command, run, optional, option, string } from "cmd-ts";
import { REGISTER_BASE } from "../lib/cacbg_register";
import { heldByFolder, TIERS } from "../declarations/coverage_lib";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const OUT = path.join(ROOT, "data/officials/obligations.json");

// Register folders that exist upstream but from which the ingest holds no declaration, so
// deriving the folder list from the local corpus alone misses them entirely.
const EXTRA_FOLDERS = ["2021_nonc"];

// register.cacbg.bg serves an incomplete TLS chain; trust it only here, as the other
// register clients in this repo do.
const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

export type Obligation = {
  /** Register folder — "2025", "2021_nc". */
  folder: string;
  declarantName: string;
  institution: string | null;
  positionTitle: string | null;
  categoryRaw: string | null;
  /** The register's `Sent` flag, VERBATIM. NOT filed/not-filed — see the header. */
  sentFlag: boolean;
  /** The filing's XML name when filed — lets a consumer join to `declaration`. */
  xmlFile: string | null;
};

const fetchListing = async (folder: string): Promise<string | null> => {
  try {
    const res = await fetch(`${REGISTER_BASE}/${folder}/list.xml`, {
      headers: { "User-Agent": "electionsbg.com obligations" },
      // @ts-expect-error dispatcher is undici-only
      dispatcher: insecureDispatcher,
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
};

export const parseObligations = (xml: string, folder: string): Obligation[] => {
  const $ = load(xml, { xmlMode: true });
  const out: Obligation[] = [];
  // Category and Institution carry their names as ATTRIBUTES — `<Category Name="…">`,
  // `<Institution Name="…">`. Reading them with find("Name") descends into the first
  // Person's <Name> element instead, which silently labels every institution with a
  // person's name.
  $("Category").each((_, cat) => {
    const categoryRaw = ($(cat).attr("Name") ?? "").trim() || null;
    $(cat)
      .find("Institution")
      .each((__, inst) => {
        const institution = ($(inst).attr("Name") ?? "").trim() || null;
        $(inst)
          .find("Person")
          .each((___, person) => {
            const declarantName = $(person).find("Name").first().text().trim();
            if (!declarantName) return;
            const positionTitle =
              $(person).find("Position > Name").first().text().trim() || null;
            $(person)
              .find("Position > Declaration")
              .each((____, decl) => {
                const sent = $(decl).find("Sent").first().text().trim();
                const xmlFile =
                  $(decl).find("xmlFile").first().text().trim() || null;
                out.push({
                  folder,
                  declarantName,
                  institution,
                  positionTitle,
                  categoryRaw,
                  // Verbatim, uninterpreted. A False here does NOT mean unfiled.
                  sentFlag: sent === "True",
                  xmlFile,
                });
              });
          });
      });
  });
  return out;
};

const cmd = command({
  name: "obligations",
  description:
    "Capture the declaration-obligation roster (filed and not filed) per register folder.",
  args: {
    year: option({
      type: optional(string),
      long: "year",
      description: "Limit to one register folder (e.g. 2025)",
    }),
  },
  handler: async ({ year }) => {
    // The folders we already hold declarations for — the same set the coverage report
    // walks. Deriving them from the corpus rather than discovering them keeps this to one
    // request per folder and guarantees the obligations line up with the filings we serve.
    // The folders we hold declarations for, UNION the ones the register publishes that we
    // hold nothing from. Deriving purely from the local corpus silently skipped
    // `2021_nonc` — 3.1 MB upstream, 6.5x the `2021_nc` folder we do read — which would
    // have published 2021 as an ~85% collapse in listings that is purely our artifact.
    const folders = year
      ? [year]
      : [
          ...new Set([
            ...TIERS.flatMap((t) => [
              ...heldByFolder(path.join(ROOT, t.dir)).keys(),
            ]),
            ...EXTRA_FOLDERS,
          ]),
        ].sort();
    if (folders.length === 0) {
      console.error("[obligations] no register folders discovered");
      process.exit(1);
    }
    const all: Obligation[] = [];
    for (const folder of folders) {
      const xml = await fetchListing(folder);
      if (xml == null) {
        console.warn(`[obligations] ${folder}: no list.xml upstream — skipped`);
        continue;
      }
      const rows = parseObligations(xml, folder);
      all.push(...rows);
      const notTrue = rows.filter((r) => !r.sentFlag).length;
      console.log(
        `[obligations] ${folder}: ${rows.length} listed, ${notTrue} with Sent != True`,
      );
    }
    if (all.length === 0) {
      console.error("[obligations] nothing captured — refusing to write");
      process.exit(1);
    }
    // Sorted so the committed file is a stable diff.
    all.sort(
      (a, b) =>
        a.folder.localeCompare(b.folder) ||
        (a.institution ?? "").localeCompare(b.institution ?? "") ||
        a.declarantName.localeCompare(b.declarantName) ||
        (a.xmlFile ?? "").localeCompare(b.xmlFile ?? ""),
    );
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(all) + "\n");
    const notTrue = all.filter((r) => !r.sentFlag).length;
    console.log(
      `[obligations] wrote ${all.length} listed declaration(s) → ${path.relative(ROOT, OUT)} ` +
        `(${notTrue} with Sent != True — an undocumented flag, NOT a non-filing)`,
    );
  },
});

run(cmd, process.argv.slice(2));
