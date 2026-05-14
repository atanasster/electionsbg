// Phase 4 — budget ↔ procurement cross-link.
//
// Each first-level spending unit in the State Budget Law is also a buyer
// ("awarder") in the public-procurement data. We match the budget admin
// registry to the procurement awarders by normalised name, stamp the matched
// EIK onto the admin registry node, and emit a per-ministry procurement
// summary — so the budget dashboard can follow a ministry's appropriation
// through to the contracts it actually awarded, and flag the MP-connected ones.
//
// Non-fatal when data/procurement/ is absent (fresh clone without a
// procurement ingest): the cross-reference is simply skipped.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  ClassificationRegistry,
  MinistryProcurement,
  MinistryProcurementFile,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const AWARDERS_DIR = path.join(PROCUREMENT_DIR, "awarders");
const MP_CONNECTED_FILE = path.join(
  PROCUREMENT_DIR,
  "derived",
  "mp_connected.json",
);
const PROCUREMENT_INDEX = path.join(PROCUREMENT_DIR, "index.json");

// Definite-article → bare-form word normalisations. Bulgarian institution
// names carry the article on the leading noun/adjective ("Министерството",
// "Националния"), while the procurement data uses the bare nominative
// ("МИНИСТЕРСТВО", "НАЦИОНАЛЕН") — collapsing both to one form lets the names
// match.
const ARTICLE: Array<[string, string]> = [
  ["министерството", "министерство"],
  ["администрацията", "администрация"],
  ["народното", "народно"],
  ["сметната", "сметна"],
  ["съдебната", "съдебна"],
  ["министерския", "министерски"],
  ["конституционния", "конституционен"],
  ["държавната", "държавна"],
  ["държавния", "държавен"],
  ["комисията", "комисия"],
  ["агенцията", "агенция"],
  ["омбудсмана", "омбудсман"],
  ["службата", "служба"],
  ["националния", "национален"],
  ["националната", "национална"],
  ["националното", "национално"],
  ["централната", "централна"],
  ["съветът", "съвет"],
  ["съвета", "съвет"],
  ["бюрото", "бюро"],
  ["институтът", "институт"],
  ["института", "институт"],
  ["палатата", "палата"],
];

const normName = (s: string): string => {
  let n = (s || "")
    .toLowerCase()
    .replace(/[^а-я ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  n = n.replace(/ република българия$/, "");
  n = n
    .split(" ")
    .map((w) => ARTICLE.find((a) => a[0] === w)?.[1] ?? w)
    .join(" ");
  return n;
};

interface ProcurementAwarder {
  eik: string;
  name: string;
  norm: string;
  totalEur: number;
  contractCount: number;
}

const loadAwarders = (): ProcurementAwarder[] => {
  if (!fs.existsSync(AWARDERS_DIR)) return [];
  const out: ProcurementAwarder[] = [];
  for (const file of fs.readdirSync(AWARDERS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const a = JSON.parse(
        fs.readFileSync(path.join(AWARDERS_DIR, file), "utf8"),
      ) as {
        eik: string;
        name: string;
        totalEur: number;
        contractCount: number;
      };
      out.push({
        eik: a.eik,
        name: a.name,
        norm: normName(a.name),
        totalEur: a.totalEur ?? 0,
        contractCount: a.contractCount ?? 0,
      });
    } catch {
      // skip unreadable awarder file — non-fatal
    }
  }
  return out;
};

// Map awarder EIK → set of distinct MP-connected contractor EIKs it has paid.
const loadMpConnectedByAwarder = (): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>();
  if (!fs.existsSync(MP_CONNECTED_FILE)) return map;
  try {
    const file = JSON.parse(fs.readFileSync(MP_CONNECTED_FILE, "utf8")) as {
      entries: Array<{
        contractorEik: string;
        topAwarders?: Array<{ eik: string }>;
      }>;
    };
    for (const entry of file.entries) {
      for (const aw of entry.topAwarders ?? []) {
        let set = map.get(aw.eik);
        if (!set) {
          set = new Set();
          map.set(aw.eik, set);
        }
        set.add(entry.contractorEik);
      }
    }
  } catch {
    // non-fatal
  }
  return map;
};

const readProcurementIndexDate = (): string | null => {
  if (!fs.existsSync(PROCUREMENT_INDEX)) return null;
  try {
    return (
      (
        JSON.parse(fs.readFileSync(PROCUREMENT_INDEX, "utf8")) as {
          generatedAt?: string;
        }
      ).generatedAt ?? null
    );
  } catch {
    return null;
  }
};

// Match the admin registry to procurement awarders. Mutates the registry —
// stamping `eik` onto matched nodes — and returns the per-ministry procurement
// summary file.
export const crossReferenceProcurement = (
  adminRegistry: ClassificationRegistry,
): MinistryProcurementFile => {
  const generatedAt = new Date().toISOString();
  if (!fs.existsSync(PROCUREMENT_DIR)) {
    return { generatedAt, procurementIndexGeneratedAt: null, entries: [] };
  }

  const awarders = loadAwarders();
  const mpByAwarder = loadMpConnectedByAwarder();

  // Awarder candidates whose normalised name equals or starts with the budget
  // unit's normalised name — pick the one with the largest procurement total
  // (the principal awarding body).
  const matchAwarder = (budgetNorm: string): ProcurementAwarder | null => {
    if (budgetNorm.split(" ").length < 2) return null;
    const candidates = awarders.filter(
      (a) => a.norm === budgetNorm || a.norm.startsWith(`${budgetNorm} `),
    );
    if (candidates.length === 0) return null;
    return candidates.sort((x, y) => y.totalEur - x.totalEur)[0];
  };

  const entries: MinistryProcurement[] = [];
  for (const node of adminRegistry.nodes) {
    const hit = matchAwarder(normName(node.nameBg));
    if (!hit) continue;
    node.eik = hit.eik; // stamp the EIK onto the registry node
    entries.push({
      nodeId: node.id,
      eik: hit.eik,
      awarderName: hit.name,
      totalEur: hit.totalEur,
      contractCount: hit.contractCount,
      mpConnectedContractorCount: mpByAwarder.get(hit.eik)?.size ?? 0,
    });
  }
  entries.sort((a, b) => b.totalEur - a.totalEur);

  return {
    generatedAt,
    procurementIndexGeneratedAt: readProcurementIndexDate(),
    entries,
  };
};
