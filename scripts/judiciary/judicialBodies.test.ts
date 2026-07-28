import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveJudicialBody,
  foldJudicialName,
  placeVocabulary,
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
    // A ТО is a desk of the районна прокуратура, not a separate institution. The fold
    // keeps the abbreviation as written — expanding РП → РАЙОННА ПРОКУРАТУРА is the
    // resolver's job, not the fold's — so this asserts only that the ТО tail is gone.
    expect(foldJudicialName("РП Стара Загора - ТО Казанлък")).toBe(
      foldJudicialName("РП - Стара Загора"),
    );
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
    // Misspelt towns used to mint their own body, splitting the real court in two.
    for (const s of [
      "Районен съд - Плевн",
      "Административен съд — Варнта",
      "Районна прокуратура - Кюстендл",
    ])
      expect(body(s), s).toBeNull();
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
});
