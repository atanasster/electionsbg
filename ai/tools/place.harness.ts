// Correctness harness for the place resolver.
// Run: npx tsx ai/tools/place.harness.ts

import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

  const byala = await resolveMunicipality("Бяла");
  ok(
    !!byala && Array.isArray(byala.ambiguous) && byala.ambiguous.length >= 1,
    `Бяла -> ambiguous (got ${byala?.ambiguous?.length ?? 0} alternative(s))`,
  );

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
  // town preference + ambiguity: "Баня" has a гр. (02720) + several с. villages
  const banya = await resolveSettlement("Баня");
  ok(
    banya?.ekatte === "02720",
    `"Баня" -> prefers the town гр. 02720 (got ${banya?.ekatte})`,
  );
  ok(
    Array.isArray(banya?.ambiguous) && (banya?.ambiguous?.length ?? 0) >= 1,
    `"Баня" -> exposes ambiguous alternatives (${banya?.ambiguous?.length ?? 0})`,
  );
  // over-reach: nonsense must still decline
  const noSet = await resolveSettlement("Зззнесъществуващо");
  ok(noSet === undefined, "nonsense settlement -> undefined (no over-reach)");

  // same-name villages in DIFFERENT municipalities: best + .ambiguous list, and
  // the alternatives must live in distinct общини (not duplicate rows).
  const banyaSet = await resolveSettlement("Баня");
  const banyaAlts = (banyaSet?.ambiguous ?? []) as { obshtina: string }[];
  const banyaObsht = new Set([
    banyaSet?.obshtina,
    ...banyaAlts.map((a) => a.obshtina),
  ]);
  ok(
    !!banyaSet && banyaAlts.length >= 3,
    `"Баня" -> best + >=3 same-name alternatives (got ${banyaAlts.length})`,
  );
  ok(
    banyaObsht.size >= 4,
    `"Баня" matches span distinct municipalities (got ${banyaObsht.size}: ${[...banyaObsht].join(",")})`,
  );

  console.log("\n=== resolvePlaceForData (exact-before-fuzzy precedence) ===");
  // THE regression: "Баня" must NOT substring-match the município "Долна баня";
  // an exact settlement wins, so it resolves to one of the Баня villages.
  const pBanya = await resolvePlaceForData("Баня");
  ok(
    pBanya?.name === "Баня",
    `"Баня" -> village Баня, not "Долна баня" (got ${pBanya?.name} / ${pBanya?.obshtina})`,
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
