/**
 * The Bulgarian bake-off passage — phase 0 of docs/plans/explainer-video-v1.md.
 *
 * WHY THIS TEXT AND NOT A GENERIC PARAGRAPH. Google's Chirp 3 HD page lists
 * `bg-bg` in BOTH of its capability-exclusion tables: no pause control and — the
 * one that matters here — **no custom pronunciations**. There is no `<phoneme>`
 * override for Bulgarian on the provider with the most bg-BG voices. So anything
 * a model says wrong can only be corrected by rewriting the text, and a passage
 * that avoids the hard cases would pass on every provider and teach us nothing.
 *
 * Every line below is therefore a case with NO API-level fix:
 *
 *   acronym    институции the site names constantly (АОП, НЗОК, ЦАИС ЕОП, …).
 *              Read letter-by-letter or as a word? The model decides and we cannot.
 *   place      real settlement names from published posts. Bulgarian stress is not
 *              orthographic, so these are genuinely hard and genuinely ours.
 *   money      euro with a DECIMAL COMMA (BG convention) — the single most common
 *              shape on this site since the 2026-01-01 euro switch.
 *   percent    decimals + a year, the other most common shape.
 *   idnum      an ЕИК: must be read digit-by-digit, never as a number. АПИ's own.
 *
 * TWO VARIANTS, and comparing them IS the experiment. `raw` is what the number
 * looks like ON SCREEN; `spoken` is the same fact with numbers spelled out in
 * Bulgarian words, which is the mitigation §2 of the plan proposes. Rendering
 * both and listening tells us whether the mitigation is necessary, sufficient,
 * or (if `raw` already sounds right) unneeded ceremony. Do not drop a variant to
 * save characters — the whole passage is ~1.4k chars against a 1M/month free tier.
 *
 * Consumed by scripts/video/tts_bakeoff.ts. Tests in passage.test.ts assert the
 * two variants stay in step and that no category quietly loses its coverage.
 */

export type HardCase = "acronym" | "place" | "money" | "percent" | "idnum";

export type PassageLine = {
  /** Which unfixable-if-wrong category this line exists to probe. */
  cases: HardCase[];
  /** As shown on screen — digits, symbols, abbreviations. */
  raw: string;
  /** Same fact, numbers spelled out in Bulgarian words (the §2 mitigation). */
  spoken: string;
  /** What to listen for. Printed next to the player in the compare page. */
  listenFor: string;
};

/**
 * Facts are real and already published — grounded in brand/posts/index.json, so
 * a listener judging the audio is judging sentences this brand would actually
 * say, not lorem ipsum with numbers in it.
 */
export const PASSAGE: PassageLine[] = [
  {
    cases: ["acronym"],
    raw: "Данните идват от АОП, ЦАИС ЕОП, НЗОК и ДФЗ, а обжалванията — от КЗК.",
    spoken:
      "Данните идват от А О П, ЦАИС ЕОП, НЗОК и Д Ф Зе, а обжалванията — от К Зе К.",
    listenFor:
      "АОП/ДФЗ/КЗК letter-by-letter; ЦАИС ЕОП and НЗОК as words. Any read as a nonsense word is a fail with no API fix.",
  },
  {
    cases: ["money", "percent"],
    raw: "ИТН отчете 161 919 € разходи за 23 861 гласа, или 6,79 € на глас.",
    spoken:
      "ИТН отчете сто шейсет и една хиляди деветстотин и деветнайсет евро разходи за двайсет и три хиляди осемстотин шейсет и един гласа, или шест цяло седемдесет и девет евро на глас.",
    listenFor:
      "Decimal COMMA read as a decimal, not as a pause or a thousands separator. The euro sign after the number.",
  },
  {
    cases: ["money"],
    raw: "Партиите отчетоха 4,23 млн. евро за кампанията, а пътната мрежа тежи €1,2 млрд.",
    spoken:
      "Партиите отчетоха четири цяло двайсет и три милиона евро за кампанията, а пътната мрежа тежи един цяло и два милиарда евро.",
    listenFor:
      "«млн.» / «млрд.» expanded, not spelled. The LEADING € in «€1,2 млрд.» — a symbol before the number is the shape most engines mishandle.",
  },
  {
    cases: ["percent"],
    raw: "През 2024 г. 43,4% от поръчките са с една оферта, при 5,38 среден успех на матурата.",
    spoken:
      "През две хиляди двайсет и четвърта година четирийсет и три цяло и четири процента от поръчките са с една оферта, при пет цяло тридесет и осем среден успех на матурата.",
    listenFor:
      "«2024 г.» as an ordinal year, not «две нула две четири». Percent decimals.",
  },
  {
    cases: ["place"],
    raw: "Ружинци, Неделино, Крушари, Малко Търново, Самуил и Безмер.",
    spoken: "Ружинци, Неделино, Крушари, Малко Търново, Самуил и Безмер.",
    listenFor:
      "Stress placement on each. Bulgarian stress is not written, so this is the category with the least chance of an easy fix.",
  },
  {
    cases: ["idnum", "acronym"],
    raw: "Агенция «Пътна инфраструктура», ЕИК 000695089, е най-големият възложител.",
    spoken:
      "Агенция «Пътна инфраструктура», ЕИК нула нула нула шест девет пет нула осем девет, е най-големият възложител.",
    listenFor:
      "The ЕИК digit-by-digit INCLUDING the leading zeros. Read as a number («шестстотин деветдесет и пет хиляди…») it is wrong and unfixable in `raw`.",
  },
];

export const VARIANTS = ["raw", "spoken"] as const;
export type Variant = (typeof VARIANTS)[number];

/** The passage as one block, for a single synthesis request per variant. */
export const passageText = (variant: Variant): string =>
  PASSAGE.map((l) => l[variant]).join(" ");

/** Every hard case the passage claims to cover — used by the test and the report. */
export const coveredCases = (): HardCase[] =>
  [...new Set(PASSAGE.flatMap((l) => l.cases))].sort();
