/**
 * Build data/postcode_ekatte.json — a join of the Bulgarian Post postal-code
 * register (CC0, published on data.egov.bg) against data/settlements.json so
 * we can resolve a raw "БЪЛГАРИЯ, с. Лозен, 1151" string to a specific EKATTE
 * when the bare settlement name is ambiguous (Лозен exists 5×).
 *
 * Source — data.egov.bg resource a3edccd8-65d1-4e4b-b5f7-9aa2d7367455
 *   Columns: [postcode, settlement, община/район-за София, област]
 *   ~5,290 settlement rows. Sofia city itself collapses to a single row
 *   (`1000 | София | "" | София`); Stolichna satellites (Балша, Бистрица, …)
 *   are listed individually.
 *
 * Output:
 *   data/postcode_ekatte.json — { asOf, fetchedAt, source, rows, byPostcode }
 *     byPostcode[code] = { ekatte: string[], names: string[] }
 *
 * Sofia city: the bgpost "1000 София" row maps to the synthetic EKATTE 68134
 * (see scripts/lib/oblast_names.ts). All other Sofia postcodes — Stolichna
 * satellite villages and the per-rayon city codes — resolve normally.
 *
 * Unresolved rows are written to data/parliament/postcode_unresolved.json for
 * a human to review (typically a handful of legacy renamings).
 */

import fs from "fs";
import path from "path";
import { OBLAST_CODES_BY_BG_NAME, SOFIA_EKATTE } from "../lib/oblast_names";

const BG_POST_RESOURCE_URI = "a3edccd8-65d1-4e4b-b5f7-9aa2d7367455";
const BG_POST_API = "https://data.egov.bg/api/getResourceData";
const SOURCE_PAGE =
  "https://data.egov.bg/data/view/acb135ab-00a2-4aa7-b5e5-49c992385ef5";

type Settlement = {
  ekatte: string;
  name: string;
  oblast: string;
  t_v_m?: string;
};

type PostcodeRow = {
  ekatte: string[];
  names: string[];
};

export type PostcodeEkatteFile = {
  asOf: string;
  fetchedAt: string;
  source: string;
  rows: number;
  byPostcode: Record<string, PostcodeRow>;
};

const normalizeName = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, " ").replace(/ё/g, "е").trim();

const fetchBgPostRows = async (): Promise<string[][]> => {
  const res = await fetch(BG_POST_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource_uri: BG_POST_RESOURCE_URI }),
  });
  if (!res.ok) {
    throw new Error(`BG Post API: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { success: boolean; data: string[][] };
  if (!json.success || !Array.isArray(json.data)) {
    throw new Error("BG Post API returned unexpected payload");
  }
  return json.data.slice(1); // strip header row
};

export type BuildPostcodeEkatteArgs = {
  stringify: (o: object) => string;
  /** Override the source loader (used in tests so we don't hit the network). */
  fetchRows?: () => Promise<string[][]>;
};

export const buildPostcodeEkatte = async ({
  stringify,
  fetchRows,
}: BuildPostcodeEkatteArgs): Promise<void> => {
  const settlementsPath = path.join(process.cwd(), "data", "settlements.json");
  if (!fs.existsSync(settlementsPath)) {
    console.warn(`[postcode_ekatte] ${settlementsPath} not found — skipping`);
    return;
  }
  const settlements: Settlement[] = JSON.parse(
    fs.readFileSync(settlementsPath, "utf-8"),
  );

  const byName = new Map<string, Settlement[]>();
  for (const s of settlements) {
    const k = normalizeName(s.name);
    const bucket = byName.get(k);
    if (bucket) bucket.push(s);
    else byName.set(k, [s]);
  }

  console.log(`[postcode_ekatte] fetching ${SOURCE_PAGE} …`);
  let rows: string[][];
  try {
    rows = await (fetchRows ?? fetchBgPostRows)();
  } catch (err) {
    console.error(`[postcode_ekatte] fetch failed: ${(err as Error).message}`);
    return;
  }

  const byPostcode: Record<string, PostcodeRow> = {};
  const unresolved: Array<{
    postcode: string;
    settlement: string;
    obshtina: string;
    oblast: string;
    reason: string;
  }> = [];

  let resolved = 0;
  for (const row of rows) {
    const [postcodeRaw, settlementRaw, obshtinaRaw, oblastRaw] = row;
    if (!postcodeRaw || !settlementRaw) continue;
    const postcode = postcodeRaw.trim();
    const settlement = settlementRaw.trim();
    const oblastBgRaw = (oblastRaw ?? "").trim();
    const oblastBg =
      oblastBgRaw === "София-" || oblastBgRaw === "София."
        ? "София"
        : oblastBgRaw;
    const obshtina = (obshtinaRaw ?? "").trim();

    // Sofia city collapse — the single "1000 София" row maps to synthetic
    // EKATTE 68134. Everything else under София oblast (satellites, rayon
    // codes) goes through the normal name-based join below.
    if (settlement === "София" && obshtina === "" && oblastBg === "София") {
      byPostcode[postcode] = { ekatte: [SOFIA_EKATTE], names: ["София"] };
      resolved++;
      continue;
    }

    const candidates = byName.get(normalizeName(settlement)) ?? [];
    if (candidates.length === 0) {
      unresolved.push({
        postcode,
        settlement,
        obshtina,
        oblast: oblastBg,
        reason: "no settlement match",
      });
      continue;
    }

    const oblastCodes = new Set(OBLAST_CODES_BY_BG_NAME[oblastBg] ?? []);
    const filtered =
      oblastCodes.size > 0
        ? candidates.filter((c) => oblastCodes.has(c.oblast))
        : candidates;

    if (filtered.length === 0) {
      unresolved.push({
        postcode,
        settlement,
        obshtina,
        oblast: oblastBg,
        reason: `name matches ${candidates.length} settlement(s) but none in oblast ${oblastBg}`,
      });
      continue;
    }

    // Prefer city (гр.) over village when both exist in the same oblast.
    const cities = filtered.filter((c) => c.t_v_m === "гр.");
    const chosen = cities.length === 1 ? cities : filtered;

    byPostcode[postcode] = {
      ekatte: chosen.map((c) => c.ekatte),
      names: Array.from(new Set(chosen.map((c) => c.name))),
    };
    resolved++;
  }

  const out: PostcodeEkatteFile = {
    asOf: "2023-10-03", // BG Post dataset's stated last-updated date
    fetchedAt: new Date().toISOString(),
    source: SOURCE_PAGE,
    rows: rows.length,
    byPostcode,
  };

  const dataOutPath = path.join(process.cwd(), "data", "postcode_ekatte.json");
  fs.writeFileSync(dataOutPath, stringify(out), "utf-8");
  console.log(
    `[postcode_ekatte] wrote ${Object.keys(byPostcode).length} postcodes ` +
      `(${resolved}/${rows.length} resolved) → ${dataOutPath}`,
  );

  if (unresolved.length > 0) {
    const unresolvedPath = path.join(
      process.cwd(),
      "data",
      "parliament",
      "postcode_unresolved.json",
    );
    fs.mkdirSync(path.dirname(unresolvedPath), { recursive: true });
    fs.writeFileSync(unresolvedPath, stringify(unresolved), "utf-8");
    console.log(
      `[postcode_ekatte] ${unresolved.length} unresolved row(s) logged → ${unresolvedPath}`,
    );
  }
};

// CLI entry — `tsx scripts/parliament/build_postcode_ekatte.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  buildPostcodeEkatte({ stringify: (o) => JSON.stringify(o, null, 2) }).catch(
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
