// Correctness harness for the place resolver.
// Run: npx tsx ai/tools/place.harness.ts

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setFetcher } from "./dataClient";
import { resolveMunicipality, resolveOblast } from "./place";

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

  console.log(
    `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — place resolver`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
