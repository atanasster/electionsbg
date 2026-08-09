// Route-level tests for /api/db/funds-fit (the fit resolver, migration 143).
//
// The SQL is covered by scripts/db/tests/funds_fit.data.test.ts; this covers the JS layer — which
// codes degrade, what the basis block guarantees, and the Bulgarian→English bridge that is the
// only reason the Interreg arm is reachable at all.
//
// THE TESTS THAT EARN THEIR PLACE here are the ones about what the payload PROMISES:
//   * the two arms are returned SEPARATELY and never summed — they are different bases (an ИСУН
//     figure is a contract's value, an Interreg one is a partner's own published budget);
//   * `basis` travels in the payload, so a consumer that renders one arm cannot present it as the
//     whole corpus;
//   * the query bridge is DECLARED, because an English row appearing under a Bulgarian query needs
//     an explanation and a reader who can see the term can tell when it picked the wrong topic.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { DB_ROUTES, __resetMissLog, OBLAST_CODES } = require("./db_routes.js");
const fs = require("node:fs");
const path = require("node:path");
const { interregQueryFor, BG_EN_TOPICS } = require("./interreg_topics.js");

beforeEach(__resetMissLog);

const route = DB_ROUTES["funds-fit"];

const BASIS = {
  isun_projects: 82011,
  isun_procedures: 2206,
  interreg_operations: 1954,
  interreg_partners: 1469,
  interreg_with_eik: 330,
};

const ISUN_ROW = { procedureCode: "BG16RFPR001-1.004", projectCount: 1869 };
const IREG_ROW = { keepId: 1, title: "Green Smiles", titleIsEnglish: true };

/** A dbRows that answers each of the three query shapes distinctly. */
const ok = () => {
  const seen = [];
  const dbRows = async (sql, params) => {
    seen.push({ sql, params });
    if (/funds_fit_basis/.test(sql)) return [BASIS];
    if (/funds_fit_isun/.test(sql)) return [ISUN_ROW];
    if (/funds_fit_interreg/.test(sql)) return [IREG_ROW];
    return [];
  };
  return { dbRows, seen };
};

const failing = (code) => async () => {
  const e = new Error(`simulated ${code}`);
  e.code = code;
  throw e;
};

test("returns both arms plus the declared basis", async () => {
  const { dbRows } = ok();
  const { body } = await route(dbRows, { q: "къща за гости" });
  assert.equal(body.isun.length, 1);
  assert.equal(body.interreg.length, 1);
  assert.deepEqual(body.basis, {
    isunProjects: 82011,
    isunProcedures: 2206,
    interregOperations: 1954,
    interregPartners: 1469,
    interregWithEik: 330,
  });
});

test("the two arms are never merged into one list", async () => {
  // They are different bases. A consumer that concatenated them would produce a list in which
  // „€559,890" (one Bulgarian partner's budget) sits beside „€56,564" (a median ИСУН grant) with
  // nothing to say they are not comparable.
  const { dbRows } = ok();
  const { body } = await route(dbRows, { q: "туризъм" });
  assert.ok(Array.isArray(body.isun) && Array.isArray(body.interreg));
  assert.equal(body.combined, undefined, "there must be no merged array");
  assert.equal(body.total, undefined, "and no summed total");
});

test("a short query returns the BASIS but searches nothing", async () => {
  // Two characters of trigram match nothing useful and scan widely. Returning the basis anyway
  // lets the tile render its coverage caption before anyone has typed.
  const { dbRows, seen } = ok();
  const { body } = await route(dbRows, { q: "къ" });
  assert.deepEqual(body.isun, []);
  assert.deepEqual(body.interreg, []);
  assert.ok(body.basis, "the basis must still be returned");
  assert.equal(
    seen.filter((c) => /funds_fit_isun|funds_fit_interreg/.test(c.sql)).length,
    0,
    "no search query should have been issued",
  );
});

test("the oblast is passed through, upper-cased, and is optional", async () => {
  const { dbRows, seen } = ok();
  await route(dbRows, { q: "иновации", oblast: "pdv" });
  const isun = seen.find((c) => /funds_fit_isun/.test(c.sql));
  assert.equal(isun.params[1], "PDV");

  const second = ok();
  await route(second.dbRows, { q: "иновации" });
  const noPlace = second.seen.find((c) => /funds_fit_isun/.test(c.sql));
  assert.equal(noPlace.params[1], null, "a blank oblast must be NULL, not an empty string");
});

test("the limit is clamped", async () => {
  const { dbRows, seen } = ok();
  await route(dbRows, { q: "иновации", limit: "9999" });
  const isun = seen.find((c) => /funds_fit_isun/.test(c.sql));
  assert.ok(isun.params[2] <= 20, `limit ${isun.params[2]} exceeds the ceiling`);
});

// ── The Bulgarian → English bridge ─────────────────────────────────────────────────────────

test("a Bulgarian query is bridged for the INTERREG arm only", async () => {
  // keep.eu publishes 86% of Interreg titles in English only, so a Bulgarian query matches almost
  // nothing there — which would make the arm that exists to stop border municipalities being told
  // „nothing near you" invisible to exactly those readers.
  const { dbRows, seen } = ok();
  const { body } = await route(dbRows, { q: "туризъм" });
  const isun = seen.find((c) => /funds_fit_isun/.test(c.sql));
  const ireg = seen.find((c) => /funds_fit_interreg/.test(c.sql));
  assert.equal(isun.params[0], "туризъм", "the ИСУН corpus is Bulgarian — do NOT bridge it");
  assert.equal(ireg.params[0], "tourism");
  assert.equal(body.interregQuery, "tourism", "and the bridge must be declared to the reader");
});

test("an unbridgeable Bulgarian query is not silently altered", async () => {
  const { dbRows, seen } = ok();
  const { body } = await route(dbRows, { q: "къща за гости" });
  const ireg = seen.find((c) => /funds_fit_interreg/.test(c.sql));
  assert.equal(ireg.params[0], "къща за гости");
  assert.equal(body.interregQuery, null, "null is what lets the UI say the arm was not searched");
});

test("an English query is left alone", async () => {
  const { dbRows, seen } = ok();
  const { body } = await route(dbRows, { q: "tourism" });
  const ireg = seen.find((c) => /funds_fit_interreg/.test(c.sql));
  assert.equal(ireg.params[0], "tourism");
  assert.equal(body.interregQuery, null, "nothing was bridged, so nothing should be claimed");
});

test("the bridge prefers the LONGER stem", async () => {
  // „културн" must beat „култур" and „енергийн" must beat „енерги" — otherwise the winner is
  // decided by wherever the shorter entry happens to sit in the list.
  assert.equal(interregQueryFor("културно наследство").term, "cultural heritage");
  assert.equal(interregQueryFor("култура").term, "culture");
  assert.equal(interregQueryFor("енергийна ефективност").term, "energy efficiency");
  assert.equal(interregQueryFor("енергия от вятър").term, "energy");
});

test("every bridge entry is lowercase Cyrillic → Latin", async () => {
  // A Latin key could never match (the bridge only runs on Cyrillic input) and an uppercase one
  // could never match either (the query is lower-cased first) — both would be silently dead.
  for (const [bg, en] of BG_EN_TOPICS) {
    assert.equal(bg, bg.toLowerCase(), `${bg} is not lowercase`);
    assert.ok(/[Ѐ-ӿ]/u.test(bg), `${bg} is not Cyrillic — it could never match`);
    assert.ok(!/[Ѐ-ӿ]/u.test(en), `${en} is not Latin — bridging to it is pointless`);
  }
});

test("the bridge has no duplicate keys", async () => {
  const keys = BG_EN_TOPICS.map(([bg]) => bg);
  assert.equal(new Set(keys).size, keys.length, "a duplicate stem makes one entry unreachable");
});

/** A real Bulgarian phrasing for every English term the table can produce. */
const REAL_PHRASINGS = {
  tourism: "туристическа агенция",
  ecotourism: "екотуризъм",
  "rural tourism": "агротуризъм",
  "cultural heritage": "културно наследство",
  culture: "културен център",
  heritage: "наследство от миналото",
  "energy efficiency": "енергийна ефективност на сграда",
  energy: "енергия от вятър",
  "renewable energy": "възобновяеми източници",
  "solar energy": "фотоволтаична централа",
  digitalisation: "дигитализация на фирма",
  digital: "цифрови умения",
  innovation: "иновации в производството",
  entrepreneurship: "предприемачество за млади",
  agriculture: "земеделска техника",
  "rural development": "селски райони",
  food: "хранителни продукти",
  health: "здравни услуги",
  healthcare: "болница за долекуване",
  "social inclusion": "социални услуги",
  education: "образование за възрастни",
  training: "обучение на персонал",
  employment: "заетост на младежи",
  youth: "младежки център",
  transport: "транспортна свързаност",
  road: "пътна инфраструктура",
  mobility: "мобилност в града",
  "water supply": "водоснабдяване и канализация",
  wastewater: "отпадни води",
  "wastewater treatment": "пречиствателна станция",
  "drinking water": "питейна вода",
  waste: "отпадъци от опаковки",
  environment: "опазване на околната среда",
  nature: "природен парк",
  climate: "климатични промени",
  flood: "наводнения в региона",
  "risk management": "рискове от бедствия",
  "cross-border": "трансгранично сътрудничество",
  sport: "спортна зала",
  crafts: "занаятчийско производство",
  museum: "музейна експозиция",
  river: "река Дунав",
  sea: "морски туризъм",
  forest: "горско стопанство",
};

test("every TERM the table can produce is reachable from a real phrasing", async () => {
  // NOT „every stem bridges to something" — feeding a stem to a table that contains it always
  // matches, so that assertion is a tautology and it passed while „околна среда" was unreachable
  // in practice (Bulgarian writes the definite „околната среда"). This requires a phrasing a
  // person would actually type, and requires the fixture to cover every term so a new entry
  // cannot be added without one.
  const terms = [...new Set(BG_EN_TOPICS.map(([, en]) => en))].sort();
  const covered = Object.keys(REAL_PHRASINGS).sort();
  assert.deepEqual(
    terms.filter((t) => !covered.includes(t)),
    [],
    "a bridge term has no real phrasing in the fixture — add one, or the entry is unproven",
  );
  for (const [term, phrase] of Object.entries(REAL_PHRASINGS)) {
    const got = interregQueryFor(phrase).bridged;
    assert.ok(
      got !== null,
      `„${phrase}" bridges to nothing, so „${term}" is unreachable in practice`,
    );
  }
});

test("ORDINARY words are not mis-bridged", async () => {
  // Every one of these was measured bridging WRONG before the stems were anchored to a word
  // boundary: „вод" is inside „произ-вод-ство", „за-вод" and „ръко-вод-ство"; „гор" is inside
  // „стара за-гор-а" (a major city) and „гор-ива". A furniture manufacturer typing
  // „производство на мебели" got an Interreg section full of water projects.
  const NOT_TOPICS = [
    "производство на мебели",
    "завод за преработка",
    "ръководство на проект",
    "доводи",
    "стара загора",
    "горива",
    "къща за гости",
    "счетоводни услуги",
    "строителна фирма",
  ];
  for (const q of NOT_TOPICS) {
    const got = interregQueryFor(q).bridged;
    assert.equal(got, null, `„${q}" was bridged to „${got}" — it is not that topic`);
  }
});

test("real phrasings reach the topic a reader means", async () => {
  const CASES = [
    ["туристическа агенция", "tourism"],
    ["екотуризъм", "ecotourism"],
    ["опазване на околната среда", "environment"],
    ["водоснабдяване и канализация", "water supply"],
    ["отпадни води", "wastewater"],
    ["горско стопанство", "forest"],
    ["енергийна ефективност на сграда", "energy efficiency"],
    ["културно наследство", "cultural heritage"],
    ["транспортна свързаност", "transport"],
    ["спортна зала", "sport"],
  ];
  for (const [q, want] of CASES)
    assert.equal(
      interregQueryFor(q).bridged,
      want,
      `„${q}" should bridge to „${want}"`,
    );
});

// ── The oblast namespace contract ──────────────────────────────────────────────────────────

test("OBLAST_CODES equals the UI's OBLAST_NAME keys", async () => {
  // Hand-copied, because `functions/` is CommonJS and cannot import the TS module — so this is
  // the gate that makes the copy safe. The first draft had a typo („VidIN") and a missing code
  // (RAZ); an unknown code is not rejected loudly, it just makes `local_count` zero on every row,
  // which reads as „nothing near you".
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "regionalOblast.ts"),
    "utf-8",
  );
  const block = src.slice(
    src.indexOf("OBLAST_NAME"),
    src.indexOf("};", src.indexOf("OBLAST_NAME")),
  );
  const want = [...block.matchAll(/^ {2}([A-Z_]+):/gmu)].map((m) => m[1]).sort();
  assert.ok(want.length >= 28, `only parsed ${want.length} oblast codes from the source`);
  assert.deepEqual([...OBLAST_CODES].sort(), want);
});

test("an unknown oblast becomes NULL rather than an empty answer", async () => {
  // A code the matview cannot hold („S22", the raw shard) would return `local_count: 0` on every
  // row — „nothing near you" — instead of being treated as „no place given".
  const { dbRows, seen } = ok();
  await route(dbRows, { q: "иновации", oblast: "S22" });
  const isun = seen.find((c) => /funds_fit_isun/.test(c.sql));
  assert.equal(isun.params[1], null);

  const good = ok();
  await route(good.dbRows, { q: "иновации", oblast: "sofia_city" });
  const ok2 = good.seen.find((c) => /funds_fit_isun/.test(c.sql));
  assert.equal(ok2.params[1], "SOFIA_CITY", "a valid code is upper-cased and kept");
});

test("the basis query does NOT swallow the codes the route refuses to degrade on", async () => {
  // ONLY the basis fails; both arms succeed. Failing everything could not isolate this — the arms
  // reject on 57014 too, so the route rejected either way and a bare `.catch(() => [null])` on the
  // basis passed the test while hiding a pool timeout behind a resolver with no declared basis.
  const onlyBasisFails = (code) => async (sql) => {
    if (/funds_fit_basis/.test(sql)) {
      const e = new Error(`simulated ${code}`);
      e.code = code;
      throw e;
    }
    if (/funds_fit_isun/.test(sql)) return [ISUN_ROW];
    if (/funds_fit_interreg/.test(sql)) return [IREG_ROW];
    return [];
  };
  for (const code of ["57014", "42501"])
    await assert.rejects(
      () => route(onlyBasisFails(code), { q: "иновации" }),
      new RegExp(`simulated ${code}`),
      `a ${code} from the basis query must propagate, not become a null basis`,
    );
  // …and the codes it SHOULD degrade on still yield a null basis with working arms.
  const { body } = await route(onlyBasisFails("42883"), { q: "иновации" });
  assert.equal(body.basis, null);
  assert.equal(body.isun.length, 1, "the arms must still answer when only the basis is missing");
});

// ── Degradation ────────────────────────────────────────────────────────────────────────────

for (const code of ["42883", "42P01", "55000", "55P03"]) {
  test(`degrades to empty arms on ${code}`, async () => {
    // 42883 first: both arms are FUNCTIONS, so a database without 143 raises undefined_function
    // and never 42P01. 55000 is a matview created WITH NO DATA — every first cloud deploy.
    const { body } = await route(failing(code), { q: "иновации" });
    assert.deepEqual(body.isun, []);
    assert.deepEqual(body.interreg, []);
  });
}

test("does NOT degrade on 57014 (the pool's own timeout)", async () => {
  // The probe has already spent the whole statement budget, so a fallback cannot finish either —
  // degrading turns a 10 s failure into a 20 s one holding a pooled connection.
  await assert.rejects(
    () => route(failing("57014"), { q: "иновации" }),
    /simulated 57014/,
  );
});

test("does NOT degrade on 42501 (a permanent missing GRANT)", async () => {
  await assert.rejects(
    () => route(failing("42501"), { q: "иновации" }),
    /simulated 42501/,
  );
});

test("logs the miss ONCE per process, naming the loader", async () => {
  const warned = [];
  const orig = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    await route(failing("42P01"), { q: "иновации" });
    await route(failing("42P01"), { q: "иновации" });
  } finally {
    console.warn = orig;
  }
  assert.equal(warned.length, 1, "a crawler must not multiply this into one line per request");
  assert.match(warned[0], /ff:not-built/);
  assert.match(warned[0], /db:load:funds-fit:pg/);
});

// ── /api/db/funds-procedure-rates ──────────────────────────────────────────────────────────
//
// The base-rate card on /funds/procedure/:code. Its contract is small and two parts of it are
// load-bearing: an unknown code must yield NULL (a card of zeroes on that page reads as „nobody
// applied"), and the payload must carry the MEDIAN and nothing derived from it — the reference
// price is computed in the open, client-side, because we have no fee corpus to justify a verdict.

const ratesRoute = DB_ROUTES["funds-procedure-rates"];

const RATE_ROW = {
  procedureCode: "BG16RFPR001-1.004",
  projectCount: 1869,
  grantMedian: 56564,
  paidProjectCount: 1023,
};

test("returns the row for a known code", async () => {
  const seen = [];
  const dbRows = async (sql, params) => {
    seen.push({ sql, params });
    return [RATE_ROW];
  };
  const { body } = await ratesRoute(dbRows, { code: "BG16RFPR001-1.004" });
  assert.deepEqual(body, RATE_ROW);
  assert.match(seen[0].sql, /funds_fit_procedure\(/);
  assert.deepEqual(seen[0].params, ["BG16RFPR001-1.004"]);
});

test("an unknown code yields NULL, not an empty object", async () => {
  // A `{}` would render a card of zeroes — „nobody applied and nothing was paid" — which on a
  // procedure page is a statement rather than an absence.
  const { body } = await ratesRoute(async () => [], { code: "NOPE-1.001" });
  assert.equal(body, null);
});

test("a blank code does not query at all", async () => {
  let called = false;
  const { body } = await ratesRoute(async () => {
    called = true;
    return [];
  }, {});
  assert.equal(body, null);
  assert.equal(called, false);
});

test("the payload carries the MEDIAN, never a fee", async () => {
  // „A fair fee is Y" is a verdict we cannot support — there is no fee corpus. The server ships
  // the denominator and the client does the division in the open.
  const { body } = await ratesRoute(async () => [RATE_ROW], { code: "X" });
  assert.ok("grantMedian" in body);
  for (const k of Object.keys(body))
    assert.ok(
      !/fee|price|consult/i.test(k),
      `the payload carries ${k} — the fee arithmetic belongs in the UI, in the open`,
    );
});

for (const code of ["42883", "42P01", "55000", "55P03"]) {
  test(`procedure rates degrade to null on ${code}`, async () => {
    const { body } = await ratesRoute(failing(code), { code: "X" });
    assert.equal(body, null);
  });
}

test("procedure rates do NOT degrade on 57014 or 42501", async () => {
  for (const code of ["57014", "42501"])
    await assert.rejects(
      () => ratesRoute(failing(code), { code: "X" }),
      new RegExp(`simulated ${code}`),
    );
});
