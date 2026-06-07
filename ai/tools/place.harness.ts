// Correctness harness for the place resolver.
// Run: npx tsx ai/tools/place.harness.ts

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AmbiguousPlaceError } from "./clarify";
import { setFetcher } from "./dataClient";
import {
  resolveMunicipality,
  resolveOblast,
  resolvePlaceForData,
  resolveSettlement,
} from "./place";

setFetcher(async (path: string) => {
  const rel = path.startsWith("/") ? path.slice(1) : path;
  return JSON.parse(await readFile(join(process.cwd(), "data", rel), "utf8"));
});

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures += 1;
};

// A genuine duplicate name now raises AmbiguousPlaceError (the chooser path)
// instead of silently picking a best match. Return the caught error so the
// caller can also exercise the pin that resolves one candidate.
const expectAmbiguous = async (
  fn: () => Promise<unknown>,
  kind: "settlement" | "municipality",
  minCands: number,
  msg: string,
): Promise<AmbiguousPlaceError | null> => {
  try {
    await fn();
    ok(false, `${msg} (expected ambiguity, got a result)`);
    return null;
  } catch (e) {
    if (e instanceof AmbiguousPlaceError && e.kind === kind) {
      ok(e.candidates.length >= minCands, `${msg} (${e.candidates.length})`);
      return e;
    }
    ok(false, `${msg} (threw non-ambiguity: ${e})`);
    return null;
  }
};

const run = async () => {
  console.log("=== resolveMunicipality ===");
  for (const q of [
    "Пловдив",
    "Plovdiv",
    "Варна",
    "Sofia",
    "София",
    "Бургас",
    "Асеновград",
    "varna",
  ]) {
    const m = await resolveMunicipality(q);
    console.log(
      `  "${q}" -> ${m ? `${m.obshtina} ${m.name} (oblast ${m.oblast} = ${m.oblastName.bg})${m.ambiguous ? " [ambiguous]" : ""}` : "(none)"}`,
    );
  }

  const sofia = await resolveMunicipality("София");
  ok(sofia?.obshtina === "SOF", "София -> synthetic SOF");

  const varna = await resolveMunicipality("Varna");
  ok(varna?.oblast === "VAR", "Varna -> oblast VAR");

  const aseno = await resolveMunicipality("Асеновград");
  ok(aseno?.obshtina === "PDV01", "Асеновград -> PDV01");

  // genuine duplicate município name -> ambiguity (the chooser path), and the
  // "obshtina:<code>" pin resolves one of the candidates straight back.
  const byalaErr = await expectAmbiguous(
    () => resolveMunicipality("Бяла"),
    "municipality",
    2,
    "Бяла -> ambiguous municipalities",
  );
  if (byalaErr) {
    const first = byalaErr.candidates[0] as { obshtina: string };
    const pinned = await resolveMunicipality(`obshtina:${first.obshtina}`);
    ok(
      pinned?.obshtina === first.obshtina,
      `Бяла pin "obshtina:${first.obshtina}" -> resolves to one município`,
    );
  }

  const none = await resolveMunicipality("Атлантида");
  ok(none === undefined, "nonsense place -> undefined");

  // ---- typo / transliteration-drift tolerance (fuzzy fallback) --------------
  const plovdv = await resolveMunicipality("Пловдв"); // dropped 'и'
  ok(plovdv?.obshtina === "PDV22", `"Пловдв" (typo) -> PDV22 (Пловдив)`);

  const asenovgrd = await resolveMunicipality("Асеновгад"); // dropped 'р'
  ok(asenovgrd?.obshtina === "PDV01", `"Асеновгад" (typo) -> PDV01`);

  const plovdvLat = await resolveMunicipality("Plovdv"); // latin typo
  ok(plovdvLat?.obshtina === "PDV22", `"Plovdv" (latin typo) -> PDV22`);

  // a genuinely unknown place must still decline — fuzzy must not over-reach
  const stillNone = await resolveMunicipality("Гъзария");
  ok(stillNone === undefined, "unknown place stays undefined (no over-reach)");
  for (const q of ["Лондон", "Барселона"]) {
    const m = await resolveMunicipality(q);
    ok(m === undefined, `foreign city "${q}" stays undefined (no over-reach)`);
  }

  // synthetic Sofia must tolerate typos too (it's not in municipalities.json)
  const sofiaTypos: [string, string][] = [
    ["Софя", "dropped и"],
    ["Sofa", "latin typo"],
    ["Cофия", "mixed-script C"],
  ];
  for (const [q, why] of sofiaTypos) {
    const m = await resolveMunicipality(q);
    ok(m?.obshtina === "SOF", `"${q}" (${why}) -> SOF`);
  }

  console.log("\n=== resolveSettlement ===");
  // a town that is NOT its own município (so it exercises the settlement path)
  const kalofer = await resolveSettlement("Калофер");
  ok(
    kalofer?.ekatte === "35496" && kalofer?.name === "Калофер",
    `"Калофер" -> settlement ekatte 35496 (got ${kalofer?.ekatte})`,
  );
  const shipka = await resolveSettlement("Шипка");
  ok(shipka?.ekatte === "83199", `"Шипка" -> ekatte 83199`);
  // latin + typo
  const kaloferTypo = await resolveSettlement("Калофре"); // transposed
  ok(kaloferTypo?.name === "Калофер", `"Калофре" (typo) -> Калофер`);
  // duplicate name -> ambiguity ("Баня" = a гр. town + several с. villages),
  // spanning distinct municipalities; the "ekatte:<code>" pin resolves the town.
  const banyaErr = await expectAmbiguous(
    () => resolveSettlement("Баня"),
    "settlement",
    4,
    `"Баня" -> ambiguous settlements`,
  );
  if (banyaErr) {
    const cands = banyaErr.candidates as { obshtina: string; ekatte: string }[];
    ok(
      new Set(cands.map((c) => c.obshtina)).size >= 4,
      `"Баня" matches span distinct municipalities (${new Set(cands.map((c) => c.obshtina)).size})`,
    );
    const town = await resolveSettlement("ekatte:02720");
    ok(
      town?.ekatte === "02720" && town?.name === "Баня",
      `"Баня" pin "ekatte:02720" -> the town гр. Баня`,
    );
  }
  // over-reach: nonsense must still decline
  const noSet = await resolveSettlement("Зззнесъществуващо");
  ok(noSet === undefined, "nonsense settlement -> undefined (no over-reach)");

  console.log("\n=== resolvePlaceForData (exact-before-fuzzy precedence) ===");
  // THE regression: "Баня" must NOT substring-match the município "Долна баня".
  // An exact settlement collision now raises ambiguity (the chooser), never the
  // wrong "Долна баня".
  await expectAmbiguous(
    () => resolvePlaceForData("Баня"),
    "settlement",
    4,
    `"Баня" via resolvePlaceForData -> ambiguous settlements (not "Долна баня")`,
  );
  // an exact município still wins over a same-named village
  const pBansko = await resolvePlaceForData("Банско");
  ok(pBansko?.obshtina === "BLG01", `"Банско" -> município BLG01`);
  // a partial/typo'd município name still beats a fuzzy settlement
  const pPlovdv = await resolvePlaceForData("Пловдв");
  ok(
    pPlovdv?.obshtina === "PDV22",
    `"Пловдв" (typo) -> município Пловдив PDV22`,
  );
  // a town that isn't a município resolves to the settlement
  const pKalofer = await resolvePlaceForData("Калофер");
  ok(pKalofer?.ekatte === "35496", `"Калофер" -> settlement 35496`);
  const pKaloferTypo = await resolvePlaceForData("Калофре");
  ok(pKaloferTypo?.ekatte === "35496", `"Калофре" (typo) -> settlement 35496`);
  // fully-typed "Долна баня" still resolves to its município (exact)
  const pDolna = await resolvePlaceForData("Долна баня");
  ok(pDolna?.obshtina === "SFO59", `"Долна баня" -> município SFO59`);

  console.log("\n=== resolveOblast ===");
  const cases: [string, string][] = [
    ["Благоевград", "BLG"],
    ["Varna", "VAR"],
    ["Стара Загора", "SZR"],
    ["PDV", "PDV"],
    ["София-област", "SFO"],
    ["Хасково", "HKV"],
  ];
  for (const [q, expected] of cases) {
    const r = resolveOblast(q);
    console.log(`  "${q}" -> ${r?.code ?? "(none)"}`);
    ok(r?.code === expected, `resolveOblast "${q}" -> ${expected}`);
  }

  // typo tolerance on oblast names (fuzzy fallback)
  const oblastTypos: [string, string][] = [
    ["Благоевгад", "BLG"], // dropped 'р'
    ["Хасокво", "HKV"], // transposed 'ов'
    ["Стара Загра", "SZR"], // dropped 'о'
  ];
  for (const [q, expected] of oblastTypos) {
    const r = resolveOblast(q);
    console.log(`  "${q}" (typo) -> ${r?.code ?? "(none)"}`);
    ok(r?.code === expected, `resolveOblast "${q}" (typo) -> ${expected}`);
  }
  // over-reach guard: a foreign / nonsense name must NOT snap to an oblast
  for (const q of ["Варшава", "Москва", "Атлантида"]) {
    const r = resolveOblast(q);
    ok(r === undefined, `resolveOblast "${q}" -> undefined (no over-reach)`);
  }

  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — place resolver`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
