// Where each presidential bundle comes from, what shape it arrives in, and how to
// read it — ONE map, so the downloader (T1.2), the watcher (T7.1) and the five era
// readers (Tier 2) cannot disagree about a cycle.
//
// ⚠ NOTHING ABOUT THESE URLS IS UNIFORM, and every irregularity below was measured
// on 2026-09-05 rather than inferred from a pattern:
//
//   • the archive name differs per cycle (`export.zip`, `el2011_t1.zip`,
//     `export_t1.zip`, `2001_prezident.zip`) and so does the host — 2006 lives on
//     `pvr2006.cik.bg`, not on `results.cik.bg`;
//   • 2016 serves the SAME file at both rounds' URLs (identical md5) and carries both
//     rounds inside it, so `tur2/export.zip` is not a second archive;
//   • 2001 likewise ships one archive holding both rounds;
//   • 2011's presidential data is a race folder inside a JOINT local+presidential
//     bundle, and its zip entry names are cp866;
//   • 2021's `tur1` archive is the joint parliamentary+presidential export, so only
//     its `pvr/` subtree is presidential — and its `suemg/` machine tree is SHARED
//     with the parliamentary ingest and stays in `raw_data/2021_11_14/`.
//
// ⚠ AND ONE OF THEM CANNOT BE DOWNLOADED BY NAVIGATION. `cikDownloadFile`'s
// page.goto → `download` event works for four cycles; `pvrns2021` fires no download
// event at all (measured twice, ~50 s each). What works is a user-gesture CLICK on
// the `export.zip` anchor of the round's `csv.html` — 130 MB in 21 s. The 2026 bundle
// will live on that same generation of the archive, so the strategy is a field here
// rather than a one-off.
//
// Plan: docs/plans/presidential-elections-v1.md §1, §2.1.

import type { PresidentialEncoding } from "./encoding";

/** Which of the two rounds. A cycle decided in round 1 would have no `2` — none has. */
export type RoundNumber = 1 | 2;

/**
 * How to get the archive through the Cloudflare-cleared Playwright session.
 *
 * `goto` navigates straight at the zip and waits for Chromium's `download` event.
 * `click` warms the listing page first and clicks the anchor — the only thing that
 * works for `pvrns2021`.
 */
export type DownloadStrategy = "goto" | "click";

/** The five publication formats. Each has its own reader in this directory. */
export type PresidentialEra = "2001" | "2006" | "2011" | "2016" | "2021";

export type Archive = {
  /** Absolute URL of the zip. */
  url: string;
  /** md5 of the downloaded archive, where one has been measured. A digest in PROSE is
   *  not re-checkable; as a field the downloader can assert it, which is the only way
   *  a claim like "both round URLs serve the same file" survives contact with a future
   *  re-publish. Absent means "not measured", never "any bytes will do". */
  md5?: string;
  /** Size of that same archive. A field rather than a comment for the same reason —
   *  and because `SOURCE.json` carries it as data, so a prose copy here would be a
   *  second spelling of one fact with nothing keeping the two in step. */
  bytes?: number;
  /** A sibling HTML page of the same cycle, visited first so the cf_clearance cookie
   *  is fresh for that path prefix. */
  warmUrl: string;
  strategy: DownloadStrategy;
};

export type RoundSource = {
  /** Key into the cycle's `archives`. Two rounds may name the SAME archive. */
  archive: string;
  /** The subtree of the extracted archive that becomes `raw_data/<cycle>/ТУРn/`.
   *  `""` means the archive root. */
  subtree: string;
  /** ISO date of this round's vote. */
  date: string;
};

export type PresidentialSource = {
  /** The `raw_data/` and `data/` folder name — `<round-1 date>_pvr`. */
  cycle: string;
  /** ЦИК's own archive slug, and what the watcher discovers. */
  slug: string;
  era: PresidentialEra;
  encoding: PresidentialEncoding;
  archives: Record<string, Archive>;
  rounds: Record<RoundNumber, RoundSource>;
  /** Why this cycle is shaped unlike its neighbours. Rendered by the downloader so an
   *  operator reads it before wondering why a path looks wrong. */
  note: string;
};

const RESULTS = "https://results.cik.bg";

export const PRESIDENTIAL_SOURCES: Record<string, PresidentialSource> = {
  "2021_11_14_pvr": {
    cycle: "2021_11_14_pvr",
    slug: "pvrns2021",
    era: "2021",
    encoding: "utf8",
    archives: {
      tur1: {
        url: `${RESULTS}/pvrns2021/tur1/export.zip`,
        md5: "4faad1057ae3693b79b087f3a75eeb78",
        bytes: 136_656_704,
        // measured 2026-09-05,
        warmUrl: `${RESULTS}/pvrns2021/tur1/csv.html`,
        // ⚠ The one cycle that refuses `goto` — see the banner.
        strategy: "click",
      },
      tur2: {
        url: `${RESULTS}/pvrns2021/tur2/export.zip`,
        md5: "845766071b27d8901a65ccd77faf05ed",
        bytes: 26_071_892,
        // measured 2026-09-05,
        warmUrl: `${RESULTS}/pvrns2021/tur2/csv.html`,
        strategy: "click",
      },
    },
    rounds: {
      1: { archive: "tur1", subtree: "pvr", date: "2021-11-14" },
      2: { archive: "tur2", subtree: "", date: "2021-11-21" },
    },
    note:
      "Round 1 was held jointly with a parliamentary election, so its archive also " +
      "carries `np/` — the parliamentary half, whose votes.txt matched " +
      "raw_data/2021_11_14/votes.txt at md5 301ce3c301c5c95b10cb86c8573fe223 when " +
      "measured on 2026-09-05 — " +
      "and ONE `suemg/` machine tree covering both ballots — block 64 parliament, " +
      "256 president. The machine tree stays under raw_data/2021_11_14/ and is NOT " +
      "duplicated here; round 2 was presidential-only and keeps its own.",
  },

  "2016_11_06_pvr": {
    cycle: "2016_11_06_pvr",
    slug: "pvrnr2016",
    era: "2016",
    encoding: "utf8",
    archives: {
      // ⚠ ONE archive for both rounds: `tur2/export.zip` downloads to the same md5
      // (recorded below), so fetching it twice is waste and treating the two URLs as
      // different archives would be a lie about the source.
      both: {
        url: `${RESULTS}/pvrnr2016/tur1/export.zip`,
        warmUrl: `${RESULTS}/pvrnr2016/tur1/csv.html`,
        strategy: "goto",
        // Measured 2026-09-05: `tur2/export.zip` downloads to this same digest,
        // which is what "one archive, both rounds" rests on.
        md5: "2aff131307eb09487212582ac565a17e",
        bytes: 1_194_252,
      },
    },
    rounds: {
      1: { archive: "both", subtree: "06.11.2016", date: "2016-11-06" },
      2: { archive: "both", subtree: "13.11.2016", date: "2016-11-13" },
    },
    note:
      "Held jointly with a national referendum, whose data is a separate download " +
      "(tur1/csv_nr.html) and out of scope — but the two share a `sections` file, so " +
      "a later referendum ingest is cheap.",
  },

  "2011_10_23_pvr": {
    cycle: "2011_10_23_pvr",
    slug: "mipvr2011",
    era: "2011",
    encoding: "cp1251",
    archives: {
      tur1: {
        url: `${RESULTS}/mipvr2011/el2011_t1.zip`,
        warmUrl: `${RESULTS}/mipvr2011/tur1/prezidentski/index.html`,
        strategy: "goto",
        // ⚠ NO md5: this archive was never downloaded here. Round 1's presidential
        // files were copied out of the pre-existing (gitignored) local tree
        // raw_data/2011_10_23_mi/ТУР1/президент/, which came from the same zip. The
        // URL is the right one; the digest is simply unmeasured, and inventing one
        // would be worse than leaving it out.
      },
      tur2: {
        url: `${RESULTS}/mipvr2011/el2011_t2.zip`,
        md5: "f9bcd5dcc0ce6d64931578bea99edd6a",
        bytes: 626_112,
        // measured 2026-09-05,
        warmUrl: `${RESULTS}/mipvr2011/tur2/prezidentski/index.html`,
        strategy: "goto",
      },
    },
    rounds: {
      // ⚠ The subtree name is Cyrillic and the zip's entry names are cp866, so it
      // must be extracted with `extractZipCp866` — a different concern from the
      // cp1251 CONTENTS above.
      1: { archive: "tur1", subtree: "президент", date: "2011-10-23" },
      2: { archive: "tur2", subtree: "президент", date: "2011-10-30" },
    },
    note:
      "⚠ scripts/parsers_local/download_csv_bundle.ts ALSO points at el2011_t1.zip " +
      "(for the LOCAL races, with its own `mestni` warm page) — if ЦИК moves this " +
      "zip, both maps need it. A race folder inside the JOINT bundle: the same " +
      "archive carries общински съветници / кмет на община / кмет на кметство. " +
      "Because the " +
      "election ran through the ОИК, its section codes are on the 28-OBLAST grid " +
      "(22 = София-град, 29 = abroad) and do NOT join parliamentary sections.",
  },

  "2006_10_22_pvr": {
    cycle: "2006_10_22_pvr",
    slug: "pvr2006",
    era: "2006",
    encoding: "cp1251",
    archives: {
      tur1: {
        // ⚠ A DIFFERENT HOST — the 2006 archive was never migrated to results.cik.bg.
        url: "https://pvr2006.cik.bg/results_1/export_t1.zip",
        md5: "85413e0aa9cd8ba98be9819e4feaa7da",
        bytes: 330_058,
        // measured 2026-09-05,
        warmUrl: "https://pvr2006.cik.bg/results_1/",
        strategy: "goto",
      },
      tur2: {
        url: "https://pvr2006.cik.bg/results_2/export_t2.zip",
        md5: "2f48d318dd93f6d74302bcf197ccdbee",
        bytes: 280_078,
        // measured 2026-09-05,
        warmUrl: "https://pvr2006.cik.bg/results_2/",
        strategy: "goto",
      },
    },
    rounds: {
      1: { archive: "tur1", subtree: "pre2006_t1", date: "2006-10-22" },
      2: { archive: "tur2", subtree: "pre2006_t2", date: "2006-10-29" },
    },
    note:
      "No votes file at all: the per-ticket votes are extra COLUMNS on the protocol " +
      "rows, and the ticket names exist only as column headings in Readme.txt.",
  },

  "2001_11_11_pvr": {
    cycle: "2001_11_11_pvr",
    slug: "prezident2001",
    era: "2001",
    encoding: "mik",
    archives: {
      both: {
        url: `${RESULTS}/before_2003/2001_prezident.zip`,
        md5: "67748428e3f31fec76d4cebfd457f892",
        bytes: 8_492_795,
        // measured 2026-09-05,
        warmUrl: `${RESULTS}/`,
        strategy: "goto",
      },
    },
    rounds: {
      1: { archive: "both", subtree: "DATA/izb01pr/tur1", date: "2001-11-11" },
      2: { archive: "both", subtree: "DATA/izb01pr/tur2", date: "2001-11-18" },
    },
    note:
      "The „Деметра“ CD image. Only DATA/izb01pr/ is kept; the CD's own Read_WIN.txt " +
      "(committed beside the rounds, and decodable with this module) lists FOUR " +
      "top-level directories — DATA, DIAGRAMS (a PowerPoint viewer with Windows " +
      "DLLs), INTERNET (HTML renderings of the same figures) and BACKUP (a duplicate " +
      "of everything). Only DATA is machine-readable at section grain. Per-oblast " +
      "INI-style files (.201 round 1, .301 round 2) rather than one file per " +
      "concern, and its own (obl, obsht, sec) key space.",
  },
};

/** Cycle ids, newest first — the order a selector or a backfill should walk. */
export const PRESIDENTIAL_CYCLES: string[] = Object.keys(
  PRESIDENTIAL_SOURCES,
).sort((a, b) => b.localeCompare(a));

/**
 * Look a cycle up by its folder id or by its ЦИК slug.
 *
 * @param key - `"2021_11_14_pvr"` or `"pvrns2021"`.
 * @returns The source entry, or `null` when nothing matches — callers report the
 *   known ids rather than guessing.
 */
export const presidentialSource = (key: string): PresidentialSource | null => {
  // ⚠ `hasOwn`, not a truthiness test on the index: a plain object literal answers
  // `PRESIDENTIAL_SOURCES["toString"]` with `Function.prototype.toString`, which is
  // truthy and would be returned typed as a `PresidentialSource`. The caller then
  // reads `.cycle` off a function and gets `undefined`. Reachable from any unvalidated
  // CLI argument or watcher-discovered slug.
  // `hasOwnProperty.call`, not `Object.hasOwn`: the tsconfig lib is below ES2022.
  if (Object.prototype.hasOwnProperty.call(PRESIDENTIAL_SOURCES, key)) {
    return PRESIDENTIAL_SOURCES[key];
  }
  return (
    Object.values(PRESIDENTIAL_SOURCES).find((s) => s.slug === key) ?? null
  );
};

/**
 * The `ТУРn` folder a round's files live in, under `raw_data/<cycle>/`.
 *
 * ⚠ The name is CYRILLIC, so a hand-built literal is a typo waiting to happen that
 * review cannot see (`ТУР` vs `TУР` vs `TYP`). Every reader and test builds it here.
 *
 * @param round - 1 or 2.
 * @returns `"ТУР1"` / `"ТУР2"`.
 */
export const roundFolderName = (round: RoundNumber): string => `ТУР${round}`;

/**
 * The distinct archives a cycle must download, with the rounds each one serves.
 *
 * ⚠ Two rounds can name ONE archive (2016, 2001), so a downloader that iterates
 * rounds fetches the same 8 MB twice and — worse — implies the source publishes two
 * files when it publishes one.
 *
 * @param source - A cycle entry.
 * @returns One entry per distinct archive key.
 */
export const archivesToFetch = (
  source: PresidentialSource,
): { key: string; archive: Archive; rounds: RoundNumber[] }[] => {
  const rounds = Object.entries(source.rounds) as [string, RoundSource][];
  const byArchive = new Map<string, RoundNumber[]>();
  for (const [round, spec] of rounds) {
    const list = byArchive.get(spec.archive) ?? [];
    list.push(Number(round) as RoundNumber);
    byArchive.set(spec.archive, list);
  }
  return [...byArchive.entries()].map(([key, rs]) => {
    // `noUncheckedIndexedAccess` is off project-wide, so this index types as `Archive`
    // even when the key is absent — a round naming a typo'd archive would otherwise
    // surface as `undefined.url` inside the downloader rather than here.
    const archive = source.archives[key] as Archive | undefined;
    if (!archive) {
      throw new Error(
        `${source.cycle}: round(s) ${rs.join("/")} name archive "${key}", which is ` +
          `not in archives (${Object.keys(source.archives).join(", ")})`,
      );
    }
    // Numeric comparator, and on a COPY: the default sort is lexicographic, and `rs`
    // is a live Map value.
    return { key, archive, rounds: [...rs].sort((a, b) => a - b) };
  });
};
