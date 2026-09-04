// Which filing answers "what is this person worth?" — the selector four
// consumers used to get wrong by taking declarations[0].

import { describe, expect, it } from "vitest";
import type { MpAsset } from "@/data/dataTypes";
import {
  ASSET_ROW_CEILING_EUR,
  byRecency,
  declarationPeriod,
  declarationTotals,
  hasDeclaredAssets,
  hasDeclaredIncome,
  hasDeclaredStakes,
  hasValuedAssets,
  incomeTotals,
  isDeclaredHolding,
  isSpouseHolder,
  latestAssetDeclaration,
  latestDeclarationWith,
  normHolderName,
  priorAssetDeclaration,
  withinAssetCeiling,
} from "./declarations";

const asset = (
  category: MpAsset["category"],
  valueEur: number | null,
): MpAsset => ({
  category,
  tableNum: null,
  description: null,
  detail: null,
  location: null,
  municipality: null,
  areaSqm: null,
  builtAreaSqm: null,
  acquiredYear: null,
  share: null,
  currency: null,
  amount: null,
  valueEur,
  valueBasis: null,
  holderName: null,
  isSpouse: false,
  legalBasis: null,
  fundsOrigin: null,
});

const decl = (
  declarationYear: number,
  fiscalYear: number | null,
  assets: MpAsset[] | undefined,
) => ({
  declarationYear,
  fiscalYear,
  assets,
  sourceUrl: `https://register.cacbg.bg/${declarationYear}/${fiscalYear}-${assets?.length ?? 0}.xml`,
});

describe("hasDeclaredAssets", () => {
  it("distinguishes a filing with an asset table from one without", () => {
    expect(hasDeclaredAssets(decl(2024, 2023, [asset("cash", 1)]))).toBe(true);
    expect(hasDeclaredAssets(decl(2024, null, []))).toBe(false);
    expect(hasDeclaredAssets(decl(2024, null, undefined))).toBe(false);
    expect(hasDeclaredAssets(undefined)).toBe(false);
  });
});

describe("latestAssetDeclaration", () => {
  it("skips a leading filing that declares no assets", () => {
    // Цоков's real shape: an incompatibility filing sits ahead of the annual
    // that actually carries his wealth.
    const decls = [
      decl(2023, null, []),
      decl(2024, 2023, [asset("real_estate", 21555)]),
    ];
    expect(latestAssetDeclaration(decls)?.declarationYear).toBe(2024);
  });

  it("skips a leading filing with an absent assets array", () => {
    const decls = [
      decl(2025, null, undefined),
      decl(2024, 2023, [asset("cash", 10)]),
    ];
    expect(latestAssetDeclaration(decls)?.declarationYear).toBe(2024);
  });

  it("returns the head when it does declare assets", () => {
    const decls = [
      decl(2025, 2024, [asset("bank", 5)]),
      decl(2024, 2023, [asset("bank", 4)]),
    ];
    expect(latestAssetDeclaration(decls)?.declarationYear).toBe(2025);
  });

  it("returns null when nothing in the history declares assets", () => {
    expect(latestAssetDeclaration([decl(2023, null, [])])).toBeNull();
    expect(latestAssetDeclaration([])).toBeNull();
  });

  // Анелия Атанасова Димитрова's real 2025 shape. The parser emits a row for a
  // blank table line, so her incompatibility filing carries ONE unvalued `bank`
  // row — enough to pass hasDeclaredAssets — and it is the newer filing. Ranked
  // on "has an asset row" it won, and her published net worth went €610,451 → €0.
  it("prefers a valued filing over a newer one that values nothing", () => {
    const decls = [
      decl(2025, null, [asset("bank", null)]),
      decl(2025, 2024, [asset("real_estate", 671806)]),
    ];
    expect(latestAssetDeclaration(decls)?.fiscalYear).toBe(2024);
  });

  // …but the preference must not become a filter. Unvalued real estate is a real
  // filing pattern (359 annuals), reported as a caveat rather than treated as
  // absence, so a person who has never valued anything still gets a wealth block.
  it("falls back to an unvalued filing when nothing is valued", () => {
    const decls = [
      decl(2025, 2024, [asset("real_estate", null)]),
      decl(2024, 2023, [asset("real_estate", 0)]),
    ];
    expect(latestAssetDeclaration(decls)?.declarationYear).toBe(2025);
  });

  // A debts-only filing is a real wealth statement (net worth is negative), so
  // it must not be skipped the way an empty one is.
  it("treats a debts-only filing as a wealth snapshot", () => {
    const decls = [decl(2025, 2024, [asset("debt", 15952)])];
    expect(latestAssetDeclaration(decls)?.declarationYear).toBe(2025);
  });
});

describe("priorAssetDeclaration", () => {
  it("skips a same-period filing so the delta is not a self-comparison", () => {
    // An annual and an exit declaration filed the same calendar year share a
    // declarationYear; only the fiscal year distinguishes them.
    const latest = decl(2024, 2023, [asset("cash", 100)]);
    const decls = [
      latest,
      decl(2024, 2023, [asset("cash", 100)]),
      decl(2023, 2022, [asset("cash", 60)]),
    ];
    expect(priorAssetDeclaration(decls, latest)?.fiscalYear).toBe(2022);
  });

  it("skips an asset-less filing when looking back", () => {
    const latest = decl(2025, 2024, [asset("cash", 100)]);
    const decls = [
      latest,
      decl(2024, 2023, []),
      decl(2023, 2022, [asset("cash", 60)]),
    ];
    expect(priorAssetDeclaration(decls, latest)?.fiscalYear).toBe(2022);
  });

  it("returns null when there is nothing to compare against", () => {
    const latest = decl(2025, 2024, [asset("cash", 100)]);
    expect(priorAssetDeclaration([latest], latest)).toBeNull();
    expect(priorAssetDeclaration([], null)).toBeNull();
  });
});

describe("byRecency — filings sharing a date", () => {
  const filing = (
    declarationType: string,
    entryNumber: string,
  ): import("./declarations").DeclarationLike => ({
    declarationYear: 2024,
    fiscalYear: null,
    filedAt: "2024-05-02",
    entryNumber,
    declarationType,
    sourceUrl: `https://register.cacbg.bg/2024/${entryNumber}.xml`,
  });

  // Ивелина Дундакова: exit filing (9 rows, +52,270 EUR) vs an annual filed the
  // same day (3 rows, −79,546 EUR). The entry-number prefix is the FORM, so
  // "Г6706" sorting before "Ф576" published the wrong headline for 100 people.
  it("puts an exit declaration ahead of an annual filed the same day", () => {
    const annual = filing("Annualy", "Г6706");
    const vacate = filing("Vacate", "Ф576");
    expect([annual, vacate].sort(byRecency)[0]).toBe(vacate);
    expect([vacate, annual].sort(byRecency)[0]).toBe(vacate);
  });

  it("puts an entry declaration last among same-day filings", () => {
    const entry = filing("Entry", "Ф100");
    const annual = filing("Annualy", "Г100");
    expect([entry, annual].sort(byRecency)[0]).toBe(annual);
  });

  it("still orders by year and date before type", () => {
    const oldVacate = { ...filing("Vacate", "Ф1"), declarationYear: 2023 };
    const newAnnual = filing("Annualy", "Г1");
    expect([oldVacate, newAnnual].sort(byRecency)[0]).toBe(newAnnual);
  });

  it("falls back to entry number then sourceUrl when the type ties too", () => {
    const a = filing("Annualy", "Г100");
    const b = filing("Annualy", "Г200");
    expect([b, a].sort(byRecency)[0]).toBe(a);
  });
});

describe("byRecency — the period covered outranks the date filed", () => {
  // Лучия Александрова Добрева. Both filings were lodged in 2025 and so share a
  // declarationYear; the exit filing describes February 2025, the annual describes
  // 31 December 2024. On filedAt the annual wins and her published 2025 net worth
  // was −274,784 EUR — the 2024 figure, on a card headlined 2025.
  const vacate2025 = {
    declarationYear: 2025,
    fiscalYear: 2025,
    filedAt: "2025-02-18",
    entryNumber: "Ф8",
    declarationType: "Vacate",
    sourceUrl: "https://register.cacbg.bg/2025/21571.xml",
  };
  const annual2024 = {
    declarationYear: 2025,
    fiscalYear: 2024,
    filedAt: "2025-06-13",
    entryNumber: "Г14992",
    declarationType: "Annualy",
    sourceUrl: "https://register.cacbg.bg/2025/21570.xml",
  };

  it("prefers the filing covering the later period, not the one filed later", () => {
    expect([annual2024, vacate2025].sort(byRecency)[0]).toBe(vacate2025);
    expect([vacate2025, annual2024].sort(byRecency)[0]).toBe(vacate2025);
  });

  it("still breaks ties on filedAt within one period", () => {
    // Both cover 2024: an entry filing lodged that July and the annual closing the
    // year, filed the following May. The annual is the later snapshot.
    const entryJul = {
      ...annual2024,
      declarationType: "Entry",
      filedAt: "2024-07-17",
    };
    expect([entryJul, annual2024].sort(byRecency)[0]).toBe(annual2024);
  });

  it("falls back to the filing year when fiscalYear is absent", () => {
    // 450 incompatibility and 275 entry/exit filings carry no <Year>; for entry/exit
    // the filing year IS the period, so the fallback is exact.
    const undated = { ...vacate2025, fiscalYear: null };
    expect(declarationPeriod(undated)).toBe(2025);
    expect([annual2024, undated].sort(byRecency)[0]).toBe(undated);
  });

  it("reads the period off fiscalYear when present", () => {
    expect(declarationPeriod(annual2024)).toBe(2024);
    expect(declarationPeriod(vacate2025)).toBe(2025);
  });
});

describe("declarationTotals", () => {
  it("nets debts off the summed asset categories", () => {
    const t = declarationTotals([
      asset("real_estate", 600),
      asset("bank", 27),
      asset("debt", 332),
    ]);
    expect(t.assetsEur).toBe(627);
    expect(t.debtsEur).toBe(332);
    expect(t.netEur).toBe(295);
  });

  it("counts unvalued real estate, which otherwise silently reads as €0", () => {
    const t = declarationTotals([
      asset("real_estate", null),
      asset("real_estate", 100),
    ]);
    expect(t.realEstateUnvalued).toBe(1);
    expect(t.assetsEur).toBe(100);
  });

  it("returns zeroes for an absent asset list", () => {
    expect(declarationTotals(undefined)).toEqual({
      assetsEur: 0,
      debtsEur: 0,
      netEur: 0,
      realEstateUnvalued: 0,
    });
  });
});

describe("latestDeclarationWith — per-section filings", () => {
  const income = (eur: number | null) => ({
    parent: null,
    category: "Годишна данъчна основа от трудови доходи",
    amountEurDeclarant: eur,
    amountEurSpouse: null,
  });
  const stake = (companyName: string) => ({
    table: "10" as const,
    itemType: null,
    shareSize: null,
    companyName,
    registeredOffice: null,
    valueEur: null,
    holderName: null,
    legalBasis: null,
    fundsOrigin: null,
  });

  // The filing kinds carry different tables, so a single "latest" cannot serve
  // the wealth, income and interests sections at once.
  it("resolves wealth, income and stakes to different filings", () => {
    const decls = [
      { ...decl(2025, null, undefined), ownershipStakes: [stake("АЛФА")] },
      decl(2024, 2023, [asset("cash", 5)]),
      { ...decl(2023, 2022, undefined), income: [income(44888)] },
    ];
    expect(latestAssetDeclaration(decls)?.declarationYear).toBe(2024);
    expect(
      latestDeclarationWith(decls, hasDeclaredIncome)?.declarationYear,
    ).toBe(2023);
    expect(
      latestDeclarationWith(decls, hasDeclaredStakes)?.declarationYear,
    ).toBe(2025);
  });

  it("ignores an income table whose every row is zero", () => {
    const decls = [{ ...decl(2025, 2024, undefined), income: [income(0)] }];
    expect(latestDeclarationWith(decls, hasDeclaredIncome)).toBeNull();
  });

  // Deliberate: a filing that declares only interests is an incompatibility
  // filing, and has no wealth statement to show even though the MP net-worth
  // basis values table-10 stakes.
  it("does not treat a stakes-only filing as a wealth snapshot", () => {
    const decls = [
      { ...decl(2025, null, undefined), ownershipStakes: [stake("АЛФА")] },
    ];
    expect(latestAssetDeclaration(decls)).toBeNull();
  });
});

describe("isDeclaredHolding", () => {
  // Tables 1.2 / 3.4 record property and vehicles the declarant RENTS or is provided
  // with, priced at „Цена по договор". Everything else is theirs.
  it("excludes the two чуждо tables and nothing else", () => {
    expect(isDeclaredHolding({ tableNum: "1.2" })).toBe(false);
    expect(isDeclaredHolding({ tableNum: "3.4" })).toBe(false);
    for (const t of [
      "1",
      "1.1",
      "2",
      "3",
      "3.1",
      "3.2",
      "3.3",
      "3.5",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ])
      expect(isDeclaredHolding({ tableNum: t })).toBe(true);
  });

  // The catastrophic input. Every row on a database that has not re-parsed carries NULL,
  // so reading it as a non-holding deletes every real asset from every published figure.
  it("treats an unstamped row as a holding", () => {
    expect(isDeclaredHolding({ tableNum: null })).toBe(true);
    expect(isDeclaredHolding({ tableNum: undefined })).toBe(true);
    expect(isDeclaredHolding({})).toBe(true);
  });

  // Prefix matching would take table 1 with it; substring matching would take 3.4 from
  // a hypothetical "13.4". Equality only.
  it("matches the whole table number, not a prefix", () => {
    expect(isDeclaredHolding({ tableNum: "1" })).toBe(true);
    expect(isDeclaredHolding({ tableNum: "3" })).toBe(true);
    expect(isDeclaredHolding({ tableNum: "13.4" })).toBe(true);
  });
});

describe("declarationTotals and чуждо rows", () => {
  it("keeps a rented property out of both sides of the balance", () => {
    const own = { ...asset("real_estate", 100_000), tableNum: "1" };
    const used = { ...asset("real_estate", 60_000), tableNum: "1.2" };
    const debt = { ...asset("debt", 20_000), tableNum: "7" };
    const t = declarationTotals([own, used, debt]);
    expect(t.assetsEur).toBe(100_000);
    expect(t.debtsEur).toBe(20_000);
    expect(t.netEur).toBe(80_000);
  });

  // A filing whose only rows are чуждо states a zero estate — not a missing one. Пеевски's
  // 2025 annual files tables 1 and 3 as „not declared" and is exactly this shape.
  it("reports zero for a filing that owns nothing", () => {
    const t = declarationTotals([
      { ...asset("real_estate", 233_109), tableNum: "1.2" },
      { ...asset("vehicle", 77_307), tableNum: "3.4" },
    ]);
    expect(t.assetsEur).toBe(0);
    expect(t.netEur).toBe(0);
  });

  // An unvalued чуждо row is not a caveat on a total it never entered.
  it("does not count a чуждо row as an unvalued holding", () => {
    const t = declarationTotals([
      { ...asset("real_estate", null), tableNum: "1.2" },
      { ...asset("real_estate", null), tableNum: "1" },
    ]);
    expect(t.realEstateUnvalued).toBe(1);
  });
});

// The rule is shared with the parser (which stores it as `declaration_asset.is_spouse`),
// so it earns direct coverage rather than only being exercised through a component.
describe("isSpouseHolder", () => {
  it("is false when no holder is named", () => {
    // 8,563 of 18,569 stake rows name nobody — every role / sole_trader / table-11 row.
    expect(isSpouseHolder(null, "ИВАН ПЕТРОВ")).toBe(false);
    expect(isSpouseHolder("   ", "ИВАН ПЕТРОВ")).toBe(false);
  });

  it("is false when no declarant is known", () => {
    // Fails OPEN without the guard: with a blank declarant every holder compares unequal
    // and the whole filing reads as somebody else's.
    expect(isSpouseHolder("МАРИЯ ПЕТРОВА", null)).toBe(false);
    expect(isSpouseHolder("МАРИЯ ПЕТРОВА", "")).toBe(false);
  });

  it("folds case, whitespace and spacing around a hyphenated surname", () => {
    // „Димитриева - Николова" and „димитриева-николова" are the same person; a naive
    // `!==` would mark the declarant's own stake as somebody else's.
    expect(
      isSpouseHolder(
        "Тияна Димитриева - Николова",
        "тияна  димитриева-николова",
      ),
    ).toBe(false);
    expect(
      isSpouseHolder(
        "  николай  иванов копринков ",
        "Николай Иванов Копринков",
      ),
    ).toBe(false);
  });

  it("is true only for a genuinely different name", () => {
    expect(
      isSpouseHolder("Теодора Стоянова Копринкова", "Николай Иванов Копринков"),
    ).toBe(true);
  });

  // The register is hand-typed and `normHolderName` cannot reach either of these: it tidies
  // the space AROUND a hyphen, not a hyphen standing in for one, and it cannot invent a
  // space that was never typed. Every case here is verbatim from the corpus — the eight
  // stake rows that chipped a declarant's own name as somebody else's on their own page.
  it("folds a missing space between name tokens", () => {
    expect(
      isSpouseHolder("ПЕТКОАНГЕЛОВ КУЩИРЕВ", "ПЕТКО АНГЕЛОВ КУЩИРЕВ"),
    ).toBe(false);
    expect(
      isSpouseHolder("Николай МихайловКолибаров", "Николай Михайлов Колибаров"),
    ).toBe(false);
    expect(
      isSpouseHolder("РобертиноТодоров Маринов", "РОБЕРТИНО ТОДОРОВ МАРИНОВ"),
    ).toBe(false);
    expect(
      isSpouseHolder("СтоянНиколаев Люцканов", "Стоян Николаев Люцканов"),
    ).toBe(false);
    expect(
      isSpouseHolder(
        "Владимир БориславовЛафазански",
        "Владимир Бориславов Лафазански",
      ),
    ).toBe(false);
  });

  it("folds a hyphen the declarant typed and the register did not", () => {
    expect(
      isSpouseHolder(
        "Тияна Лазарова Димитриева - Николова",
        "Тияна Лазарова Димитриева Николова",
      ),
    ).toBe(false);
    expect(
      isSpouseHolder(
        "Веселина Василева Карамилева-Тодорова",
        "Веселина Василева Карамилева Тодорова",
      ),
    ).toBe(false);
  });

  it("folds stray punctuation and digits the register carries", () => {
    // Asset-side rows, where the same fold is STORED as declaration_asset.is_spouse.
    expect(isSpouseHolder("Иван Генов Иванов,", "Иван Генов Иванов")).toBe(
      false,
    );
    expect(
      isSpouseHolder("Йордан Кирилов Кожухаров/", "Йордан Кирилов Кожухаров"),
    ).toBe(false);
    expect(
      isSpouseHolder("Илонка Лазарова Стоянова 0", "Илонка Лазарова Стоянова"),
    ).toBe(false);
    expect(
      isSpouseHolder(
        "Иванка Ангелова Багдатова _ Мизова",
        "Иванка Ангелова Багдатова - Мизова",
      ),
    ).toBe(false);
  });

  it("is false when the holder cell names nobody", () => {
    // Verbatim from the corpus — 21 asset rows and 8 stake rows carried one of these, and
    // one rendered a chip whose entire text was „.". The blank guard runs on the
    // display-shaped form, which keeps punctuation and digits, so these reached the
    // comparison and published „somebody else holds this" against a named individual on
    // their own page.
    for (const junk of ["-", ".", "0", "91697", "*6", "(", "#".repeat(40)])
      expect(isSpouseHolder(junk, "ВАЛЕРИ СИМЕОНОВ СИМЕОНОВ")).toBe(false);
    // …and it must not swallow a real single-token holder.
    expect(isSpouseHolder("Петрова", "ВАЛЕРИ СИМЕОНОВ СИМЕОНОВ")).toBe(true);
  });

  it("is false when the DECLARANT's name has no letters", () => {
    // Not hypothetical: two filings name the declarant „0" and two name them „4", between
    // them carrying 9 marked rows. Guarding only the holder would leave a real third party
    // asserted on the strength of the declarant's own typo.
    expect(isSpouseHolder("Мария Петрова Иванова", "0")).toBe(false);
    expect(isSpouseHolder("Мария Петрова Иванова", "4")).toBe(false);
  });

  it("normalises to NFC before folding", () => {
    // `lettersOnly` strips \p{M}, so a DECOMPOSED „й" (и + U+0306) would lose its breve and
    // fold equal to „и" — reattributing a third party's row to the declarant. 0 corpus rows
    // are non-NFC today; this pins the direction before one is.
    const nfd = "ЙОРДАНОВ".normalize("NFD");
    expect(nfd).not.toBe("ЙОРДАНОВ");
    expect(isSpouseHolder(nfd, "ЙОРДАНОВ")).toBe(false);
    expect(isSpouseHolder(nfd, "ИОРДАНОВ")).toBe(true);
  });

  it("still marks a genuinely different member of the family", () => {
    // The whole point of the rule is to mark a spouse, and a spouse usually shares the
    // surname. A spouse differs in the given name AND the patronymic AND the family
    // name, so none of the token passes below can reach one.
    expect(
      isSpouseHolder("Теодора Иванова Копринкова", "Николай Иванов Копринков"),
    ).toBe(true);
    // A family-name-FIRST reordering stays marked: T6 pins the given name, and nothing
    // about this ordering proves it is the declarant rather than a relative.
    expect(
      isSpouseHolder("Копринков Николай Иванов", "Николай Иванов Копринков"),
    ).toBe(true);
    // A dropped separator must not merge two names that differ by a letter — and the
    // letter here is the masculine/feminine ending of the LAST token, the one
    // single-edit shape T5 deliberately refuses.
    expect(
      isSpouseHolder("ПЕТКОАНГЕЛОВ КУЩИРЕВА", "ПЕТКО АНГЕЛОВ КУЩИРЕВ"),
    ).toBe(true);
  });
});

// docs/plans/declaration-holder-self-fold-v1.md T1-T6 — the declarant's own name, spelled
// a second way on their own filing. Every fixture below is verbatim from the corpus.
//
// Direction that must not fail: each pass can only move a row OUT of „somebody else". So
// the risk they carry is the opposite of the one they fix — a household member's property
// relabelled as the declarant's own — which is what the refusals at the bottom pin.
describe("isSpouseHolder — folds the declarant's own name, respelled", () => {
  it("T1 — folds one Latin look-alike letter typed into a Cyrillic name", () => {
    // 61 corpus rows across 22 people. Latin A, E, O, T, K…
    expect(
      isSpouseHolder("Aлександър Стоянов Савов", "Александър Стоянов Савов"),
    ).toBe(false);
    expect(isSpouseHolder("EВГЕНИ ПЕНЧЕВ ПЕНЕВ", "ЕВГЕНИ ПЕНЧЕВ ПЕНЕВ")).toBe(
      false,
    );
    expect(
      isSpouseHolder("Момчил Виктoров Станков", "Момчил Викторов Станков"),
    ).toBe(false);
    expect(isSpouseHolder("ПETKO ДОБРЕВ ПЕТКОВ", "ПЕТКО ДОБРЕВ ПЕТКОВ")).toBe(
      false,
    );
  });

  it("T2 — folds a title, a legal basis or a role wrapped around the declarant's name", () => {
    expect(
      isSpouseHolder("адв. Борис Давидов Михайлов", "Борис Давидов Михайлов"),
    ).toBe(false);
    expect(
      isSpouseHolder("Ангел Андреев Куртишев в СИО", "Ангел Андреев Куртишев"),
    ).toBe(false);
    expect(
      isSpouseHolder(
        "Ангел Александров Антонов  /наследство/",
        "Ангел Александров Антонов",
      ),
    ).toBe(false);
    expect(
      isSpouseHolder("Ани Нораири Арутюнян съкредитор", "Ани Нораири Арутюнян"),
    ).toBe(false);
    expect(
      isSpouseHolder(
        "Валентин Ваньов Ангелов\\ през 2021",
        "Валентин Ваньов Ангелов",
      ),
    ).toBe(false);
  });

  it("T2 — strips the decoration from the DECLARANT side too", () => {
    // 355 corpus rows: the title is on the declarant, not the holder. Stripping only
    // one side leaves every one of them marked.
    expect(isSpouseHolder("Али Вели Дурмушали", "д-р Али Вели Дурмушали")).toBe(
      false,
    );
    expect(
      isSpouseHolder("ДИМИТЪР ХРИСТОВ МАКАКОВ", "д-р ДИМИТЪР ХРИСТОВ МАКАКОВ"),
    ).toBe(false);
  });

  it("T3 — folds a shorter form of the declarant's own name", () => {
    expect(isSpouseHolder("Албена Туджарова", "Албена Иванова Туджарова")).toBe(
      false,
    );
    expect(isSpouseHolder("АДИЛЕ КЯМИЛ", "АДИЛЕ САБРИЕВА КЯМИЛ")).toBe(false);
    // A repeated family name still counts as contained.
    expect(
      isSpouseHolder("АЛЕКСАНДАР НОВЕСКИ", "АЛЕКСАНДАР НОВЕСКИ НОВЕСКИ"),
    ).toBe(false);
  });

  it("T4 — folds an initial standing in for the written-out name", () => {
    // The whole corpus population of this class is 3 name pairs / 75 rows.
    expect(
      isSpouseHolder("Деница С. Славкова", "Деница Спасова Славкова"),
    ).toBe(false);
    expect(
      isSpouseHolder("дирк йохан г пергот", "Дирк Йохан Густаф Пергот"),
    ).toBe(false);
    expect(
      isSpouseHolder(
        "Стоянка Ф. Тенова -Илчевска",
        "Стоянка филчева Тенова - Илчевска",
      ),
    ).toBe(false);
  });

  it("T5 — folds one token differing by one letter when the rest match exactly", () => {
    // Patronymic, family name and given name positions — 4,632 rows.
    expect(
      isSpouseHolder("Адалберт Огнянав Йолов", "Адалберт Огнянов Йолов"),
    ).toBe(false);
    expect(
      isSpouseHolder("Аделина Огнянова Николоваз", "Аделина Огнянова Николова"),
    ).toBe(false);
    expect(
      isSpouseHolder(
        "Александър Здравков Мохайлов",
        "Александър Здравков Михайлов",
      ),
    ).toBe(false);
    // A gender mismatch that is NOT on the last token is a dropped „а", not a person:
    // the given name „Августина" is unchanged, so no second human is in play.
    expect(
      isSpouseHolder(
        "Августина Веселинов Кайкова",
        "Августина Веселинова Кайкова",
      ),
    ).toBe(false);
    expect(
      isSpouseHolder(
        "Анели Веселинова Джагарова",
        "АНЕЛИЯ ВЕСЕЛИНОВА ДЖАГАРОВА",
      ),
    ).toBe(false);
  });

  it("T5 — keeps refusing the masc/fem family name when a decoration token trails it", () => {
    // T4/T5/T6 match on RAW tokens, so „в СИО" pushes the family name out of final
    // position. Reading `tokens[length - 1]` instead of the last NAME token turned this
    // carve-out silently off — 0 corpus rows today, but 1,442 rows carry such a note.
    expect(
      isSpouseHolder(
        "Айдън Нихадов Шабанова в СИО",
        "Айдън Нихадов Шабанов в СИО",
      ),
    ).toBe(true);
    expect(
      isSpouseHolder(
        "Иван Петров Стоянска собственик",
        "Иван Петров Стоянски собственик",
      ),
    ).toBe(true);
  });

  it("T5 — refuses every adjectival gender flip, not only -ски/-ска", () => {
    // Pinning the literal „СКИ" folded „Марешки"/„Марешка" (2 corpus rows) while
    // refusing „Стоянски"/„Стоянска" — the residue applied to one spelling of an ending
    // and not its siblings.
    expect(isSpouseHolder("Иван Петров Стоянска", "Иван Петров Стоянски")).toBe(
      true,
    );
    expect(
      isSpouseHolder("Веселин Найденов Марешка", "Веселин Найденов Марешки"),
    ).toBe(true);
    expect(isSpouseHolder("Иван Петров Гоцка", "Иван Петров Гоцки")).toBe(true);
  });

  it("T5 — folds a stray trailing я, which is not a gender pair in Bulgarian", () => {
    // The feminine of Петров is Петрова, never Петровя. A „Я" arm in isGenderPair
    // produced 9 rows of refusals over 5 name pairs and NOT ONE was correct — every one
    // a stray „я" on the declarant's own name, two of them on an already-feminine one.
    expect(isSpouseHolder("Борил Петров Петровя", "Борил Петров Петров")).toBe(
      false,
    );
    expect(
      isSpouseHolder(
        "Симеонка Георгиева Аргировая",
        "Симеонка Георгиева Аргирова",
      ),
    ).toBe(false);
  });

  it("T5 — refuses two tokens, where the rest of the name is one given name", () => {
    // At two tokens the guarantee degrades to a single low-entropy token: „Ана Петрова"
    // and „Яна Петрова" are one edit apart and two sisters. 0 corpus rows have the shape.
    expect(isSpouseHolder("Ана Петрова", "Яна Петрова")).toBe(true);
    expect(isSpouseHolder("Али Вели", "Али Дели")).toBe(true);
  });

  it("refuses a parent and child whose names are a generational ROTATION", () => {
    // Under the triple-given-name convention a child is [own, father's, grandfather's],
    // so P = [p, f, g] and S = [s, p, f] share two of three tokens — and
    // `soleDifferingPair` matches by VALUE, not position, so T5 would otherwise fold a
    // father onto his son whenever the two given names are one edit apart.
    expect(isSpouseHolder("Мехмед Айдън Мехмед", "Айдън Мехмед Мехмет")).toBe(
      true,
    );
    // T6's shape of the same hazard: P named after his grandfather, S named after P —
    // same multiset, same leading token. A repeated token is the signature.
    expect(isSpouseHolder("Али Али Мехмед", "Али Мехмед Али")).toBe(true);
    expect(
      isSpouseHolder("Мустафа Мустафа Реджеб", "Мустафа Реджеб Мустафа"),
    ).toBe(true);
  });

  it("T5 — REFUSES a masculine/feminine pair on the family name", () => {
    // 270 rows, kept marked deliberately: the only single-edit shape with a reading in
    // which two people are involved.
    expect(
      isSpouseHolder("Айдън Нихадов Шабанова", "Айдън Нихадов Шабанов"),
    ).toBe(true);
    expect(isSpouseHolder("Иван Петров Стоянска", "Иван Петров Стоянски")).toBe(
      true,
    );
  });

  it("T6 — folds a re-ordering that keeps the given name first", () => {
    expect(isSpouseHolder("Айдоан Али Муталиб", "Айдоан Муталиб Али")).toBe(
      false,
    );
    expect(isSpouseHolder("Борис Желев Димов", "Борис Димов Желев")).toBe(
      false,
    );
    expect(isSpouseHolder("ГЮЛТЕН МЮМЮН МУСТАФА", "ГЮЛТЕН МУСТАФА МЮМЮН")).toBe(
      false,
    );
  });

  // ── THE REFUSALS ─────────────────────────────────────────────────────────────────
  // Each of these is a cell the corpus contains and none of the passes above may fold.
  it("refuses a cell whose surplus names a second person", () => {
    // Verbatim: the three that a „does the surplus look like a name?" heuristic folded,
    // and which the decoration ALLOWLIST refuses. The declarant's surname is shared, so
    // only the unknown given name distinguishes them.
    expect(
      isSpouseHolder(
        "Айрие Ибрямова, Алис Ремзиева",
        "Айрие Ремзиева Ибрямова",
      ),
    ).toBe(true);
    expect(
      isSpouseHolder(
        "Виктор Стоянов, Цветомир Стоянов",
        "Виктор Стоянов Стоянов",
      ),
    ).toBe(true);
    expect(
      isSpouseHolder(
        "Борислав Божинов Чалъков, Драгомир Божинов Чалъков",
        "Борислав Божинов Чалъков",
      ),
    ).toBe(true);
  });

  it("refuses a joint holding that names the declarant AND somebody else", () => {
    // 5,385 rows. „The declarant is one of several holders" is a third answer this
    // boolean does not have, so the row stays marked and the chip prints the whole cell.
    expect(
      isSpouseHolder(
        "Албена Иванова Михайлова и Милко Златков Михайлов",
        "Албена Иванова Михайлова",
      ),
    ).toBe(true);
    expect(
      isSpouseHolder(
        "Билгин Мустафа Йълмаз и Хатче Мустафа Йълмаз",
        "БИЛГИН МУСТАФА ЙЪЛМАЗ",
      ),
    ).toBe(true);
  });

  it("refuses a real spouse who shares the family name", () => {
    expect(
      isSpouseHolder("Мария Иванова Георгиева", "Иван Петров Георгиев"),
    ).toBe(true);
    expect(
      isSpouseHolder("Теодора Стоянова Копринкова", "Николай Иванов Копринков"),
    ).toBe(true);
  });

  it("refuses a cell that names unlisted co-holders", () => {
    // „др." is „други" (AND OTHERS), not the title „д-р" — `tokenize` reduces both to
    // the token ДР, so on a position-blind allowlist „X и др." stripped to exactly the
    // declarant's own tokens and folded. That does not mislabel a holder, it ERASES one
    // the register named.
    expect(
      isSpouseHolder("Калоян Емилов Методиев и др.", "Калоян Емилов Методиев"),
    ).toBe(true);
    expect(
      isSpouseHolder("Иван Петров Иванов и др", "Иван Петров Иванов"),
    ).toBe(true);
    // …while the title it shares a token with must still strip.
    expect(isSpouseHolder("д-р Иван Петров Иванов", "Иван Петров Иванов")).toBe(
      false,
    );
  });

  // Every assertion above returns `true` by default, so a rule with all its folds
  // deleted satisfies the whole refusal block. Each pair here fails in BOTH directions:
  // the refusal, and the near-twin it must be distinguished from.
  it("the refusals discriminate — each has a near-twin that DOES fold", () => {
    // masc/fem on the family name is refused; the same single edit one position earlier
    // folds.
    expect(
      isSpouseHolder("Айдън Нихадов Шабанова", "Айдън Нихадов Шабанов"),
    ).toBe(true);
    expect(
      isSpouseHolder("Айдън Нихадова Шабанов", "Айдън Нихадов Шабанов"),
    ).toBe(false);
    // An unknown surplus token is refused; a decoration surplus folds.
    expect(
      isSpouseHolder(
        "Виктор Стоянов, Цветомир Стоянов",
        "Виктор Стоянов Стоянов",
      ),
    ).toBe(true);
    expect(
      isSpouseHolder("Виктор Стоянов Стоянов в СИО", "Виктор Стоянов Стоянов"),
    ).toBe(false);
    // „и др." is refused; the leading title that shares its token folds.
    expect(
      isSpouseHolder("Иван Петров Иванов и др.", "Иван Петров Иванов"),
    ).toBe(true);
    expect(isSpouseHolder("д-р Иван Петров Иванов", "Иван Петров Иванов")).toBe(
      false,
    );
  });
});

// Exports that had no direct coverage anywhere. `incomeTotals` is the notable one: its
// header records a published-figure defect (an MP's income printed as declarant + spouse)
// and the "no combined total" rule it encodes was untested.
describe("incomeTotals", () => {
  it("returns the two people's tax bases separately and offers no combined field", () => {
    // Table 12 has one column for the declarant and one for their spouse — two PEOPLE,
    // not two halves of one figure. A third key is what a caller would reach for.
    const t = incomeTotals([
      { amountEurDeclarant: 104_975, amountEurSpouse: 58_280 },
    ]);
    expect(t.declarantEur).toBe(104_975);
    expect(t.spouseEur).toBe(58_280);
    expect(Object.keys(t).sort()).toEqual(
      ["declarantEur", "rows", "spouseEur"].sort(),
    );
  });

  it("drops rows where neither person declared anything, and keeps the rest", () => {
    const t = incomeTotals([
      { amountEurDeclarant: 0, amountEurSpouse: 0 },
      { amountEurDeclarant: null, amountEurSpouse: null },
      { amountEurDeclarant: 0, amountEurSpouse: 4_200 },
    ]);
    expect(t.rows).toHaveLength(1);
    expect(t.spouseEur).toBe(4_200);
  });

  it("keeps a NEGATIVE tax base, which a `> 0` filter would drop", () => {
    const t = incomeTotals([
      { amountEurDeclarant: -12_000, amountEurSpouse: null },
    ]);
    expect(t.rows).toHaveLength(1);
    expect(t.declarantEur).toBe(-12_000);
  });
});

describe("withinAssetCeiling", () => {
  it("caps an implausible ASSET but never a debt", () => {
    // The corpus row that forced this: a mortgage filed in the securities table at
    // €3.58bn, which made one person #1 on /officials/assets by a factor of 326.
    expect(
      withinAssetCeiling({ category: "security", valueEur: 3_580_000_000 }),
    ).toBe(false);
    // Excluding a DEBT would overstate net worth — the one direction this must not fail
    // in — so the ceiling is asset-only.
    expect(
      withinAssetCeiling({ category: "debt", valueEur: 3_580_000_000 }),
    ).toBe(true);
    expect(
      withinAssetCeiling({
        category: "real_estate",
        valueEur: ASSET_ROW_CEILING_EUR,
      }),
    ).toBe(true);
    expect(withinAssetCeiling({ category: "cash", valueEur: null })).toBe(true);
  });
});

describe("hasValuedAssets", () => {
  it("separates a filing that puts a NUMBER on something from one that only has rows", () => {
    // An incompatibility filing carries a blank-line `bank` row and no value; treating
    // that as an asset picture published €0 for people with six figures declared.
    expect(hasValuedAssets(decl(2025, null, [asset("bank", null)]))).toBe(
      false,
    );
    expect(hasValuedAssets(decl(2025, null, [asset("bank", 0)]))).toBe(false);
    expect(hasValuedAssets(decl(2025, 2024, [asset("bank", 12)]))).toBe(true);
    expect(hasValuedAssets(undefined)).toBe(false);
  });
});

describe("normHolderName", () => {
  // The entry point every fold below it depends on: it decides what "the same string"
  // means before any token pass runs.
  it("folds case, collapses whitespace and tidies the space around a hyphen", () => {
    expect(normHolderName("  тияна   димитриева - николова ")).toBe(
      "ТИЯНА ДИМИТРИЕВА-НИКОЛОВА",
    );
    expect(normHolderName("Тияна Димитриева-Николова")).toBe(
      "ТИЯНА ДИМИТРИЕВА-НИКОЛОВА",
    );
  });

  it("normalises to NFC, so a decomposed й keeps its breve", () => {
    // lettersOnly strips \p{M}; a decomposed „й" would lose the breve and fold equal to
    // „и", reattributing a third party's row to the declarant.
    expect(normHolderName("ЙОРДАНОВ".normalize("NFD"))).toBe("ЙОРДАНОВ");
  });

  it("is null-safe and trims to empty", () => {
    expect(normHolderName(null)).toBe("");
    expect(normHolderName("   ")).toBe("");
  });
});
