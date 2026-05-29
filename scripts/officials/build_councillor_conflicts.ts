// Per-(councillor, resolution) conflict-of-interest detection.
//
// Cross-references each councillor's declared / TR-derived company links
// (data/officials/derived/company_links.json) against every resolution
// in the per-município votes shards (data/council/votes/*.json) plus the
// slim index (data/council/index.json) for the resolution titles. When a
// councillor's company name appears verbatim in a resolution they voted on,
// emit a conflict flag.
//
// Matching strategy is deliberately CONSERVATIVE — we want zero false
// positives even if we miss some real conflicts. Specifically:
//
//   1. Strip corporate suffixes from the company name (ЕООД / ООД / АД /
//      ЕАД / ЕТ / ДЗЗД / „"-quotes / punctuation).
//   2. Uppercase + diacritic-fold both sides.
//   3. Require the *whole* cleaned company name (length ≥ 5) to appear as
//      a substring of the resolution title. Single-token "ВОДА" or "ТРАНС"
//      matches are dropped — they're too generic.
//   4. Skip companies with a name shorter than 5 chars or that match a
//      stop-list of generic words ("ОБЩИНА", "СТОЛИЧНА", "ГРАД", etc.) —
//      those appear in almost every resolution.
//
// Output:
//   data/officials/derived/councillor_conflicts.json
//     {
//       generatedAt: ISO,
//       byObshtina: {
//         <officialsCode>: {
//           byResolution: {
//             <resolutionId>: {
//               flags: [
//                 { slug, name, companyName, uic, trRole, vote }
//               ]
//             }
//           }
//         }
//       }
//     }
//
// The frontend tile fetches this lazily — only the resolution-id keys for
// the currently-visible resolutions need to be resolved.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { command, run, flag, boolean } from "cmd-ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const VOTES_DIR = path.join(ROOT, "data", "council", "votes");
const COUNCIL_INDEX = path.join(ROOT, "data", "council", "index.json");
const COMPANY_LINKS = path.join(
  ROOT,
  "data",
  "officials",
  "derived",
  "company_links.json",
);
const SHARD_DIR = path.join(
  ROOT,
  "data",
  "officials",
  "municipal",
  "by_obshtina",
);
const OUT_PATH = path.join(
  ROOT,
  "data",
  "officials",
  "derived",
  "councillor_conflicts.json",
);

// Same code translation as build_councillor_signals.
const COUNCIL_TO_OFFICIALS: Record<string, string> = {
  SOF: "SFO_CITY",
  VTR01: "VTR04",
  PDV01: "PDV22",
  VAR01: "VAR06",
  BGS01: "BGS04",
  SZR01: "SZR31",
  RSE01: "RSE27",
  PVN01: "PVN24",
  SLV01: "SLV20",
  BLG03: "BLG03",
  GAB05: "GAB05",
  SZR12: "SZR12",
};

// Words / fragments that appear in nearly every council resolution and so
// can't serve as a conflict signal even when they're part of a company
// name. The list is intentionally narrow — we'd rather miss a flag than
// fabricate one.
const STOP_TOKENS = new Set([
  "ОБЩИНА",
  "ОБЩИНСКА",
  "ОБЩИНСКО",
  "СТОЛИЧНА",
  "БЪЛГАРИЯ",
  "ГРАД",
  "СОФИЯ",
  "БУРГАС",
  "ПЛОВДИВ",
  "ВАРНА",
  "РУСЕ",
  "ПЛЕВЕН",
  "ВЕЛИКО",
  "ТЪРНОВО",
  "СЛИВЕН",
  "СТАРА",
  "ЗАГОРА",
  "БЛАГОЕВГРАД",
  "ИНВЕСТ",
  "ХОЛДИНГ",
  "ГРУП",
  "ПРОЕКТ",
  "СЕРВИЗ",
  "СТРОЙ",
  "ТРАНС",
  "ВОДА",
  "ГАЗ",
  "ЕЛЕКТРО",
  "АВТО",
]);

const SUFFIX_RE =
  /\s*(ЕООД|ООД|АД|ЕАД|ЕТ|ДЗЗД|ЕСНК|КООП|КООПЕРАЦИЯ|ЕТМ|ДД|ХОЛДИНГ|ИНВЕСТ)\b\.?/giu;

const normaliseForMatch = (raw: string): string =>
  raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[„"""''`]/g, "")
    .replace(SUFFIX_RE, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// --- Types ---------------------------------------------------------------

type CompanyLink = {
  uic: string | null;
  companyName: string | null;
  trRole: string | null;
  source: string;
  confidence: string;
  namesakeCount: number;
};

type CompanyLinksFile = {
  byOfficial: Record<
    string,
    {
      slug: string;
      name: string;
      tier: "municipal" | "executive";
      municipality: string | null;
      links: CompanyLink[];
    }
  >;
};

type VoteRow = {
  name: string;
  normKey: string;
  vote: "for" | "against" | "abstain";
};

type VotesShard = {
  obshtinaCode: string;
  votesById: Record<string, VoteRow[]>;
};

type CouncilIndex = {
  resolutionsByObshtina: Record<string, Array<{ id: string; title: string }>>;
};

type ConflictFlag = {
  slug: string;
  name: string;
  companyName: string;
  uic: string | null;
  trRole: string | null;
  vote: "for" | "against" | "abstain";
};

type ConflictsFile = {
  generatedAt: string;
  byObshtina: Record<
    string,
    {
      byResolution: Record<string, { flags: ConflictFlag[] }>;
    }
  >;
};

// --- Name normalisation for roster join (matches build_councillor_signals) ----

const normaliseName = (raw: string): string =>
  raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[-\s]+/g, " ")
    .trim();

const firstLastKey = (full: string): string => {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return normaliseName(full);
  return normaliseName(`${parts[0]} ${parts[parts.length - 1]}`);
};

// --- Main ----------------------------------------------------------------

const main = (dryRun: boolean) => {
  const companyLinks = JSON.parse(
    fs.readFileSync(COMPANY_LINKS, "utf8"),
  ) as CompanyLinksFile;
  const councilIdx = JSON.parse(
    fs.readFileSync(COUNCIL_INDEX, "utf8"),
  ) as CouncilIndex;

  // Pre-normalise each official's companies — keep only those whose cleaned
  // name is ≥ 5 chars and not in the stop list.
  type EligibleCompany = {
    raw: string;
    normalised: string;
    uic: string | null;
    trRole: string | null;
  };
  const companiesBySlug = new Map<string, EligibleCompany[]>();
  let kept = 0;
  let dropped = 0;
  for (const slug of Object.keys(companyLinks.byOfficial)) {
    const off = companyLinks.byOfficial[slug];
    if (off.tier !== "municipal") continue;
    const eligible: EligibleCompany[] = [];
    for (const l of off.links) {
      const name = l.companyName;
      if (!name) {
        dropped++;
        continue;
      }
      const normalised = normaliseForMatch(name);
      if (
        normalised.length < 5 ||
        STOP_TOKENS.has(normalised) ||
        // Single-token short names are too generic.
        (!/\s/.test(normalised) && normalised.length < 6)
      ) {
        dropped++;
        continue;
      }
      eligible.push({
        raw: name,
        normalised,
        uic: l.uic,
        trRole: l.trRole,
      });
      kept++;
    }
    if (eligible.length > 0) companiesBySlug.set(slug, eligible);
  }
  console.log(
    `[conflicts] eligible company links: ${kept} kept, ${dropped} dropped ` +
      `(short / suffix-only / generic)`,
  );

  const out: ConflictsFile = {
    generatedAt: new Date().toISOString(),
    byObshtina: {},
  };

  const voteFiles = fs.existsSync(VOTES_DIR)
    ? fs.readdirSync(VOTES_DIR).filter((f) => f.endsWith(".json"))
    : [];

  for (const f of voteFiles) {
    const councilCode = f.replace(/\.json$/, "");
    const officialsCode = COUNCIL_TO_OFFICIALS[councilCode] ?? councilCode;
    const shardPath = path.join(SHARD_DIR, `${officialsCode}.json`);
    if (!fs.existsSync(shardPath)) {
      console.warn(`[conflicts] no officials shard for ${councilCode}`);
      continue;
    }
    const votes = JSON.parse(
      fs.readFileSync(path.join(VOTES_DIR, f), "utf8"),
    ) as VotesShard;
    const roster = JSON.parse(fs.readFileSync(shardPath, "utf8")) as {
      entries: Array<{
        slug: string;
        name: string;
        role: string;
      }>;
    };

    // first+last → slug lookup so we can resolve the vote row to a slug,
    // then to companiesBySlug.
    const slugByKey = new Map<string, string>();
    for (const e of roster.entries) {
      if (
        e.role !== "councillor" &&
        e.role !== "council_chair" &&
        e.role !== "deputy_mayor" &&
        e.role !== "mayor"
      )
        continue;
      const key = firstLastKey(e.name);
      if (!slugByKey.has(key)) slugByKey.set(key, e.slug);
    }

    // Resolution-title lookup by id. The slim index can carry up to 200
    // resolutions per município; the votes shard's keys are a subset.
    const titleById = new Map<string, string>();
    const slim = councilIdx.resolutionsByObshtina[councilCode] ?? [];
    for (const r of slim) titleById.set(r.id, r.title || "");

    let muniFlags = 0;
    const byResolution: Record<string, { flags: ConflictFlag[] }> = {};
    for (const rid of Object.keys(votes.votesById)) {
      const title = titleById.get(rid);
      if (!title) continue;
      const normalisedTitle = normaliseForMatch(title);
      const flags: ConflictFlag[] = [];
      for (const row of votes.votesById[rid]) {
        const key = firstLastKey(row.name);
        const slug = slugByKey.get(key);
        if (!slug) continue;
        const companies = companiesBySlug.get(slug);
        if (!companies) continue;
        // Conservative substring test against the title text.
        for (const c of companies) {
          if (normalisedTitle.includes(c.normalised)) {
            flags.push({
              slug,
              name: row.name,
              companyName: c.raw,
              uic: c.uic,
              trRole: c.trRole,
              vote: row.vote,
            });
            break; // one company hit per (councillor, resolution) is enough
          }
        }
      }
      if (flags.length > 0) {
        byResolution[rid] = { flags };
        muniFlags += flags.length;
      }
    }

    if (muniFlags > 0) {
      out.byObshtina[officialsCode] = { byResolution };
    }
    console.log(
      `  ${officialsCode}: ${muniFlags} conflict flag(s) across ${Object.keys(byResolution).length} resolution(s)`,
    );
  }

  if (dryRun) {
    console.log("[conflicts] dry-run: no output written");
    return;
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  const bytes = fs.statSync(OUT_PATH).size;
  console.log(
    `[conflicts] wrote ${OUT_PATH} (${(bytes / 1024).toFixed(1)} KB)`,
  );
};

const cli = command({
  name: "build-councillor-conflicts",
  description:
    "Cross-reference councillors' declared/TR company links against resolution titles to flag potential conflicts of interest. Conservative substring match — designed for zero false positives, may miss real cases.",
  args: {
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      description: "Report per-município flag counts without writing the file.",
    }),
  },
  handler: ({ dryRun }) => main(dryRun),
});

run(cli, process.argv.slice(2));
