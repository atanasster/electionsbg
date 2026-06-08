// Throwaway assertion harness for the org-name normaliser acronym fix.
// Run: npx tsx scripts/lib/__test_normalize_name.ts
import {
  normaliseOrgName,
  repairTitleCasedAcronym,
  restoreAcronyms,
} from "./normalize_name";

// The renormalise pass applies these two in sequence to NAME fields.
const pipe = (s: string) => repairTitleCasedAcronym(normaliseOrgName(s));

interface Case {
  in: string;
  want: string;
  note: string;
}

const cases: Case[] = [
  // ── Previously-mangled acronyms that must now be PRESERVED ──────────────
  {
    in: 'Ремонт … жил. блок "Кольо Фичето" №2, ЦГЧ, гр.Видин',
    want: 'Ремонт … жил. блок "Кольо Фичето" №2, ЦГЧ, гр.Видин',
    note: "mid-string 3-letter acronym ЦГЧ (was Цгч)",
  },
  {
    in: "Ремонт на сграда съгл. Решение на МС",
    want: "Ремонт на сграда съгл. Решение на МС",
    note: "mid-string 2-letter МС (was Мс)",
  },
  {
    in: "Изпълнение на консултантски услуги по чл.166, ал.1 от ЗУТ",
    want: "Изпълнение на консултантски услуги по чл.166, ал.1 от ЗУТ",
    note: "mid-string 3-letter ЗУТ (was Зут)",
  },
  {
    in: "Ремонт на санитарни помещения съгл. ПМС № 326",
    want: "Ремонт на санитарни помещения съгл. ПМС № 326",
    note: "mid-string 3-letter ПМС (was Пмс)",
  },
  {
    in: 'Изпълнение на инженеринг на кухненски блок в ГПЧЕ "Й. Радичков"',
    want: 'Изпълнение на инженеринг на кухненски блок в ГПЧЕ "Й. Радичков"',
    note: "4-letter acronym ГПЧЕ (was Гпче)",
  },
  {
    in: "Изграждане на ЦНСТПЛУИ в гр. Видин",
    want: "Изграждане на ЦНСТПЛУИ в гр. Видин",
    note: "7-letter acronym ЦНСТПЛУИ (was Цнстплуи)",
  },
  {
    in: "проект ПУДОС за рекултивация",
    want: "проект ПУДОС за рекултивация",
    note: "5-letter acronym ПУДОС (was Пудос)",
  },
  {
    in: "Реконструкция на пешеходна зона - ІV етап, Видин",
    want: "Реконструкция на пешеходна зона - ІV етап, Видин",
    note: "Cyrillic-І Roman numeral ІV (was Іv)",
  },
  {
    in: "Закупуване и доставка на компютри и ИТ оборудване",
    want: "Закупуване и доставка на компютри и ИТ оборудване",
    note: "2-letter ИТ (was Ит)",
  },
  {
    in: "Доставка на монитор HP за нуждите на общината",
    want: "Доставка на монитор HP за нуждите на общината",
    note: "Latin 2-letter brand HP (was Hp)",
  },
  {
    in: "Доставка и монтаж на LED осветление",
    want: "Доставка и монтаж на LED осветление",
    note: "Latin 3-letter LED (was Led)",
  },
  {
    in: "Доставка на компютър ACER VERITION за дирекцията",
    want: "Доставка на компютър ACER VERITION за дирекцията",
    note: "Latin multi-word brand ACER VERITION (was Acer verition)",
  },
  {
    in: "СМР по проект за енергийна ефективност",
    want: "СМР по проект за енергийна ефективност",
    note: "leading acronym SMR, following word stays lowercase (was СМР По)",
  },
  {
    in: "ОР - Център за данъци и такси",
    want: "ОР - Център за данъци и такси",
    note: "leading 2-letter ОР before mixed text (was Ор)",
  },
  {
    in: "ППР - енергийна ефективност на админ. сграда",
    want: "ППР - енергийна ефективност на админ. сграда",
    note: "leading 3-letter ППР, following word stays lowercase (was ППР - Енергийна)",
  },

  // ── Brand-initial cases ddce07c4b was designed to fix — MUST NOT regress ─
  {
    in: "ВМ ПЕТРОЛЕУМ ООД",
    want: "ВМ Петролеум ООД",
    note: "wholesale all-caps brand → ВМ kept, word title-cased",
  },
  {
    in: "Вм петролеум ООД",
    want: "ВМ Петролеум ООД",
    note: "legacy mangled remnant repaired to ВМ Петролеум",
  },
  {
    in: "ГБС - ПЛОВДИВ",
    want: "ГБС - Пловдив",
    note: "wholesale all-caps dash brand",
  },
  {
    in: "Гбс - пловдив",
    want: "ГБС - Пловдив",
    note: "legacy mangled dash remnant repaired",
  },
  {
    in: "ОБЩИНА ВИДИН",
    want: "Община Видин",
    note: "wholesale all-caps org name de-shouted",
  },
  {
    in: "ЕТ ИВАН ПЕТРОВ",
    want: "ЕТ Иван Петров",
    note: "wholesale all-caps with legal form + personal name",
  },
  {
    in: 'СУ "СВ. КЛИМЕНТ ОХРИДСКИ"',
    want: 'СУ "СВ. Климент Охридски"',
    note: "wholesale all-caps school; СВ kept by 2-3-letter brand heuristic (pre-existing, unchanged by this fix)",
  },

  // ── Shouted Cyrillic PHRASES with a lowercase qualifier — must DE-SHOUT ──
  // (a single isolated 4+ acronym stays upper; a run of 2+ does not)
  {
    in: 'IV. БЮДЖЕТНО САЛДО (дефицит "-" / излишък "+")',
    want: 'IV. Бюджетно салдо (дефицит "-" / излишък "+")',
    note: "budget label: shouted run de-shouted, parenthetical untouched",
  },
  {
    in: "ОСНОВЕН РЕМОНТ на ул. Хан Аспарух",
    want: "Основен ремонт на ул. Хан Аспарух",
    note: "two shouted words run → de-shout",
  },
  {
    in: "СТРОИТЕЛНА КОМПАНИЯ ЕООД (в ликвидация)",
    want: "Строителна компания ЕООД (в ликвидация)",
    note: "shouted org name + legal form + lowercase qualifier",
  },
];

// ── restoreAcronyms (OCR/extraction title-cased acronyms) ───────────────
interface AcrCase {
  in: string;
  want: string;
  note: string;
}
const acrCases: AcrCase[] = [
  {
    in: "Закупуване на лек автомобил за Цнстдбу 2 гр. Велинград",
    want: "Закупуване на лек автомобил за ЦНСТДБУ 2 гр. Велинград",
    note: "ЦНСТ* family prefix-matched (Цнстдбу→ЦНСТДБУ)",
  },
  {
    in: "оборудване за кухня за Цнстплуи в гр. Велинград",
    want: "оборудване за кухня за ЦНСТПЛУИ в гр. Велинград",
    note: "Цнстплуи→ЦНСТПЛУИ",
  },
  {
    in: "Ремонт на Гпче и Мбал, изграждане на Псов",
    want: "Ремонт на ГПЧЕ и МБАЛ, изграждане на ПСОВ",
    note: "multiple curated acronyms in one string",
  },
  {
    in: "Реконструкция на Сбалоз Велинград",
    want: "Реконструкция на СБАЛОЗ Велинград",
    note: "СБАЛ* family prefix-matched (Сбалоз→СБАЛОЗ)",
  },
  {
    in: "Изготвяне на Пуп за Упи XII, Смр по Ппр",
    want: "Изготвяне на ПУП за УПИ XII, СМР по ППР",
    note: "ПУП/УПИ/СМР/ППР restored; roman XII untouched",
  },
  {
    in: "Велинград, Драгиново, ремонт на улица",
    want: "Велинград, Драгиново, ремонт на улица",
    note: "real title-cased words untouched (no acronym collision)",
  },
  {
    in: "доставка на ЦНСТПЛУИ оборудване",
    want: "доставка на ЦНСТПЛУИ оборудване",
    note: "already-correct ALL-CAPS unchanged (idempotent)",
  },
  {
    in: 'Ремонт на сграда, район "Лозенец" /сопф-реш.361/ и мбал',
    want: 'Ремонт на сграда, район "Лозенец" /СОПФ-реш.361/ и МБАЛ',
    note: "LOWERCASE manglings restored (сопф→СОПФ, мбал→МБАЛ)",
  },
  {
    in: "Изготвяне на сбалансиран бюджет за община Видин",
    want: "Изготвяне на сбалансиран бюджет за община Видин",
    note: "COLLISION GUARD: 'сбалансиран' NOT mangled by СБАЛ family",
  },
  {
    in: "Тп и смр по основен ремонт на ул.",
    want: "ТП и СМР по основен ремонт на ул.",
    note: "2-letter ТП + lowercase смр restored",
  },
];

let failed = 0;
for (const c of acrCases) {
  const got = restoreAcronyms(c.in);
  const ok = got === c.want;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  [restore] ${c.note}`);
  if (!ok) {
    console.log(`        in:   ${c.in}`);
    console.log(`        want: ${c.want}`);
    console.log(`        got:  ${got}`);
  }
}
for (const c of cases) {
  const got = pipe(c.in);
  const ok = got === c.want;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.note}`);
  if (!ok) {
    console.log(`        in:   ${c.in}`);
    console.log(`        want: ${c.want}`);
    console.log(`        got:  ${got}`);
  }
}
const total = cases.length + acrCases.length;
console.log(
  `\n${total - failed}/${total} passed${failed ? ` — ${failed} FAILED` : " — all green"}`,
);
process.exit(failed ? 1 : 0);
