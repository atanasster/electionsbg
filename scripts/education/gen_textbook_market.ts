// Generate the textbook-publisher concentration payload for the МОН pack from
// the public-procurement corpus (CPV 22112 „Учебници"). Reads the committed
// contract shards (data/procurement/contracts/*/*.json) — the same source of
// truth the site already ships — so it needs no DB and runs in CI.
//
// Output: data/education/textbook_market.json, consumed by useTextbookMarket +
// the TextbookConcentrationTile. Publisher legal entities are rolled up into
// groups via src/lib/textbookPublishers.ts (the Просвета group is 3 EIKs; Klett
// is the Анубис+Булвест merge) so the concentration figure is honest.
//
// Run: `npx tsx scripts/education/gen_textbook_market.ts`

import fs from "node:fs";
import path from "node:path";
import {
  TEXTBOOK_CPV_PREFIX,
  PUBLISHER_GROUP_BY_EIK,
  cleanPublisherName,
  type PublisherGroupId,
} from "../../src/lib/textbookPublishers";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const SHARD_DIR = path.join(PROJECT_ROOT, "data/procurement/contracts");
const OUT_DIR = path.join(PROJECT_ROOT, "data/education");
const OUT_FILE = path.join(OUT_DIR, "textbook_market.json");

type Contract = {
  tag?: string;
  cpv?: string;
  date?: string;
  amountEur?: number;
  awarderEik?: string;
  awarderName?: string;
  contractorEik?: string;
  contractorName?: string;
};

const round = (n: number) => Math.round(n);

// Bucket a contractor into a publisher group. Known EIKs map directly; unknown
// ones fall through to a name-derived bucket so the tail is still labelled.
const groupOf = (eik: string, name: string): PublisherGroupId => {
  const byEik = PUBLISHER_GROUP_BY_EIK[eik];
  if (byEik) return byEik;
  const n = name.toLowerCase();
  if (/просвета/.test(n)) return "prosveta";
  if (/клет|klett|анубис|булвест/.test(n)) return "klett";
  if (/архимед/.test(n)) return "arhimed";
  if (/педагог\s*6/.test(n)) return "pedagog6";
  if (/домино/.test(n)) return "domino";
  if (/бит\s*и\s*техника/.test(n)) return "bit";
  if (/рива/.test(n)) return "riva";
  if (/колибри/.test(n)) return "kolibri";
  return "other";
};

const buyerType = (
  name: string,
): "school" | "municipality" | "ministry" | "other" => {
  const n = name.toLowerCase();
  // NB: JS `\b` is ASCII-only and never fires next to a Cyrillic letter, so a
  // standalone "ДГ" (детска градина) needs an explicit whitespace/dot token test.
  if (
    /училищ|гимназия|нву|общежити|детска градина/.test(n) ||
    /(^|\s)дг(\.|\s|$)/.test(n)
  )
    return "school";
  if (/община/.test(n)) return "municipality";
  if (/министерство/.test(n)) return "ministry";
  return "other";
};

const main = () => {
  const years = fs
    .readdirSync(SHARD_DIR)
    .filter((d) => /^\d{4}$/.test(d))
    .sort();

  type Agg = { eur: number; n: number };
  const byGroup = new Map<
    PublisherGroupId,
    Agg & { entities: Map<string, Agg & { name: string }> }
  >();
  const byYear = new Map<string, Agg>();
  const byBuyerType = new Map<string, Agg & { buyers: Set<string> }>();
  const supplierKeys = new Set<string>();
  const schoolBuyers = new Set<string>();
  let totalEur = 0;
  let totalContracts = 0;

  for (const y of years) {
    const dir = path.join(SHARD_DIR, y);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const rows: Contract[] = JSON.parse(
        fs.readFileSync(path.join(dir, f), "utf8"),
      );
      for (const c of rows) {
        if (c.tag !== "contract") continue;
        if (!String(c.cpv ?? "").startsWith(TEXTBOOK_CPV_PREFIX)) continue;
        const eur = typeof c.amountEur === "number" ? c.amountEur : 0;
        if (!(eur > 0)) continue;
        totalEur += eur;
        totalContracts += 1;

        const cEik = (c.contractorEik ?? "").trim();
        const cName = (c.contractorName ?? "").trim();
        const key = cEik || cName || "—";
        supplierKeys.add(key);
        const gid = groupOf(cEik, cName);
        let g = byGroup.get(gid);
        if (!g) {
          g = { eur: 0, n: 0, entities: new Map() };
          byGroup.set(gid, g);
        }
        g.eur += eur;
        g.n += 1;
        let ent = g.entities.get(key);
        if (!ent) {
          ent = { eur: 0, n: 0, name: cleanPublisherName(cName) };
          g.entities.set(key, ent);
        }
        ent.eur += eur;
        ent.n += 1;

        const yr = (c.date ?? "").slice(0, 4) || y;
        const yAgg = byYear.get(yr) ?? { eur: 0, n: 0 };
        yAgg.eur += eur;
        yAgg.n += 1;
        byYear.set(yr, yAgg);

        const bt = buyerType(c.awarderName ?? "");
        const btAgg = byBuyerType.get(bt) ?? {
          eur: 0,
          n: 0,
          buyers: new Set<string>(),
        };
        btAgg.eur += eur;
        btAgg.n += 1;
        if (c.awarderEik) btAgg.buyers.add(c.awarderEik);
        byBuyerType.set(bt, btAgg);
        if (bt === "school" && c.awarderEik) schoolBuyers.add(c.awarderEik);
      }
    }
  }

  // Fail fast on an empty slice — otherwise every share divides by totalEur=0
  // (→ NaN) and latestYear = Math.max(...[]) = -Infinity, shipping a poisoned
  // payload the tile renders as NaN% / -Infinity.
  if (totalContracts === 0 || totalEur <= 0) {
    throw new Error(
      "gen_textbook_market: no CPV-22112 contracts parsed — refusing to write an empty/NaN payload (has the CPV prefix or corpus changed?)",
    );
  }

  // Publisher-group shares (sorted desc, deterministic tiebreak on id).
  const groups = Array.from(byGroup.entries())
    .map(([id, g]) => ({
      id,
      eur: round(g.eur),
      pct: Math.round((1000 * g.eur) / totalEur) / 10,
      contracts: g.n,
      entities: Array.from(g.entities.entries())
        .map(([eik, e]) => ({
          eik: /^\d+$/.test(eik) ? eik : null,
          name: e.name,
          eur: round(e.eur),
          contracts: e.n,
        }))
        .sort(
          (a, b) => b.eur - a.eur || (a.eik ?? "").localeCompare(b.eik ?? ""),
        )
        .slice(0, 6),
    }))
    .sort((a, b) => b.eur - a.eur || a.id.localeCompare(b.id));

  // HHI over publisher GROUPS (the honest headline) — sum of squared pct shares.
  const hhiGroup = round(
    groups.reduce((s, g) => s + Math.pow((100 * g.eur) / totalEur, 2), 0),
  );
  // CR-N and top-shares.
  const top1Pct = groups.length
    ? Math.round((1000 * groups[0].eur) / totalEur) / 10
    : 0;
  const top2Pct =
    groups.length >= 2
      ? Math.round((1000 * (groups[0].eur + groups[1].eur)) / totalEur) / 10
      : top1Pct;
  const cr4Pct =
    Math.round(
      (1000 * groups.slice(0, 4).reduce((s, g) => s + g.eur, 0)) / totalEur,
    ) / 10;

  const payload = {
    // No generatedAt timestamp — it would churn git on every run with no data
    // change (the payload is otherwise fully deterministic from the corpus).
    source: {
      publisher: "АОП / ЦАИС ЕОП (регистър на обществените поръчки)",
      cpv: `${TEXTBOOK_CPV_PREFIX}xxx`,
      note: "Textbooks are awarded under чл.79, ал.1, т.3 ЗОП (direct award to the copyright holder) — every contract is single-bidder by law; the concentration signal is upstream market share, not the tender.",
    },
    latestYear: Math.max(...Array.from(byYear.keys()).map(Number)),
    total: {
      eur: round(totalEur),
      contracts: totalContracts,
      suppliers: supplierKeys.size,
      schoolBuyers: schoolBuyers.size,
    },
    concentration: { hhiGroup, top1Pct, top2Pct, cr4Pct },
    groups,
    byYear: Array.from(byYear.entries())
      .map(([year, a]) => ({
        year: Number(year),
        eur: round(a.eur),
        contracts: a.n,
      }))
      .sort((a, b) => a.year - b.year),
    byBuyerType: Array.from(byBuyerType.entries())
      .map(([type, a]) => ({
        type,
        eur: round(a.eur),
        contracts: a.n,
        buyers: a.buyers.size,
      }))
      .sort((a, b) => b.eur - a.eur),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `Wrote ${OUT_FILE} — €${round(totalEur).toLocaleString()} · ${totalContracts} contracts · ${supplierKeys.size} suppliers · HHI(group) ${hhiGroup} · top2 ${top2Pct}%`,
  );
};

main();
