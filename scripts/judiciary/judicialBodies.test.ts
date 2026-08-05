import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveJudicialBody,
  foldJudicialName,
  placeVocabulary,
  placeKey,
  editDistance,
  placeSlips,
  INSTITUTION_WORDS,
} from "./judicialBodies";

// The real vocabulary, so the tests exercise the production path rather than a fixture
// that could drift from it.
const MUNICIPALITIES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/municipalities.json",
);
const vocab = placeVocabulary(
  (JSON.parse(readFileSync(MUNICIPALITIES, "utf8")) as { name: string }[])
    .map((r) => r.name)
    .concat("София"),
);

// These run without Postgres, so they are the coverage that survives CI. Each case is a
// real spelling taken from magistrate.court — the whole point of the parser is that the
// register writes one institution a dozen ways.
describe("foldJudicialName", () => {
  it("collapses case, dashes and spacing", () => {
    const forms = [
      "Административен съд - Бургас",
      "Административен съд Бургас",
      "АДМИНИСТРАТИВЕН СЪД БУРГАС",
      "Административен съд-Бургас",
    ];
    const folded = new Set(forms.map((f) => foldJudicialName(f)));
    expect(folded.size).toBe(1);
  });

  it("rewrites the adjectival form into the seat-suffixed order", () => {
    expect(foldJudicialName("Бургаски районен съд")).toBe(
      foldJudicialName("Районен съд - Бургас"),
    );
  });

  it("drops a territorial sub-office suffix", () => {
    // A ТО is a desk of the районна прокуратура, not a separate institution.
    expect(foldJudicialName("РП Стара Загора - ТО Казанлък")).toBe(
      foldJudicialName("РП - Стара Загора"),
    );
  });

  it("spells out a leading institution abbreviation, so both spellings are one key", () => {
    // The fold's job: `РС София` and `Районен съд София` are the same institution
    // written two ways, and until this landed they were two alias keys.
    for (const [abbr, full] of [
      ["РС Варна", "Районен съд - Варна"],
      ["ОС Варна", "Окръжен съд - Варна"],
      ["ОП Варна", "Окръжна прокуратура - Варна"],
      ["РП Варна", "Районна прокуратура - Варна"],
      ["АП Варна", "Апелативна прокуратура - Варна"],
      ["АдмС Варна", "Административен съд - Варна"],
      ["АпС Варна", "Апелативен съд - Варна"],
    ] as const) {
      expect(foldJudicialName(abbr), abbr).toBe(foldJudicialName(full));
    }
  });

  it("leaves the AMBIGUOUS abbreviations alone", () => {
    // `АС` is Апелативен съд in court_load and Административен съд in the ИВСС
    // register; `ВС` is Военен съд. The string cannot settle it, so the fold must
    // not pretend it can — resolveJudicialBody's tier hint does.
    expect(foldJudicialName("АС - Бургас")).toBe("АС БУРГАС");
    expect(foldJudicialName("ВС - Сливен")).toBe("ВС СЛИВЕН");
  });

  it("expands only a LEADING abbreviation, leaving the investigation family intact", () => {
    // "ОСлО при ОП-Видин" must keep its parent-office abbreviation where
    // resolveInvestigation expects it — the head is ОСЛО, not ОП.
    expect(foldJudicialName("ОСлО при ОП-Видин")).toContain("ОП ВИДИН");
    // And a bare abbreviation with no seat is an unresolvable stub, not a body.
    expect(foldJudicialName("ОС")).toBe("ОС");
  });

  it("routes both spellings of a sub-office to the parent BODY", () => {
    expect(resolveJudicialBody("РП Стара Загора - ТО Казанлък")?.bodyCode).toBe(
      resolveJudicialBody("Районна прокуратура - Стара Загора")?.bodyCode,
    );
  });
});

describe("resolveJudicialBody", () => {
  const code = (s: string) => resolveJudicialBody(s)?.bodyCode ?? null;

  it("folds every spelling of one court onto one body", () => {
    for (const s of [
      "Административен съд - Бургас",
      "Административен съд Бургас",
      "АДМИНИСТРАТИВЕН СЪД БУРГАС",
      "АдмС - Бургас",
    ])
      expect(code(s), s).toBe("as-burgas");
  });

  it("gives Sofia's own institutions their own codes, not generic seated ones", () => {
    // "Софийски районен съд" must not become `rs-sofiya` — it is a named court.
    expect(code("Софийски районен съд")).toBe("srs");
    expect(code("СРС")).toBe("srs");
    expect(code("Софийски градски съд")).toBe("sgs");
    expect(code("Софийска градска прокуратура")).toBe("sgp");
    expect(code("Софийска районна прокуратура")).toBe("srp");
  });

  it("resolves the investigation family however it is written", () => {
    for (const s of [
      "ОСлО при ОП-Видин",
      "ОСлО в Окръжна прокуратура - Видин",
      "ОСлО-ОП-Видин",
      "Окръжен следствен отдел Видин",
      "ОСлО към ОП Видин",
    ])
      expect(code(s), s).toBe("oslo-vidin");
  });

  it("collapses a seat repeated on both sides", () => {
    expect(code("ОСлО-Сливен към ОП-Сливен")).toBe("oslo-sliven");
  });

  it("treats the Sofia city prosecution's department as its own body", () => {
    for (const s of [
      "СО-СГП",
      "СлО в СГП",
      "Следствен отдел при СГП",
      "Софийска градска прокуратура - СО",
    ])
      expect(code(s), s).toBe("so-sgp");
  });

  it("does not read an investigation department as a prosecution office", () => {
    // "ОСлО при ОП-Видин" contains "ОП"; a naive prosecution rule would win.
    expect(resolveJudicialBody("ОСлО при ОП-Видин")?.kind).toBe(
      "investigation",
    );
    expect(resolveJudicialBody("Окръжна прокуратура - Видин")?.kind).toBe(
      "prosecution",
    );
  });

  it("keeps military bodies apart from their civilian namesakes", () => {
    expect(
      resolveJudicialBody("Военно-окръжна прокуратура - София")?.tier,
    ).toBe("военен");
    expect(code("Военноокръжна прокуратура Сливен")).toBe("vop-sliven");
  });

  it("classifies the national bodies, with or without their seat", () => {
    expect(code("Върховен касационен съд")).toBe("vks");
    expect(code("ВКС")).toBe("vks");
    expect(code("ВКП - София")).toBe("vkp");
    expect(code("Национална следствена служба")).toBe("nsls");
    expect(code("Прокуратура на Република България")).toBe("prb");
    expect(code("АССГ")).toBe("as-sofia-grad");
  });

  it("assigns the kind that replaces the client-side role regex", () => {
    expect(resolveJudicialBody("Районен съд - Варна")?.kind).toBe("court");
    expect(resolveJudicialBody("Районна прокуратура - Варна")?.kind).toBe(
      "prosecution",
    );
    expect(resolveJudicialBody("Национална следствена служба")?.kind).toBe(
      "investigation",
    );
  });

  it("returns null rather than guessing", () => {
    // No seat, so no body — these are real rows in the register.
    expect(resolveJudicialBody("Районен съд")).toBeNull();
    expect(resolveJudicialBody("Окръжна прокуратура")).toBeNull();
    // Ambiguous between ВКП and ВАП: refusing is the point.
    expect(resolveJudicialBody("Върховна прокуратура")).toBeNull();
    expect(resolveJudicialBody("")).toBeNull();
    expect(resolveJudicialBody("Прокурор")).toBeNull();
  });

  it("carries a seat for every body it resolves", () => {
    for (const s of [
      "Районен съд - Варна",
      "ВКС",
      "ОСлО при ОП-Видин",
      "Военен съд Сливен",
    ])
      expect(resolveJudicialBody(s)?.place, s).toBeTruthy();
  });
});

// Everything below runs WITH the production vocabulary — the argument that makes the
// module's "never guess" contract real.
describe("resolveJudicialBody, with the settlement vocabulary", () => {
  const body = (s: string) => resolveJudicialBody(s, { vocab });

  it("does not shatter a spelled-out АПЕЛАТИВЕН into АП + a fake seat", () => {
    // The glued-abbreviation splitter used to fire on the АП of АПЕЛАТИВЕН, turning
    // every appellate COURT into a nonexistent appellate PROSECUTION office
    // ("Апелативна прокуратура — Елативен Съд Бургас") across 45 spellings / 126 roles.
    for (const s of [
      "Апелативен съд - Бургас",
      "Апелативен съд София",
      "АПЕЛАТИВЕН СЪД ПЛОВДИВ",
    ]) {
      const b = body(s);
      expect(b?.kind, s).toBe("court");
      expect(b?.tier, s).toBe("апелативен");
      expect(b?.name, s).not.toMatch(/Елативен/);
      expect(b?.bodyCode, s).toMatch(/^aps-/);
    }
    expect(body("Апелативна прокуратура - София")?.kind).toBe("prosecution");
  });

  it("still splits a genuinely glued abbreviation", () => {
    expect(body("РПКюстендил")?.bodyCode).toBe(
      body("Районна прокуратура - Кюстендил")?.bodyCode,
    );
  });

  it("refuses a seat that is not a settlement", () => {
    // Misspelt towns used to mint their own body, splitting the real court in two — so
    // the seat must come from the vocabulary. Too far out to be a slip, and no body.
    for (const s of [
      "Районен съд - Кукуряк",
      "Административен съд — Заешка поляна",
    ])
      expect(body(s), s).toBeNull();
  });

  it("corrects a seat that is one slip from exactly one settlement", () => {
    // The register is typed by hand. The institution is not in doubt in any of these —
    // refusing them strands a real magistrate at a real court.
    expect(body("Районен съд - Плевн")?.bodyCode).toBe("rs-pleven");
    expect(body("Административен съд — Варнта")?.bodyCode).toBe("as-varna");
    expect(body("Районна прокуратура - Кюстендл")?.bodyCode).toBe(
      "rp-kyustendil",
    );
    // A transposition is ONE slip, which is why the distance counts them as one.
    expect(body("Районна прокуратура Кюстнедил")?.bodyCode).toBe(
      "rp-kyustendil",
    );
    expect(body("ОСлО при ОП-Благоеевград")?.bodyCode).toBe("oslo-blagoevgrad");
  });

  it("refuses a slip that is equally close to two settlements", () => {
    // Брегово and Брезово differ in one letter, so `Брежово` is one slip from both and
    // 200km from at least one of them. A tie keeps the old answer: no body.
    expect(body("Районен съд - Брежово")).toBeNull();
  });

  it("refuses a first-letter slip rather than moving the seat to another town", () => {
    // The scan cannot tell "Велово" (a slip for Белово) from "Велово" (a slip for
    // Ветово), so refusing is the only honest answer. This used to resolve — narrowing
    // the scan to candidates sharing the TYPO's initial hid the town the slip came from
    // and handed the string to whichever other real municipality shared the wrong
    // letter, publishing a named magistrate at a court they do not sit in.
    for (const s of [
      "Районен съд - Велово", // was Ветово; Белово is equally close
      "Окръжен съд - Лодеч", // was Ловеч; Годеч is equally close
      "Районен съд Шемен", // was Шумен; Земен is equally close
    ])
      expect(body(s), s).toBeNull();
    // …and where the real town is STRICTLY closer, the full scan does not merely refuse,
    // it recovers the right answer: Велико Търново is one slip away, Малко Търново two.
    // Under the narrowed scan this resolved to Малко Търново.
    expect(body("Административен съд Мелико Търново")?.bodyCode).toBe(
      "as-veliko-tarnovo",
    );
  });

  it("keeps every settlement outside every other settlement's correction radius", () => {
    // The radius placeSlips grants is only safe while the vocabulary is sparse enough
    // that a slip cannot land closer to a different town than to its own. Two names
    // inside each other's radius do not mis-resolve — they tie, which is safe — but the
    // pair set is the measurement the radius is chosen from, and
    // data/municipalities.json is a moving input: widening it toward settlements (5,366
    // names, as place_dim already carries) would break the argument silently.
    //
    // Scanned across ALL initials on purpose. The same-initial habit is what hid
    // Кирково/Мирково from the measurement that first justified the radius.
    const keys = [...vocab.keys()];
    const collisions = new Set<string>();
    for (const a of keys)
      for (const b of keys)
        if (
          a !== b &&
          editDistance(a, b, placeSlips(a.length)) <= placeSlips(a.length)
        )
          collisions.add([a, b].sort().join(" ~ "));
    expect(collisions).toEqual(
      new Set(["БРЕГОВО ~ БРЕЗОВО", "КИРКОВО ~ МИРКОВО"]),
    );
  });

  it("reports every correction it makes", () => {
    const fixes: string[] = [];
    resolveJudicialBody("Окръжна прократура Кюстендл", {
      vocab,
      onFix: (f) => fixes.push(`${f.from}→${f.to}`),
    });
    expect(fixes).toEqual(["ПРОКРАТУРА→ПРОКУРАТУРА", "КЮСТЕНДЛ→КЮСТЕНДИЛ"]);
    // A name that needed no correction reports none.
    const clean: string[] = [];
    resolveJudicialBody("Районен съд - Плевен", {
      vocab,
      onFix: (f) => clean.push(f.from),
    });
    expect(clean).toEqual([]);
  });

  it("corrects a misspelt institution word, and keeps the two families apart", () => {
    expect(body("Върховен адинистративен съд")?.bodyCode).toBe("vas");
    expect(body("Върховен административен съдз")?.bodyCode).toBe("vas");
    expect(body("Апелативна прокуратра София")?.bodyCode).toBe("ap-sofiya");
    expect(body("Окръжна рокуратура - Бургас")?.bodyCode).toBe("op-burgas");
    expect(body("Роайонен съд - Пловдив")?.bodyCode).toBe("rs-plovdiv");
    expect(body("Раойнна прокуратура - София")?.bodyCode).toBe("srp");
    expect(body("СОФИЙСКА РАЙОННА ПРОКУРТУРА")?.bodyCode).toBe("srp");
    // РАЙОНЕН and РАЙОННА are two edits apart; a slip on one must not reach the other.
    expect(body("Районвн съд Самоков")?.kind).toBe("court");
    expect(body("Районвн съд Самоков")?.bodyCode).toBe("rs-samokov");
    // The three spellings the SEATED patterns used to carry as literal alternatives.
    expect(body("Администритивен съд Монтана")?.bodyCode).toBe("as-montana");
    expect(body("РЙОНЕН СЪД-ТЕТЕВЕН")?.bodyCode).toBe("rs-teteven");
    expect(body("Райнонна прокуратура-Плевен")?.bodyCode).toBe("rp-pleven");
  });

  it("never rewrites a settlement into an institution word", () => {
    // The invariant behind INSTITUTION_WORDS being a CLOSED list: if a real seat were
    // within the correction radius of one of them, the fold would destroy it before the
    // seat was ever looked up. Asserted over the whole vocabulary rather than a case
    // list, so a word added to the lexicon later cannot quietly break it.
    // Compared against placeKey, NOT the fold — folding both sides would let a
    // correction that fires on the bare name pass unnoticed.
    //
    // Both sizes are pinned because placeSlips and wordSlips reason FROM them ("looser,
    // because the lexicon is 33 words rather than 292 names"): a count that drifts turns
    // those docstrings into an argument for a radius nobody chose. Failing here means
    // update the two docstrings, not the numbers.
    expect(INSTITUTION_WORDS.length).toBe(33);
    expect(vocab.size).toBe(292);
    for (const name of vocab.values())
      for (const token of placeKey(name).split(" "))
        expect(
          foldJudicialName(`Районен съд ${name}`).split(" "),
          name,
        ).toContain(token);
  });

  it("reads a spaced-out abbreviation as one token", () => {
    expect(body("Следствен Отдел при О П София")?.bodyCode).toBe("oslo-sofiya");
    expect(body("ОКРЪЖЕН СЪ Д- МОНТАНА")?.bodyCode).toBe("os-montana");
  });

  it("drops the declarant's own role and the country they serve", () => {
    expect(body("съдия в СРС")?.bodyCode).toBe("srs");
    expect(body("ВКС на РБ")?.bodyCode).toBe("vks");
    expect(body("Прокуратура - СРП")?.bodyCode).toBe("srp");
    // …but a role with no institution behind it still names nothing.
    expect(body("Прокурор")).toBeNull();
    expect(body("Съдия")).toBeNull();
  });

  it("reads a trailing department qualifier as the department", () => {
    // "Окръжна прокуратура Враца - ОСлО" is the investigation department, not the
    // prosecution office it hangs off; it used to resolve to the office.
    const b = body("Окръжна прокуратура Враца - ОСлО");
    expect(b?.kind).toBe("investigation");
    expect(b?.bodyCode).toBe("oslo-vratsa");
    expect(body("Окръжна прокуратура - Враца")?.kind).toBe("prosecution");
  });

  it("expands a documented composite office abbreviation", () => {
    expect(body("Окръжен следствен отдел във ВТОП")?.bodyCode).toBe(
      "oslo-veliko-tarnovo",
    );
    // ВОП stays военно-окръжна, and carries no seat of its own here — no body.
    expect(body("ОКРЪЖЕН СЛЕДСТВЕН ВЪВ ВОП")).toBeNull();
  });

  it("uses the register's own spelling, not a title-caser's guess", () => {
    // 11 obshtina names have a lowercase second word; title-casing them breaks the
    // seat→obshtina join.
    expect(body("Районен съд - Нови пазар")?.place).toBe("Нови пазар");
    expect(body("РАЙОНЕН СЪД ЧЕРВЕН БРЯГ")?.place).toBe("Червен бряг");
  });

  it("drops a settlement qualifier instead of making a second body", () => {
    expect(body("Районен съд град Русе")?.bodyCode).toBe(
      body("Районен съд - Русе")?.bodyCode,
    );
    // …but keeps the ГРАД that distinguishes Sofia's two administrative courts.
    expect(body("Административен съд София-град")?.bodyCode).toBe(
      "as-sofia-grad",
    );
    expect(body("Административен съд София-област")?.bodyCode).toBe(
      "as-sofia-oblast",
    );
  });

  it("resolves court_load's abbreviations using the caller's tier, never the string", () => {
    // `АС` is an APPELLATE court in court_load and an ADMINISTRATIVE one in the ИВСС
    // register; only the caller knows which.
    expect(
      resolveJudicialBody("АС - Бургас", { vocab, tier: "апелативен" })
        ?.bodyCode,
    ).toBe("aps-burgas");
    expect(
      resolveJudicialBody("АС - Бургас", { vocab, tier: "административен" })
        ?.bodyCode,
    ).toBe("as-burgas");
    expect(
      resolveJudicialBody("ВС - Сливен", { vocab, tier: "военен" })?.bodyCode,
    ).toBe("vs-sliven");
    expect(body("СНС")?.tier).toBe("специализиран");
    expect(body("АСНС")?.tier).toBe("специализиран");
  });

  // Sofia's own courts have ADJECTIVAL names and therefore curated NATIONAL entries,
  // checked before the generic seated rules precisely so "Софийски районен съд" cannot
  // mint `rs-sofiya`. That defence only ever covered the SPELLED-OUT spelling, while
  // court_load — the ВСС's own workload series — writes the abbreviated one. So five
  // bodies existed twice, with the magistrates on one and the workload on the other:
  // /court/as-sofia-grad stated the ВСС publishes no workload for it while publishing
  // eight years of it under `as-sofiya-grad`.
  it("routes BOTH spellings of a Sofia institution to its curated body", () => {
    for (const [abbr, canonical] of [
      ["РС-София", "srs"],
      ["Районен съд София", "srs"],
      ["Софийски районен съд", "srs"],
      ["ОС - София", "sos"],
      ["Окръжен съд - София", "sos"],
      ["Софийски окръжен съд", "sos"],
      ["ОП - София", "sop"],
      ["Софийска окръжна прокуратура", "sop"],
      ["АдмС - София-град", "as-sofia-grad"],
      ["Административен съд София-град", "as-sofia-grad"],
      ["АССГ", "as-sofia-grad"],
      ["АдмС - София-област", "as-sofia-oblast"],
      ["Административен съд София-област", "as-sofia-oblast"],
      ["СГС", "sgs"],
      ["Софийски градски съд", "sgs"],
    ] as const) {
      expect(resolveJudicialBody(abbr, { vocab })?.bodyCode, abbr).toBe(
        canonical,
      );
    }
  });

  it("still gives a NON-Sofia seat its own seated body", () => {
    // The fix must not collapse the generic rules it routes through: only the
    // institutions with a curated national entry change.
    expect(resolveJudicialBody("РС - Варна", { vocab })?.bodyCode).toBe(
      "rs-varna",
    );
    expect(resolveJudicialBody("ОС - Варна", { vocab })?.bodyCode).toBe(
      "os-varna",
    );
  });
});
