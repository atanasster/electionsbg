// Sector-pack institution catalogue — the high-profile public buyers whose
// generic awarder dashboard (/awarder/:eik) grows a domain pack (roads / НОИ /
// НЗОК) or an administering-agency card (ДФЗ). These are real SPA routes that
// previously had NO prerendered HTML, so a no-JS crawler (Googlebot's first
// pass, social-preview bots) hit the SPA rewrite and saw the homepage meta — a
// soft-duplicate. This single source of truth drives:
//   - scripts/prerender/dynamicRoutes.ts  → per-route static HTML + OG/meta
//   - scripts/sitemap/index.ts            → /awarder/:eik (+ /en) sitemap URLs
//   - scripts/og/capture-screens.ts       → the per-institution OG card capture
//
// Each pack names the signature visual its OG card should frame (`ogAnchor` — a
// data-og selector on the pack's hero tile) so the card leads with the roads
// map / fund-flow bar / budget bridge chart rather than a plain KPI header.
//
// The EIKs mirror the app-side constants (API_EIK in src/lib/roadAttributes,
// NOI_EIK in src/lib/noiBenchmarks, NZOK_EIK in src/lib/nzokBenchmarks,
// VSS_EIK in src/lib/vssReferenceData, AGRI_PAYER_EIK in src/data/agri/constants)
// and the PACKS registry in src/screens/components/procurement/sectorPacks.tsx —
// keep both in sync if a pack is ever re-keyed.

export type InstitutionPack = {
  /** Awarder EIK — the /awarder/:eik route param and OG-card discriminator. */
  eik: string;
  /** OG filename slug (public/og/awarder/<slug>.png). */
  slug: string;
  nameBg: string;
  nameEn: string;
  /** <title>/<meta description> copy. */
  titleBg: string;
  titleEn: string;
  descriptionBg: string;
  descriptionEn: string;
  /** Crawlable body HTML (no scripts/styles). */
  bodyBg: string;
  bodyEn: string;
  /** CSS selector of the pack's signature visual to frame in the OG card. */
  ogAnchor: string;
  /** Center the OG clip on the anchor (maps/charts that read from the middle)
   *  instead of top-aligning the card. */
  ogCenter?: boolean;
  /** Extra settle time (ms) for the visual to finish rendering before capture. */
  ogSettleMs?: number;
};

const SITE = "https://electionsbg.com";

export const INSTITUTION_PACKS: InstitutionPack[] = [
  {
    eik: "000695089",
    slug: "roads",
    nameBg: 'Агенция "Пътна инфраструктура"',
    nameEn: "Road Infrastructure Agency (АПИ)",
    titleBg:
      'Агенция "Пътна инфраструктура" (АПИ) — обществени поръчки за пътища | electionsbg.com',
    titleEn:
      "Road Infrastructure Agency (АПИ) — public procurement for roads | electionsbg.com",
    descriptionBg:
      "Обществените поръчки на Агенция „Пътна инфраструктура“ (ЕИК 000695089) — магистрали и пътища на карта, цена на километър, вид строителство, тръжен поток, повтарящи се изпълнители и конкуренция спрямо праговете на ЕС. По данни от АОП.",
    descriptionEn:
      "Public procurement of the Road Infrastructure Agency (АПИ, EIK 000695089) — motorways and roads on a map, cost per kilometre, construction category, the tender pipeline, repeat winners and competition versus the EU thresholds. Sourced from the АОП register.",
    bodyBg: `
<h1>Агенция „Пътна инфраструктура“ — обществени поръчки за пътища</h1>
<p>Агенция „Пътна инфраструктура“ (АПИ, ЕИК 000695089) е държавната агенция, която възлага строителството и поддръжката на републиканската пътна мрежа. Тук са всичките ѝ обществени поръчки от регистъра на АОП — общо възложена стойност, брой договори и изпълнители, плюс пътно-специфичен разрез: магистрали и пътища на карта, разпознат участък, цена на километър, вид строеж и компоненти, тръжен поток и повтарящи се изпълнители.</p>
<p>Страницата показва и конкуренцията спрямо праговете на ЕС — дял на поръчките с една оферта и без обявление. Виж и <a href="${SITE}/procurement">общия преглед на обществените поръчки</a> и <a href="${SITE}/procurement/awarders">топ възложителите</a>.</p>`.trim(),
    bodyEn: `
<h1>Road Infrastructure Agency — public procurement for roads</h1>
<p>The Road Infrastructure Agency (АПИ, EIK 000695089) is the state agency that awards construction and maintenance of the national road network. This page collects all of its public procurement from the АОП register — total awarded value, contract and contractor counts — plus a road-specific breakdown: motorways and roads on a map, matched road segments, cost per kilometre, construction category and work components, the tender pipeline and repeat winners.</p>
<p>It also shows competition versus the EU thresholds — the share of contracts with a single bid and with no prior call. See also the <a href="${SITE}/en/procurement">procurement overview</a> and the <a href="${SITE}/en/procurement/awarders">top awarders</a>.</p>`.trim(),
    ogAnchor: '[data-og="roads-map"]',
    ogSettleMs: 3500,
  },
  {
    eik: "121082521",
    slug: "noi",
    nameBg: "Национален осигурителен институт",
    nameEn: "National Social Security Institute (НОИ)",
    titleBg:
      "Национален осигурителен институт (НОИ) — обществени поръчки и ДОО | electionsbg.com",
    titleEn:
      "National Social Security Institute (НОИ) — procurement and the DOO fund | electionsbg.com",
    descriptionBg:
      "Обществените поръчки на Националния осигурителен институт (ЕИК 121082521), поставени в мащаба на фонд „Пенсии“ (ДОО), който институтът администрира — изплатени пенсии, разходи за администрация спрямо изплатеното, категории поръчки и стратегически доставчици. По данни от АОП и отчетите на НОИ.",
    descriptionEn:
      "Public procurement of the National Social Security Institute (НОИ, EIK 121082521), set against the scale of the Pensions (DOO) fund it administers — pensions paid out, administrative spend versus benefits, procurement categories and strategic suppliers. Sourced from the АОП register and НОИ execution reports.",
    bodyBg: `
<h1>Национален осигурителен институт — обществени поръчки и ДОО</h1>
<p>Националният осигурителен институт (НОИ, ЕИК 121082521) администрира фонд „Пенсии“ и другите фондове на държавното обществено осигуряване (ДОО). Тази страница обединява обществените му поръчки от регистъра на АОП с изпълнението на ДОО — така разходите за администрация се виждат в мащаба на милиардите, които фондът изплаща като пенсии и обезщетения.</p>
<p>Освен общата възложена стойност, договорите и изпълнителите, разрезът показва категориите поръчки, стратегическите доставчици и сравнение на административните разходи с изплатеното. Виж и <a href="${SITE}/budget">държавния бюджет</a> и <a href="${SITE}/procurement">обществените поръчки</a>.</p>`.trim(),
    bodyEn: `
<h1>National Social Security Institute — procurement and the DOO fund</h1>
<p>The National Social Security Institute (НОИ, EIK 121082521) administers the Pensions fund and the other state social-security (DOO) funds. This page fuses its public procurement from the АОП register with the DOO fund's execution — so administrative spend is shown at the scale of the billions the fund actually pays out in pensions and benefits.</p>
<p>Beyond total awarded value, contracts and contractors, the breakdown shows procurement categories, strategic suppliers and administrative spend versus benefits paid. See also the <a href="${SITE}/en/budget">state budget</a> and <a href="${SITE}/en/procurement">public procurement</a>.</p>`.trim(),
    ogAnchor: '[data-og="noi-flow"]',
    ogSettleMs: 2500,
  },
  {
    eik: "121858220",
    slug: "nzok",
    nameBg: "Национална здравноосигурителна каса",
    nameEn: "National Health Insurance Fund (НЗОК)",
    titleBg:
      "НЗОК — бюджет, плащания към болниците и лекарствата | electionsbg.com",
    titleEn:
      "НЗОК — Bulgaria's health fund: budget, hospital & drug payments | electionsbg.com",
    descriptionBg:
      "Къде отиват над €5,5 млрд. на Националната здравноосигурителна каса (НЗОК): бюджет по пера, плащания към болниците по области и на човек, реимбурсация на лекарства по молекула (INN) и обществените поръчки на касата.",
    descriptionEn:
      "Where the Bulgarian health fund (НЗОК) spends its ~€5.5bn: budget by line, hospital payments by region and per capita, drug reimbursement by active substance (INN), and the fund's public procurement.",
    bodyBg: [
      "<h1>Национална здравноосигурителна каса (НЗОК)</h1>",
      "<p>НЗОК администрира публичното здравно осигуряване в България — над <strong>€5,5 млрд.</strong> годишно по Закона за бюджета на НЗОК. Обществените поръчки на касата (около €79 млн.) са едва ~1,5% от бюджета; почти всичко останало се плаща <strong>извън ЗОП</strong> по чл. 45 ЗЗО.</p>",
      "<p>Най-големите пера са <strong>болничната медицинска помощ</strong> (~43%) и <strong>лекарствата, медицинските изделия и храните</strong> (~24%), следвани от специализираната и първичната извънболнична помощ и денталната помощ.</p>",
      `<p>Страницата показва бюджета по пера с темпа на касовото изпълнение спрямо равномерен план, плащанията към болниците по лечебно заведение и по РЗОК (общо и на човек от населението), динамиката им на годишна база, реимбурсацията на лекарства по INN и ATC група с най-бързо растящите молекули, както и сравнение между две болници. Данните са от nhif.bg. Виж и <a href="${SITE}/budget">държавния бюджет</a>.</p>`,
    ].join(""),
    bodyEn: [
      "<h1>National Health Insurance Fund of Bulgaria (НЗОК)</h1>",
      "<p>НЗОК runs Bulgaria's public health insurance — over <strong>€5.5bn</strong> a year under its budget law. The fund's public procurement (~€79M) is barely ~1.5% of that; almost everything else is paid <strong>outside public procurement</strong> (art. 45 ЗЗО).</p>",
      "<p>The largest lines are <strong>hospital care</strong> (~43%) and <strong>medicines, devices and foods</strong> (~24%), followed by specialist and primary outpatient care and dental care.</p>",
      `<p>The page shows the budget by line with cash-execution pace against an even plan, payments to hospitals by facility and by regional fund (total and per resident), their year-over-year momentum, drug reimbursement by active substance (INN) and ATC group with the fastest-rising molecules, and a two-hospital comparison. Data from nhif.bg. See also the <a href="${SITE}/en/budget">state budget</a>.</p>`,
    ].join(""),
    ogAnchor: '[data-og="nzok-bridge"]',
    ogSettleMs: 2500,
  },
  {
    eik: "121100421",
    slug: "dfz",
    nameBg: 'Държавен фонд "Земеделие"',
    nameEn: "State Fund Agriculture (ДФЗ)",
    titleBg:
      "Държавен фонд „Земеделие“ (ДФЗ) — земеделски субсидии и поръчки | electionsbg.com",
    titleEn:
      "State Fund Agriculture (ДФЗ) — farm subsidies and procurement | electionsbg.com",
    descriptionBg:
      "Държавен фонд „Земеделие“ (ЕИК 121100421) е разплащателната агенция по Общата селскостопанска политика. Виж кой получава земеделските субсидии — по схема, по област и по получател — плюс обществените поръчки на самия фонд. По данни от ДФЗ и АОП.",
    descriptionEn:
      "State Fund Agriculture (ДФЗ, EIK 121100421) is the Common Agricultural Policy paying agency. See who receives farm subsidies — by scheme, by province and by recipient — plus the fund's own public procurement. Sourced from ДФЗ and the АОП register.",
    bodyBg: `
<h1>Държавен фонд „Земеделие“ — земеделски субсидии и поръчки</h1>
<p>Държавен фонд „Земеделие“ (ДФЗ, ЕИК 121100421) е разплащателната агенция, която администрира субсидиите по Общата селскостопанска политика (ОСП) на ЕС. Фондът раздава парите, но не ги получава — затова страницата му води към пълния регистър на субсидиите, а обществените му поръчки се показват отделно.</p>
<p>Разгледайте кой получава земеделските субсидии — по схема, по област и по получател — в <a href="${SITE}/subsidies">таблото за субсидиите</a>, а обществените поръчки на фонда — заедно с общата възложена стойност, договорите и изпълнителите тук. Виж и <a href="${SITE}/procurement">обществените поръчки</a>.</p>`.trim(),
    bodyEn: `
<h1>State Fund Agriculture — farm subsidies and procurement</h1>
<p>State Fund Agriculture (ДФЗ, EIK 121100421) is the paying agency that administers the EU Common Agricultural Policy (CAP) subsidies. The fund hands out the money rather than receiving it — so its page links to the full subsidy register, and its own public procurement is shown separately.</p>
<p>Explore who receives farm subsidies — by scheme, by province and by recipient — in the <a href="${SITE}/en/subsidies">subsidies dashboard</a>, and the fund's public procurement — with total awarded value, contracts and contractors — here. See also <a href="${SITE}/en/procurement">public procurement</a>.</p>`.trim(),
    // ДФЗ has no domain pack; frame the money-flow Sankey (where its
    // procurement money goes) as the card's chart.
    ogAnchor: '[data-og="awarder-flow"]',
    ogSettleMs: 3000,
  },
  {
    eik: "121513231",
    slug: "vss",
    nameBg: "Висш съдебен съвет",
    nameEn: "Supreme Judicial Council (ВСС)",
    titleBg:
      "Съдебна власт (ВСС) — бюджет и обществени поръчки | electionsbg.com",
    titleEn:
      "The judiciary (ВСС) — budget and public procurement | electionsbg.com",
    descriptionBg:
      "Бюджетът на съдебната власт по органи (съдилища, прокуратура, ВКС, ВАС, ВСС, ИВСС) и обществените поръчки на Висшия съдебен съвет (ЕИК 121513231) — съдебни сгради, електронно правосъдие, енергия и застраховане. Плюс колко от разходите си съдебната власт покрива сама със съдебни такси. По данни от ЗДБРБ и АОП.",
    descriptionEn:
      "The judiciary's budget by spending body (courts, prosecution, ВКС, ВАС, ВСС, inspectorate) and the Supreme Judicial Council's public procurement (EIK 121513231) — courthouses, e-justice systems, energy and insurance. Plus how much of its own costs the judiciary covers from court fees. Sourced from the State Budget Law and the АОП register.",
    bodyBg: `
<h1>Съдебна власт — бюджет и обществени поръчки на ВСС</h1>
<p>Висшият съдебен съвет (ВСС, ЕИК 121513231) управлява бюджета на съдебната власт и възлага централно за цялата система — съдебните сгради, системите за електронно правосъдие, енергията и застраховането. Тази страница обединява обществените му поръчки от регистъра на АОП с бюджета на съдебната власт, приет със Закона за държавния бюджет.</p>
<p>Разрезът показва разходите по органи — съдилищата и прокуратурата взимат около 87% от бюджета, докато собственото перо на ВСС е малка част — както и какъв дял от разходите си съдебната власт покрива сама чрез съдебни такси и глоби. Заплатите на магистратите и съдебните служители се плащат извън обществените поръчки. Виж и <a href="${SITE}/judiciary">таблото на съдебната власт</a> — натовареност на съдиите, движение на делата и имуществените декларации на магистратите — както и <a href="${SITE}/budget">държавния бюджет</a> и <a href="${SITE}/procurement">обществените поръчки</a>.</p>`.trim(),
    bodyEn: `
<h1>The judiciary — budget and the Supreme Judicial Council's procurement</h1>
<p>The Supreme Judicial Council (ВСС, EIK 121513231) administers the judiciary's budget and procures centrally for the whole system — courthouses, e-justice platforms, energy and insurance. This page fuses its public procurement from the АОП register with the judiciary's budget as adopted in the State Budget Law.</p>
<p>The breakdown shows expenditure by spending body — the courts and the prosecution take roughly 87% of the budget, while the ВСС's own line is a small share — and how much of its costs the judiciary covers itself through court fees and fines. Magistrate and court-staff salaries are paid outside public procurement. See also the <a href="${SITE}/en/judiciary">judiciary dashboard</a> — judge workload, case flow and magistrates' asset declarations — as well as the <a href="${SITE}/en/budget">state budget</a> and <a href="${SITE}/en/procurement">public procurement</a>.</p>`.trim(),
    // The budget-bridge chart (per-body composition + self-financing bar) is the
    // pack's signature visual — frame it, not the KPI header.
    ogAnchor: '[data-og="vss-bridge"]',
    ogSettleMs: 2500,
  },
];
