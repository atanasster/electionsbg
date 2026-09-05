// Derive `data/presidential/party_colors.json` from the parliamentary catalogues.
//
// Run it when a parliamentary cycle lands or a party colour changes:
//
//     npx tsx scripts/parsers_presidential/build_party_colors.ts          # report only
//     npx tsx scripts/parsers_presidential/build_party_colors.ts --write  # rewrite it
//
// ⚠⚠ WHY THIS EXISTS AT ALL: `data/<cycle>/cik_parties.json` IS GITIGNORED. The
// gitignore rule for the per-election data trees covers it — 0 files tracked against 13 on disk — so a fresh clone or
// a CI runner has none of them. Reading them directly made `tickets.json` lose every
// brand colour there, at exit 0, with every vote figure still reconciling: the ingest
// called itself reproducible and was not. The derived table is small, committed, and the
// only thing the ingest reads.
//
// ⚠ THE PLACEHOLDER IS EXCLUDED. `scripts/parsers/parties.ts` assigns `lightslategrey` to
// any party it has no default for and reads it back as „no colour known", so it is not a
// colour and does not belong in a colour table.
//
// Plan: docs/plans/presidential-elections-v1.md T3.3, T3.4.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLACEHOLDER_COLOR, nameKey } from "./tickets";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const PARTY_COLORS_PATH = path.join(
  PROJECT_ROOT,
  "data/presidential/party_colors.json",
);

export interface PartyColorTable {
  builtFrom: string;
  /** `nameKey` fold → `{ color?, nickName? }`. A party with neither is not here. */
  parties: Record<string, { color?: string; nickName?: string }>;
}

interface CikParty {
  name: string;
  color?: string;
  nickName?: string;
}

/**
 * Fold every committed parliamentary catalogue into one table.
 *
 * ⚠ A REAL COLOUR BEATS THE PLACEHOLDER WHATEVER THE CYCLE ORDER. „A later cycle wins" is
 * right for a rebrand and wrong here: a party with a known colour in one cycle and none in
 * a later one would be downgraded to the sentinel, losing a brand fact this repo already
 * publishes. Measured live on ВОЛЯ.
 */
export const buildPartyColors = (
  dataRoot: string,
): { table: PartyColorTable; cyclesRead: string[] } => {
  const parties: Record<string, { color?: string; nickName?: string }> = {};
  const cyclesRead: string[] = [];
  for (const dir of fs
    .readdirSync(dataRoot)
    .filter((d) => /^\d{4}_\d{2}_\d{2}$/u.test(d))
    .sort()) {
    const file = path.join(dataRoot, dir, "cik_parties.json");
    if (!fs.existsSync(file)) continue;
    cyclesRead.push(dir);
    for (const p of JSON.parse(fs.readFileSync(file, "utf8")) as CikParty[]) {
      if (!p.name) continue;
      const color =
        p.color && p.color !== PLACEHOLDER_COLOR ? p.color : undefined;
      if (!color && !p.nickName) continue;
      const key = nameKey(p.name);
      const held = parties[key];
      parties[key] = {
        // A colour once known is never given up; a nickName follows the latest spelling.
        ...((color ?? held?.color) ? { color: color ?? held?.color } : {}),
        ...((p.nickName ?? held?.nickName)
          ? { nickName: p.nickName ?? held?.nickName }
          : {}),
      };
    }
  }
  return {
    table: {
      builtFrom:
        `Derived by scripts/parsers_presidential/build_party_colors.ts from ` +
        `data/<parliamentary cycle>/cik_parties.json (${cyclesRead.length} cycles). ` +
        `Those files are GITIGNORED, which is why this table is committed. Keys are ` +
        `nameKey() folds. The "${PLACEHOLDER_COLOR}" placeholder is excluded — it is ` +
        `the catalogue's own value for "no colour known". Do not hand-edit.`,
      parties: Object.fromEntries(
        Object.entries(parties).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    cyclesRead,
  };
};

const main = (): void => {
  const { table, cyclesRead } = buildPartyColors(
    path.join(PROJECT_ROOT, "data"),
  );
  const previous = fs.existsSync(PARTY_COLORS_PATH)
    ? (JSON.parse(
        fs.readFileSync(PARTY_COLORS_PATH, "utf8"),
      ) as PartyColorTable)
    : null;
  const before = Object.keys(previous?.parties ?? {}).length;
  const after = Object.keys(table.parties).length;
  const withColor = Object.values(table.parties).filter((p) => p.color).length;
  console.log(
    `[colors] ${cyclesRead.length} parliamentary cycles → ${after} parties ` +
      `(${withColor} with a real colour), was ${before}`,
  );
  if (!cyclesRead.length) {
    // ⚠ REFUSE rather than write an empty table. On a fresh clone the source files are
    // absent by design, and a run there would otherwise replace the committed table with
    // nothing — the exact failure this table exists to prevent, arriving by the other
    // door.
    throw new Error(
      "[colors] no data/<cycle>/cik_parties.json found — those files are gitignored, " +
        "so this must run on a machine that has built the parliamentary tree",
    );
  }
  const lost = previous
    ? Object.keys(previous.parties).filter((k) => !(k in table.parties))
    : [];
  if (lost.length) {
    console.log(
      `[colors] ⚠ ${lost.length} would be LOST: ${lost.slice(0, 8).join(", ")}`,
    );
  }
  if (!process.argv.includes("--write")) {
    console.log("[colors] report only — pass --write to rewrite the table");
    return;
  }
  if (lost.length && !process.argv.includes("--allow-shrink")) {
    throw new Error(
      `[colors] refusing to write: ${lost.length} party(ies) would be lost. Pass ` +
        `--allow-shrink if that is intended.`,
    );
  }
  fs.mkdirSync(path.dirname(PARTY_COLORS_PATH), { recursive: true });
  fs.writeFileSync(PARTY_COLORS_PATH, `${JSON.stringify(table, null, 2)}\n`);
  console.log(`[colors] wrote ${PARTY_COLORS_PATH}`);
};

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main();
}
