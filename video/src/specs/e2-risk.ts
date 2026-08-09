import type { ExplainerSpec } from "../lib/spec";
import type { RiskCanvasState } from "../lib/riskCanvasState";

/**
 * E2 — the election-risk explainer. 16:9, ~12 min long-form, accreting canvas.
 *
 * Subject: the composite «Индекс на изборния риск» on `/risk-analysis` for the
 * 19 April 2026 parliamentary election. Every figure comes from
 * `video/src/generated/risk.json`, built by `npm run video:data-risk`, which
 * calls the SAME `computeRiskComposite` the page hero and the AI `riskIndex`
 * tool call and ASSERTS each claim — see `scripts/video/build_risk.ts`.
 *
 * Verified 2026-08-09 (reproduced from data/, matches the live page exactly):
 *
 *   headline    47 · «Висок» · context track 40
 *   integrity   секционен 41 · машинна 90 · флаш 59 · концентрация 29 · процедурни 18
 *   sections    12 705 total — 6 critical · 297 high · 1 629 elevated
 *   machine     2 788 / 1 542 553 = 0,18% against a 0,2% scale end
 *   concentr.   145 settlements ≥80% (592 in 06.2024), turnout 2,12 m → 3,16 m
 *   history     7 cycles scored on all five signals · mean 54,4 · peak 77 (06.2024)
 *   lowest since 10.2022 — no cycle between scored below 47,5
 *   context     Benford 1/12 · махали +5,9pp · Pedersen 49,7 · polls 2,51pp · clusters 108/1 263
 *
 * ── WHY LONG-FORM ─────────────────────────────────────────────────────────────
 * The first cut of this ran 114 s and was wrong for the subject. The index has
 * TEN components, each with its own scale, its own denominator and its own
 * reason for being in or out of the headline — at 90 s each gets one sentence
 * and the video becomes the list of numbers the explainer format exists to
 * replace. Long-form buys the thing that actually matters here: room to say what
 * each signal MEASURES before saying what it scored, and room to state a
 * confound in the same breath as the finding.
 *
 * ── THE EDITORIAL SPINE ───────────────────────────────────────────────────────
 * A risk index about an election is the most abusable artifact this site
 * publishes: a single number a reader can screenshot as proof of fraud. This
 * video is built so nobody can use it that way, and it does that by turning the
 * index on itself — the scariest-looking component turns out to be under three
 * thousand votes, the alarming label turns out to be a fixed threshold, and the
 * one reading that IS maxed out is not an integrity signal at all.
 *
 * Three decisions worth not re-deriving:
 *
 * • **The comparison set is SEVEN cycles, not thirteen** (scenes 35–38). The
 *   headline averages the AVAILABLE integrity signals, and availability changes
 *   across the series — machine votes only exist from 2009, flash auditability
 *   from 2021-07. A cycle scored on 3 of 5 signals is a different statistic
 *   wearing the same number. The build script asserts the set is still seven.
 *
 * • **The concentration drop IS a scene now (26–28), and the confound rides in
 *   the same breath.** Settlements where one party took ≥80% fell 592 → 145
 *   since 06.2024 — the largest movement anywhere in the series. But turnout
 *   rose 2,12 m → 3,16 m over the same pair, and higher turnout mechanically
 *   dilutes an ≥80% share, so the drop is stated and the cause is refused. At
 *   90 s this had to be cut entirely; the extra length is what makes it
 *   publishable rather than misleading.
 *
 * • **Scene 40 claims June 2024 beat this cycle on ALL FIVE signals**, not
 *   merely "was higher overall" — a stronger claim, and a checkable one.
 *   `peakHigherOnAllFive` asserts it.
 *
 * voiceOver carries NO digits — rule 7. Register is conversational per the
 * SKILL.md table: «е», not «показва»; «границата», not «таван»; «избори», not
 * «цикъл»; «средната стойност», not «средното им».
 *
 * ── CANVAS (to build at gate 2) ───────────────────────────────────────────────
 * The existing `CanvasState` is the inflation line chart and cannot serve this.
 * E2 needs its own state, with ONE earned transformation rather than a swap:
 *
 *   1–4     the five integrity meters, empty, labelled
 *   5–11    meter 1 fills; 12 705 sections break into four bands
 *   12–17   meter 2 fills; the 0,2% scale end drawn as the thing 0,18% approaches
 *   18–21   meter 3 · 22–28 meter 4 (the 592 → 145 pair as a small inset)
 *   29–31   meter 5
 *   32–33   the five meters COLLAPSE into a single column of height 47
 *   34–42   that column takes its place among seven, mean line at 54, 06.2024 at 77
 *   43–45   band boundaries wash in behind; the 40 line is what makes it «Висок»
 *   46–56   a context strip drops in below, its five filling in turn
 *   57–59   everything dims but the source line
 *
 * The collapse is the one moment the canvas changes KIND, and it is the argument:
 * five measurements becoming the single number the video opened on.
 */
export const e2: ExplainerSpec<RiskCanvasState> = {
  slug: "2026-08-09-election-risk-explainer",
  kind: "explainer",
  canvasKind: "risk",
  runtimeSeconds: [600, 900],
  title: "Индексът на изборния риск: какво значи 47",
  topic: "Изборен риск",
  period: "юли 2021 — април 2026 · 7 сравними избора",
  sourceLine:
    "Източник: ЦИК, секционни протоколи · Индекс на изборния риск (експериментален) · naiasno.bg",
  link: "https://electionsbg.com/risk-analysis?elections=2026_04_19",
  sources: [
    "data/2026_04_19/reports/section/risk_score_summary.json",
    "data/2026_04_19/region_votes.json",
    "data/2026_04_19/dashboard/suspicious_settlements.json",
    "data/2026_04_19/reports/section/risk_clusters.json",
    "data/2026_04_19/reports/benford.json",
    "data/2026_04_19/problem_sections.json",
    "data/polls/accuracy.json",
    "https://results.cik.bg/pe202604/rezultati/index.html",
  ],
  voice: {
    provider: "gemini",
    voiceId: "Rasalgethi",
    /**
     * Without this the engine RUSHES — measured on scene 15, 12,5 ch/s bare
     * against 10,3 ch/s directed. `voice.md` identifies that acceleration as the
     * core defect of the bare-transcript read, and it is the one thing that made
     * the first cut sound machine-made.
     *
     * English rather than Bulgarian on Google's own guidance that English
     * delivery tags work best even on a non-English transcript; a Bulgarian note
     * measured 10,1 ch/s, i.e. the same effect, so the choice is on the vendor's
     * advice rather than on a measured difference. The last clause is load-
     * bearing: without it the note risks being read out as part of the script.
     */
    direction:
      "Read the following Bulgarian text as a calm, measured documentary narrator explaining something to an intelligent adult. Natural pacing, small pauses at commas and full stops, never rushed. Do not read this instruction aloud:",
  },
  scenes: [
    // ── ЧАСТ 1 · Числото ─────────────────────────────────────────────────────
    {
      id: 1,
      canvas: { rows: 1 },
      kicker: "Числото",
      stat: "47",
      headline: "«Висок»",
      body: "Индекс на изборния риск\nза изборите на 19 април 2026.",
      voiceOver:
        "Индексът на изборния риск за последните избори е четирийсет и седем, а до него е отбелязано «висок». В това видео ще разглобим числото на части и ще видим какво стои зад него.",
      onScreen: "47 · Висок",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.scoreRounded",
      },
    },
    {
      id: 2,
      kicker: "Къде е",
      headline: "Страницата\n«Анализ на изборния риск»",
      body: "Изборите от 19 април 2026.\nПод числото стоят десет показателя.",
      voiceOver:
        "Числото е на страницата «Анализ на изборния риск» за изборите от деветнайсети април две хиляди двайсет и шеста. Под него са десет отделни показателя.",
      onScreen: "10 показателя",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.componentCount",
      },
    },
    {
      id: 3,
      kicker: "Две групи",
      headline: "Пет влизат в оценката,\nпет само стоят до нея",
      body: "Изборен интегритет · Контекст",
      voiceOver:
        "Показателите са в две групи. Пет от тях се усредняват и дават числото. Другите пет стоят до него, но нарочно не влизат в сметката. Ще стигнем и до тях.",
      onScreen: "5 + 5",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.subject.signals",
      },
    },
    {
      id: 4,
      kicker: "Какво е и какво не е",
      headline: "Скрининг, не присъда",
      body: "Показва къде да се погледне.\nНе твърди, че някой е измамил.",
      voiceOver:
        "Важно е още в началото какво е този индекс и какво не е. Той не е заключение, че някой е измамил. Той е скрининг — показва къде си заслужава да се погледне по-внимателно. И самата страница го обозначава като експериментален.",
      onScreen: "експериментален",
    },

    // ── ЧАСТ 2 · Сигнал 1 — секционен скрининг ───────────────────────────────
    {
      id: 5,
      canvas: { focus: 1 },
      kicker: "Сигнал 1",
      headline: "Секционен скрининг",
      body: "Всяка секция получава\nсобствена оценка по седем признака.",
      voiceOver:
        "Първият показател тръгва от секциите. Всяка избирателна секция получава своя оценка по седем отделни признака — преброявания, разминавания с машините, недействителни бюлетини, дописани избиратели и други.",
      onScreen: "7 признака на секция",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.sections.signalsPerSection",
      },
    },
    {
      id: 6,
      canvas: { inset: 1, insetKind: "sections" },
      kicker: "Колко секции",
      stat: "12 705",
      headline: "секции в четири нива",
      body: "Ниско · повишено · високо · критично",
      voiceOver:
        "Секциите са дванайсет хиляди седемстотин и пет. Според оценката си всяка попада в едно от четири нива — ниско, повишено, високо и критично.",
      onScreen: "12 705",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.sections.totalSections",
      },
    },
    {
      id: 7,
      kicker: "Разпределението",
      headline: "6 критични · 297 високи\n1 629 повишени",
      body: "Останалите над десет хиляди\nса с ниска оценка.",
      voiceOver:
        "Критичните секции са шест. Високите са двеста деветдесет и седем. Повишените са хиляда шестстотин двайсет и девет. Останалите над десет хиляди са с ниска оценка.",
      onScreen: "6 · 297 · 1 629",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.sections.counts",
      },
    },
    {
      id: 8,
      kicker: "Важна подробност",
      headline: "Броят се гласовете,\nне секциите",
      body: "Малка секция тежи по-малко от голяма.",
      voiceOver:
        "Тук идва важна подробност. Индексът не брои секции, а гласовете в тях. Една малка секция с трийсет души тежи много по-малко от голяма с хиляда.",
      onScreen: "гласове, не секции",
    },
    {
      id: 9,
      kicker: "Тегла",
      headline: "Критично × 1\nВисоко × 0,5 · Повишено × 0,2",
      body: "Теглото показва колко сме сигурни\nв сигнала.",
      voiceOver:
        "И гласовете не се броят еднакво. Гласовете в критична секция влизат с пълна тежест, тези във висока — с половин, а в повишена — с една пета. Теглото показва колко сме сигурни в сигнала.",
      onScreen: "1 · 0,5 · 0,2",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.sections.bandWeights",
      },
    },
    {
      id: 10,
      canvas: { inset: 0, m1: 1 },
      kicker: "Резултатът",
      stat: "2,03%",
      headline: "65 790 от 3 233 136 гласа",
      body: "След претеглянето по нива.",
      voiceOver:
        "След това претегляне се получават шейсет и пет хиляди седемстотин и деветдесет гласа, или две цяло нула три процента от всички гласували.",
      onScreen: "65 790 · 2,03%",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.sections",
      },
    },
    {
      id: 11,
      canvas: { scaleTag: 1 },
      kicker: "Оценка",
      stat: "41",
      headline: "Скалата свършва на 5%",
      body: "2,03 от 5 дава 41.",
      voiceOver:
        "Скалата за този показател свършва на пет процента. Две цяло нула три от пет дава оценка четирийсет и едно.",
      onScreen: "41 · скала до 5%",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.sections",
      },
    },

    // ── ЧАСТ 3 · Сигнал 2 — машинна цялост ───────────────────────────────────
    {
      id: 12,
      canvas: { focus: 2, scaleTag: 0 },
      kicker: "Сигнал 2",
      headline: "Машинна цялост",
      body: "Най-високият показател\nв тези избори.",
      voiceOver:
        "Вторият показател е най-високият в тези избори и заслужава повече време. Той сравнява два независими записа на едни и същи машинни гласове.",
      onScreen: "два записа",
    },
    {
      id: 13,
      kicker: "Двата записа",
      headline: "Протоколът и флаш паметта",
      body: "Единият пише комисията.\nДругият пише машината.",
      voiceOver:
        "Единият запис е протоколът, който секционната комисия попълва и подава. Другият е флаш паметта на самата машина. Двата трябва да съвпадат до глас.",
      onScreen: "протокол ↔ флаш памет",
    },
    {
      id: 14,
      kicker: "Разминаването",
      stat: "2 788",
      headline: "гласа разлика общо",
      body: "Сборът на разминаванията по партии.",
      voiceOver:
        "Съберем ли всички разминавания по партии, се получават две хиляди седемстотин осемдесет и осем гласа.",
      onScreen: "2 788 гласа",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.machine.drift",
      },
    },
    {
      id: 15,
      canvas: { m2: 1 },
      kicker: "От колко",
      stat: "0,18%",
      headline: "от 1 542 553 машинни гласа",
      body: "Под три хиляди при милион и половина.",
      voiceOver:
        "А машинните гласове са милион петстотин четирийсет и две хиляди петстотин петдесет и три. Тоест разминаването е нула цяло осемнайсет процента.",
      onScreen: "1 542 553 · 0,18%",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.machine",
      },
    },
    {
      id: 16,
      canvas: { scaleTag: 1 },
      kicker: "Защо тогава 90",
      stat: "90",
      headline: "Границата е 0,2%",
      body: "Прагът, при който в някои държави\nсе задейства преброяване.",
      voiceOver:
        "Защо тогава деветдесет? Защото нула цяло осемнайсет процента са близо до границата от нула цяло и две — прагът, при който в някои държави се задейства преброяване.",
      onScreen: "0,18% спрямо 0,2%",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.machine",
      },
    },
    {
      id: 17,
      canvas: { scaleTag: 0 },
      kicker: "Поуката",
      headline: "Висока оценка\nне значи голямо число",
      body: "Значи, че малкото число е близо\nдо нарочно строга граница.",
      voiceOver:
        "Тук е и поуката за целия индекс. Висока оценка не значи голямо число. Значи, че малкото число е близо до умишлено строга граница. Затова винаги гледайте и какво стои под оценката.",
      onScreen: "оценка ≠ размер",
    },

    // ── ЧАСТ 4 · Сигнал 3 — липсваща флаш памет ──────────────────────────────
    {
      id: 18,
      canvas: { focus: 3 },
      kicker: "Сигнал 3",
      headline: "Липсваща флаш памет",
      body: "Не дали записите се разминават,\nа дали изобщо има с какво да се сравни.",
      voiceOver:
        "Третият показател продължава същата тема, но пита друго. Не дали двата записа се разминават, а дали изобщо има с какво да се сравни.",
      onScreen: "има ли втори запис",
    },
    {
      id: 19,
      kicker: "Какво липсва",
      headline: "Секции с машини,\nно без предадена флаш памет",
      body: "За тези гласове втори запис няма.",
      voiceOver:
        "Има секции, в които е гласувано машинно, но флаш памет не е предадена. За тези гласове втори запис просто няма и проверка не може да се направи.",
      onScreen: "без втори запис",
    },
    {
      id: 20,
      canvas: { m3: 1 },
      kicker: "Колко",
      stat: "9 104",
      headline: "машинни гласа · 0,59%",
      body: "От 1 542 553 машинни гласа.",
      voiceOver:
        "Такива са девет хиляди сто и четири машинни гласа, или нула цяло петдесет и девет процента от всички машинни.",
      onScreen: "9 104 · 0,59%",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.missingFlash",
      },
    },
    {
      id: 21,
      canvas: { scaleTag: 1 },
      kicker: "Оценка",
      stat: "59",
      headline: "Скалата свършва на 1%",
      body: "Не твърди, че нещо е сгрешено —\nа че не може да се провери.",
      voiceOver:
        "Скалата тук свършва на един процент, така че оценката е петдесет и девет. И пак — това не е твърдение, че нещо е сгрешено. Твърдението е, че не може да се провери.",
      onScreen: "59 · скала до 1%",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.missingFlash",
      },
    },

    // ── ЧАСТ 5 · Сигнал 4 — концентрация ─────────────────────────────────────
    {
      id: 22,
      canvas: { focus: 4, scaleTag: 0 },
      kicker: "Сигнал 4",
      headline: "Концентрация на гласове",
      body: "Населени места, в които една партия\nвзема над 80%.",
      voiceOver:
        "Четвъртият показател гледа населените места, в които една партия е взела над осемдесет процента от гласовете.",
      onScreen: "над 80% за една партия",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.concentration.thresholdPct",
      },
    },
    {
      id: 23,
      kicker: "Защо е сигнал",
      headline: "Може да е нормално.\nМоже и да не е.",
      body: "Малко еднородно село гласува еднакво —\nно това е и следата на организирания вот.",
      voiceOver:
        "Такова съотношение може да е напълно нормално — малко и еднородно село наистина гласува еднакво. Но е и формата, която оставя организираното гласуване, затова се следи.",
      onScreen: "двете обяснения",
    },
    {
      id: 24,
      canvas: { m4: 1 },
      kicker: "Колко",
      stat: "145",
      headline: "населени места · 18 537 гласа",
      body: "0,59% от гласувалите.",
      voiceOver:
        "В тези избори такива населени места са сто четирийсет и пет, а гласовете в тях — осемнайсет хиляди петстотин трийсет и седем. Нула цяло петдесет и девет процента от гласувалите.",
      onScreen: "145 · 18 537 · 0,59%",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.concentration",
      },
    },
    {
      id: 25,
      canvas: { scaleTag: 1 },
      kicker: "Оценка",
      stat: "29",
      headline: "Скалата свършва на 2%",
      voiceOver:
        "Скалата свършва на два процента, което дава оценка двайсет и девет.",
      onScreen: "29 · скала до 2%",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.concentration",
      },
    },
    {
      id: 26,
      canvas: { scaleTag: 0, inset: 1, insetKind: "concentration" },
      kicker: "Голямата промяна",
      headline: "592 → 145",
      body: "Толкова са били тези населени места\nпрез юни 2024.",
      voiceOver:
        "И тук има нещо интересно. През юни две хиляди двайсет и четвърта такива населени места са били петстотин деветдесет и две. Сега са сто четирийсет и пет.",
      onScreen: "592 → 145",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.concentration",
      },
    },
    {
      id: 27,
      kicker: "Внимание",
      headline: "Но и избирателите\nсе промениха",
      body: "Гласували: 2,1 млн. → 3,2 млн.",
      voiceOver:
        "Изкушаващо е това веднага да се обяви за добра новина. Само че между двете дати гласувалите се вдигат от два цяло и един милиона на три цяло и два милиона.",
      onScreen: "2,1 млн. → 3,2 млн.",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.concentration",
      },
    },
    {
      id: 28,
      canvas: { inset: 0 },
      kicker: "Изводът",
      headline: "Спадът е факт.\nПричината — не.",
      body: "Повече гласоподаватели правят 80%\nпо-труден за постигане сам по себе си.",
      voiceOver:
        "Повече гласоподаватели означава по-трудно едно населено място да стигне осемдесет процента за една партия. Спадът е факт, но защо е станал, тези данни не могат да кажат.",
      onScreen: "факт ≠ причина",
    },

    // ── ЧАСТ 6 · Сигнал 5 — процедурни аномалии ──────────────────────────────
    {
      id: 29,
      canvas: { focus: 5 },
      kicker: "Сигнал 5",
      headline: "Процедурни аномалии",
      body: "Недействителни бюлетини и дописани\nизбиратели там, където делът им е висок.",
      voiceOver:
        "Петият показател събира две неща — недействителните бюлетини и хората, дописани в списъка в изборния ден, там където делът им е необичайно висок.",
      onScreen: "недействителни + дописани",
    },
    {
      id: 30,
      canvas: { m5: 1 },
      kicker: "Колко",
      stat: "11 336",
      headline: "гласа · 0,36%",
      voiceOver:
        "Такива гласове са единайсет хиляди триста трийсет и шест, или нула цяло трийсет и шест процента от гласувалите.",
      onScreen: "11 336 · 0,36%",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.procedural",
      },
    },
    {
      id: 31,
      kicker: "Оценка",
      stat: "18",
      headline: "Най-ниската от петте",
      voiceOver:
        "Оценката е осемнайсет — най-ниската от петте показателя в тези избори.",
      onScreen: "18",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity.procedural",
      },
    },

    // ── ЧАСТ 7 · Сборът ──────────────────────────────────────────────────────
    {
      id: 32,
      canvas: { focus: null },
      kicker: "Петте заедно",
      headline: "41 · 90 · 59 · 29 · 18",
      body: "Секции · машини · флаш памет\nконцентрация · процедури",
      voiceOver:
        "Ето ги и петте заедно — четирийсет и едно, деветдесет, петдесет и девет, двайсет и девет и осемнайсет.",
      onScreen: "41 · 90 · 59 · 29 · 18",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.integrity",
      },
    },
    {
      id: 33,
      canvas: { mode: 1, avg: 1 },
      kicker: "Средното",
      stat: "47",
      headline: "Средното от петте е 47",
      body: "Обикновена средна стойност,\nбез тегла между показателите.",
      voiceOver:
        "Средното от петте е четирийсет и седем. Толкова просто е — обикновена средна стойност, без допълнителни тегла между отделните показатели.",
      onScreen: "→ 47",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.scoreRounded",
      },
    },

    // ── ЧАСТ 8 · Историята ───────────────────────────────────────────────────
    {
      id: 34,
      kicker: "Само по себе си",
      headline: "47 не значи нищо\nбез сравнение",
      voiceOver:
        "Само че четирийсет и седем само по себе си не значи нищо. Трябва ни с какво да го сравним.",
      onScreen: "47 = ?",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.scoreRounded",
      },
    },
    {
      id: 35,
      canvas: { history: 1 },
      kicker: "Назад във времето",
      headline: "13 измерени избора,\nно 7 сравними",
      voiceOver:
        "Индексът е сметнат за тринайсет избора назад. Но сравними помежду си са само седем от тях.",
      onScreen: "13 → 7",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.history",
      },
    },
    {
      id: 36,
      kicker: "Защо само седем",
      headline: "Показателите не съществуват\nпрез цялото време",
      body: "Машинното гласуване тръгва по-късно,\nданните за флаш паметта — от 2021.",
      voiceOver:
        "Причината е, че показателите не съществуват през цялото време. Машинното гласуване тръгва по-късно, а данните за флаш паметта — чак от две хиляди двайсет и първа.",
      onScreen: "не всички винаги",
    },
    {
      id: 37,
      kicker: "Значи",
      headline: "Средно от 3 показателя\nне е средно от 5",
      body: "Изглеждат като едно и също число.\nНе са.",
      voiceOver:
        "Средна стойност от три показателя и средна стойност от пет са различни неща, макар да изглеждат като едно и също число. Затова сравняваме само изборите с всичките пет.",
      onScreen: "3 ≠ 5",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.history",
      },
    },
    {
      id: 38,
      kicker: "Седемте",
      headline: "юли 2021 → април 2026",
      voiceOver:
        "Седемте сравними избора започват от юли две хиляди двайсет и първа и стигат до април две хиляди двайсет и шеста.",
      onScreen: "07.2021 → 04.2026",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.history.range",
      },
    },
    {
      id: 39,
      canvas: { meanLine: 1 },
      kicker: "Средната стойност",
      stat: "54",
      headline: "средно за седемте",
      voiceOver:
        "Седем избора са оценявани и с петте сигнала. Средната стойност е петдесет и четири.",
      onScreen: "средно 54",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.history",
      },
    },
    {
      id: 40,
      canvas: { peakTag: 1 },
      kicker: "Най-голямата",
      stat: "77",
      headline: "юни 2024",
      body: "Тогава и петте показателя са били\nпо-високи от сегашните.",
      voiceOver:
        "А най-голямата стойност е седемдесет и седем през юни две хиляди двайсет и четвърта. Тогава и петте показателя са били по-високи от сегашните.",
      onScreen: "77 · 06.2024",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.history",
      },
    },
    {
      id: 41,
      kicker: "Сега",
      stat: "47 < 54",
      headline: "Под средната стойност",
      voiceOver:
        "Тоест четирийсет и седем срещу средна стойност петдесет и четири. Последните избори са под средното за сравнимите.",
      onScreen: "47 < 54",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.comparison",
      },
    },
    {
      id: 42,
      kicker: "Кога за последно",
      headline: "октомври 2022",
      body: "Оттогава няма избори\nс по-ниска стойност.",
      voiceOver:
        "Последните избори с по-ниска стойност са октомври две хиляди двайсет и втора.",
      onScreen: "последно: 10.2022",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.comparison",
      },
    },

    // ── ЧАСТ 9 · Защо «Висок» ────────────────────────────────────────────────
    {
      id: 43,
      canvas: { peakTag: 0 },
      kicker: "Остава един въпрос",
      headline: "Щом е под средното,\nзащо пише «висок»?",
      voiceOver:
        "Остава един въпрос. Щом четирийсет и седем е под средното, защо до него е отбелязано «висок»?",
      onScreen: "защо «висок»",
    },
    {
      id: 44,
      canvas: { bands: 1 },
      kicker: "Границите",
      headline: "20 · 40 · 60",
      body: "Спокоен · повишен · висок · критичен",
      voiceOver:
        "Отговорът е в нивата. До двайсет е «спокоен», до четирийсет — «повишен», до шейсет — «висок», а над шейсет — «критичен».",
      onScreen: "20 · 40 · 60",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.history.bands",
      },
    },
    {
      id: 45,
      canvas: { bandRule: 1 },
      kicker: "Значи",
      stat: "40",
      headline: "47 е малко над границата",
      body: "Етикетът е фиксиран.\nНе знае нищо за предишните избори.",
      voiceOver:
        "Четирийсет и седем е малко над четирийсет, значи «висок». Границата е фиксирана и не знае нищо за предишните избори. Числото знае. Затова гледайте числото, а не етикета.",
      onScreen: "праг 40",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.history.highBandFloor",
      },
    },

    // ── ЧАСТ 10 · Контекстните пет ───────────────────────────────────────────
    {
      id: 46,
      canvas: { ctx: 1 },
      kicker: "Другите пет",
      stat: "40",
      headline: "Контекст, не оценка",
      body: "Стоят до числото,\nно не влизат в него.",
      voiceOver:
        "Остават петте показателя, които стоят до числото, но не влизат в него. Средната им стойност е четирийсет.",
      onScreen: "контекст 40",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.context.average",
      },
    },
    {
      id: 47,
      kicker: "Защо са отделно",
      headline: "Могат да се задействат\nи в напълно чисти избори",
      body: "Ако влизаха в оценката,\nщяха да я вдигат без причина.",
      voiceOver:
        "Отделени са, защото могат да се задействат и в напълно чисти избори. Ако влизаха в оценката, щяха да я вдигат без причина.",
      onScreen: "извън оценката",
    },
    {
      id: 48,
      canvas: { c1: 1 },
      kicker: "Контекст 1",
      stat: "8",
      headline: "Бенфорд · 1 от 12 партии",
      body: "Тест за разпределението\nна цифрите в резултатите.",
      voiceOver:
        "Първият е тестът на Бенфорд, който гледа разпределението на цифрите в резултатите. Само една партия от дванайсет се отклонява силно.",
      onScreen: "1 / 12",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.context.benford",
      },
    },
    {
      id: 49,
      kicker: "Защо е в контекста",
      headline: "Тестът се проваля\nи без нарушение",
      body: "Броят гласове в една секция\nе ограничен отгоре.",
      voiceOver:
        "Той е в контекста, защото при гласове този тест се проваля и по съвсем естествени причини — броят гласове в една секция е ограничен отгоре.",
      onScreen: "ограничен отгоре",
    },
    {
      id: 50,
      canvas: { c2: 1 },
      kicker: "Контекст 2",
      stat: "39",
      headline: "Махалите · +5,9 пункта",
      body: "Осем следени квартала,\nсравнени със страната.",
      voiceOver:
        "Вторият следи осем ромски квартала. Първата партия там се е повишила с пет цяло и девет пункта повече, отколкото се е повишила в цялата страна.",
      onScreen: "+5,9 пункта · 8 квартала",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.context.neighborhoodsSwing",
      },
    },
    {
      id: 51,
      canvas: { c3: 1 },
      kicker: "Контекст 3",
      stat: "100",
      headline: "Електорална волатилност",
      body: "Единственият показател на максимум.",
      voiceOver:
        "Третият е единственият на максимум — сто от сто. Той мери колко гласове са сменили партия между едните и другите избори.",
      onScreen: "100",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.context.voteSwitching",
      },
    },
    {
      id: 52,
      kicker: "Колко е",
      headline: "49,7 — второто най-високо",
      body: "По-високо е било само през 2009.",
      voiceOver:
        "Стойността е четирийсет и девет цяло и седем — второто най-високо ниво, което сме измервали. По-високо е било само през две хиляди и девета.",
      onScreen: "49,7 · 2-ро",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.context.voteSwitching",
      },
    },
    {
      id: 53,
      kicker: "Но",
      headline: "Това е политика,\nне нередност",
      body: "Описва как се е разместил вотът,\nне как е бил преброен.",
      voiceOver:
        "Това обаче не е сигнал за нередност. Той описва колко се е разместил вотът, а не как е бил преброен. Затова стои настрани от оценката.",
      onScreen: "разместване ≠ нередност",
    },
    {
      id: 54,
      canvas: { c4: 1 },
      kicker: "Контекст 4",
      stat: "29",
      headline: "Социологическа грешка\n2,51 пункта",
      body: "Средното отклонение\nна агенциите от резултата.",
      voiceOver:
        "Четвъртият е средната грешка на социологическите агенции — две цяло петдесет и един пункта. Сгрешена прогноза обаче не значи сгрешени избори.",
      onScreen: "2,51 пункта",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.context.polls",
      },
    },
    {
      id: 55,
      canvas: { c5: 1 },
      kicker: "Контекст 5",
      stat: "24",
      headline: "Клъстери · 108 от 1 263",
      body: "Маркирани секции,\nкоито са съседни една на друга.",
      voiceOver:
        "Петият гледа дали маркираните секции са съседни. Сто и осем от хиляда двеста шейсет и три попадат в такива струпвания, или осем цяло и шест процента.",
      onScreen: "108 / 1 263 · 8,6%",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.context.clusters",
      },
    },
    {
      id: 56,
      kicker: "Защо е в контекста",
      headline: "Брои същите секции пак",
      body: "Първият показател вече ги е преброил.",
      voiceOver:
        "И той е в контекста по проста причина — описва отново същите секции, които първият показател вече е преброил. Ако влизаше в средното, щеше да ги брои два пъти.",
      onScreen: "двойно броене",
    },

    // ── ЧАСТ 11 · Какво не казва ─────────────────────────────────────────────
    {
      id: 57,
      canvas: { dim: 0.45, bandRule: 0 },
      kicker: "Какво не казва",
      headline: "Всеки сигнал има\nи невинно обяснение",
      body: "Малка секция, еднородно население,\nкъсна кампания за вписване, законно преброяване.",
      voiceOver:
        "Накрая най-важното. Всеки от тези десет показателя има и напълно невинно обяснение — малка секция, еднородно население, късна кампания за вписване, законно преброяване.",
      onScreen: "10 показателя",
      grounding: {
        file: "video/src/generated/risk.json",
        path: "$.facts.componentCount",
      },
    },
    {
      id: 58,
      kicker: "Затова",
      headline: "Показва къде да се погледне,\nне какво е станало",
      body: "Числото е начало на проверката,\nа не неин край.",
      voiceOver:
        "Затова индексът показва къде да се погледне, а не какво е станало. Числото е начало на проверката, а не неин край.",
      onScreen: "начало, не край",
    },
    {
      id: 59,
      canvas: { dim: 1 },
      kicker: "Проверете сами",
      headline: "Разбивката е на сайта",
      body: "По секция, по населено място\nи по партия.",
      voiceOver:
        "Всичко това е на сайта — по секция, по населено място и по партия. Отворете страницата и проверете сами.",
      onScreen: "electionsbg.com/risk-analysis",
    },
  ],
};
