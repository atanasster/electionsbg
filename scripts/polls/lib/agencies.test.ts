import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AGENCY_REGISTRY,
  agencyById,
  matchAgencies,
  matchAgency,
  PRESS_ONLY_AGENCIES,
  SITE_AGENCIES,
} from "./agencies";
import type { Agency } from "@/data/polls/pollsTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agencies: Agency[] = JSON.parse(
  readFileSync(
    path.resolve(__dirname, "../../../data/polls/agencies.json"),
    "utf8",
  ),
);

describe("agency registry shape", () => {
  it("gives every agency a unique id", () => {
    const ids = AGENCY_REGISTRY.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses ids that can key a poll id", () => {
    // `pollId` lowercases the agency id and then requires /^[a-z0-9]+$/, because
    // an id is `<agency>-<ISO>` and a separator or whitespace makes it
    // unsplittable. Mirrored here so a new registry id fails before it can mint
    // a poll rather than at the first ingest that uses it.
    for (const a of AGENCY_REGISTRY)
      expect(a.id.toLowerCase(), `${a.id} is not [a-z0-9]+`).toMatch(
        /^[a-z0-9]+$/,
      );
  });

  it("keeps every alias lowercase, NFC, trimmed, non-empty and unique", () => {
    // The registry is hand-edited and is now the single routing table. An alias
    // pasted in NFD would silently never match (the matcher NFC-normalises its
    // INPUT, not the table), and an empty alias would match EVERY input, since
    // "anything".includes("") is true.
    const seen = new Map<string, string>();
    for (const a of AGENCY_REGISTRY)
      for (const alias of [...a.aliases, ...(a.wordAliases ?? [])]) {
        expect(alias, `${a.id}: "${alias}" is not lowercase`).toBe(
          alias.toLowerCase(),
        );
        expect(alias, `${a.id}: "${alias}" is not NFC`).toBe(
          alias.normalize("NFC"),
        );
        expect(alias, `${a.id}: "${alias}" is untrimmed`).toBe(alias.trim());
        expect(
          alias.length,
          `${a.id}: an empty alias matches everything`,
        ).toBeGreaterThan(0);
        expect(
          seen.get(alias),
          `alias "${alias}" is on both ${seen.get(alias)} and ${a.id}`,
        ).toBeUndefined();
        seen.set(alias, a.id);
      }
  });

  it("keeps bare-substring aliases long enough not to hit ordinary words", () => {
    // The floor that keeps `aliases` safe as substrings. Anything shorter is a
    // `wordAlias`, matched only at a boundary — see the interface doc.
    for (const a of AGENCY_REGISTRY)
      for (const alias of a.aliases)
        expect(
          alias.length,
          `${a.id}: "${alias}" is short enough to substring-hit an ordinary word`,
        ).toBeGreaterThanOrEqual(4);
  });

  it("gives every press-reach agency a query and every site agency a host", () => {
    for (const a of AGENCY_REGISTRY) {
      if (a.reach === "press") {
        expect(
          a.pressQuery,
          `${a.id} is press-reach with no query`,
        ).toBeTruthy();
        expect(
          a.listingHost,
          `${a.id} is press-reach with a listing host`,
        ).toBeNull();
      } else {
        expect(
          a.listingHost,
          `${a.id} is site-reach with no host`,
        ).toBeTruthy();
        // A site-reach agency whose seed says it has no website would be
        // published as website-less into any fresh store while its own lister
        // reads that host — a record contradicting the code that fetches it.
        expect(
          a.seed.website,
          `${a.id} is site-reach with a null seed website`,
        ).toBeTruthy();
      }
    }
  });

  it("seeds each entry with its own id", () => {
    for (const a of AGENCY_REGISTRY) expect(a.seed.id).toBe(a.id);
  });
});

describe("agency registry routing", () => {
  it("routes every published agency to a watcher or the press arm", () => {
    // The completeness claim the plan makes in §2.1: no agency in the corpus is
    // left with no route to us. A new agency in agencies.json that nothing can
    // reach fails here rather than being discovered as a silent gap.
    const routed = new Set(
      [...SITE_AGENCIES, ...PRESS_ONLY_AGENCIES].map((a) => a.id),
    );
    const unrouted = agencies.map((a) => a.id).filter((id) => !routed.has(id));
    expect(unrouted).toEqual([]);
  });

  it("excludes Gallup from the press-discovery watcher", () => {
    // It carries a pressQuery, but its own two-armed watcher owns that query.
    // Querying it here too would report one poll twice under two sources.
    expect(PRESS_ONLY_AGENCIES.map((a) => a.id)).not.toContain("GIB");
    expect(agencyById("GIB")?.pressQuery).toBeTruthy();
  });

  it("splits site and press reach with no overlap and no gap", () => {
    const site = new Set(SITE_AGENCIES.map((a) => a.id));
    const press = new Set(PRESS_ONLY_AGENCIES.map((a) => a.id));
    for (const id of site) expect(press.has(id)).toBe(false);
    expect(site.size + press.size).toBe(AGENCY_REGISTRY.length);
  });
});

describe("matchAgency", () => {
  it("matches the names that appear in the wild", () => {
    expect(matchAgency("Alpha Research")?.id).toBe("AR");
    expect(matchAgency("„Алфа Рисърч“")?.id).toBe("AR");
    expect(matchAgency("Alpha Reasearch")?.id).toBe("AR"); // the wiki's typo
    expect(matchAgency("Сова Харис")?.id).toBe("SH");
    expect(matchAgency("Маркет ЛИНКС")?.id).toBe("ML");
    expect(matchAgency("Глобал Метрикс")?.id).toBe("GM");
    expect(matchAgency("Екзакта")?.id).toBe("EX");
    expect(matchAgency("Тренд")?.id).toBe("TR");
    expect(matchAgency("„Медиана“")?.id).toBe("MD");
    expect(matchAgency("Мяра")?.id).toBe("MY");
    expect(matchAgency("ЦАМ")?.id).toBe("CAM");
    expect(matchAgency("АФИС")?.id).toBe("AF");
    expect(matchAgency("ИМП")?.id).toBe("IMP");
    // The 2016/2021 wiki cells run the two words together.
    expect(matchAgency("Барометър България")?.id).toBe("BB");
    expect(matchAgency("БарометърБългария")?.id).toBe("BB");
  });

  it("resolves an agency named several ways in one cell to itself", () => {
    // "Gallup International Balkan" contains "gallup" and "gallup
    // international" too — three aliases, one agency, so this is not ambiguity.
    expect(matchAgency("Gallup International Balkan")?.id).toBe("GIB");
    expect(matchAgency("Галъп Интернешънъл Болкан")?.id).toBe("GIB");
    expect(matchAgency("Gallup")?.id).toBe("GIB");
  });

  it("does not attribute an ordinary word to an agency", () => {
    // Every one of these resolved to an agency before the alias tiering:
    // имп→IMP, барометър→BB, trend→TR, медиана→MD, цам→CAM. A false positive
    // here is not noise — a non-null match is what keeps a row OUT of
    // `unknownAgencies` and ingests it under that agency's id, onto a corpus
    // that publishes a named third party's accuracy record.
    for (const t of [
      "Олимп",
      "Импулс",
      "Импакт",
      "Импириъл Рисърч",
      "Политически барометър на НЦИОМ",
      "Trends in Bulgarian politics",
      "Медианата на доходите",
      "ЦАМпион",
    ])
      expect(
        matchAgency(t),
        `"${t}" was attributed to ${matchAgency(t)?.id}`,
      ).toBeNull();
  });

  it("REFUSES text naming two agencies rather than picking one", () => {
    // A headline citing two pollsters is ordinary, and the press arm's input is
    // headlines. Any tie-break would be a property of how verbosely each agency
    // is spelled in the registry rather than of the text — so this refuses, and
    // the row lands in the human-review channel.
    for (const t of [
      "Тренд и Барометър България",
      "Галъп и Център за анализи и маркетинг",
      "Тренд и Галъп с различни данни",
    ])
      expect(matchAgency(t), `"${t}" resolved to a single agency`).toBeNull();
  });

  it("returns null for a name it does not know", () => {
    expect(matchAgency("Централна избирателна комисия")).toBeNull();
    expect(matchAgency("")).toBeNull();
    expect(matchAgency("Някаква нова агенция")).toBeNull();
  });

  it("returns a seed COPY, so a caller cannot corrupt the registry", () => {
    const first = matchAgency("Мяра");
    first!.agency.name_bg = "MUTATED";
    expect(matchAgency("Мяра")?.agency.name_bg).toBe("Мяра");
    expect(agencyById("MY")?.seed.name_bg).toBe("Мяра");
  });
});

describe("matchAgencies", () => {
  it("reports every agency named, so a caller can see the ambiguity", () => {
    expect(
      matchAgencies("Тренд и Барометър България")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["BB", "TR"]);
    expect(
      matchAgencies("Галъп и Център за анализи и маркетинг")
        .map((m) => m.id)
        .sort(),
    ).toEqual(["CAM", "GIB"]);
  });

  it("counts one agency once however many of its aliases hit", () => {
    const m = matchAgencies("Gallup International Balkan");
    expect(m.map((x) => x.id)).toEqual(["GIB"]);
    // …and reports the LONGEST alias that matched, which is the most specific
    // evidence for the attribution.
    expect(m[0].alias).toBe("gallup international balkan");
  });

  it("returns nothing for text naming no agency", () => {
    expect(matchAgencies("Олимп")).toEqual([]);
  });
});

describe("registry ↔ agencies.json", () => {
  it("agrees with the record store on every id it already holds", () => {
    const stored = new Set(agencies.map((a) => a.id));
    const registered = new Set(AGENCY_REGISTRY.map((a) => a.id));
    const inStoreOnly = [...stored].filter((id) => !registered.has(id));
    expect(inStoreOnly).toEqual([]);
  });

  it("keeps each seed consistent with the stored record it shadows", () => {
    // The store WINS (mergeAgencies keeps the existing row), so a seed that
    // disagrees is a record waiting to be published wrong into any fresh store.
    const stored = new Map(agencies.map((a) => [a.id, a]));
    for (const a of AGENCY_REGISTRY) {
      const s = stored.get(a.id);
      if (!s) continue; // a genuinely new agency has no stored row yet
      for (const k of [
        "website",
        "name_bg",
        "name_en",
        "abbr_bg",
        "abbr_en",
      ] as const)
        expect(a.seed[k], `${a.id}.${k}: seed and store disagree`).toBe(s[k]);
    }
  });

  it("routes each stored agency's own published name back to itself", () => {
    // What keeps this registry honest against the SEPARATE matcher in
    // ai/tools/pollsDepth.ts, which resolves user utterances against these same
    // published names. An alias edit that broke this would be silent otherwise.
    for (const s of agencies)
      for (const field of ["name_bg", "name_en"] as const) {
        const m = matchAgency(s[field]);
        expect(
          m?.id,
          `${s.id}.${field} "${s[field]}" resolved to ${m?.id ?? "null"}`,
        ).toBe(s.id);
      }
  });
});
