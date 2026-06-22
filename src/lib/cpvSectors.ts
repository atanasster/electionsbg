// CPV (Common Procurement Vocabulary, 2008) reference: the 2-digit division
// titles + the procedure-type buckets we surface in the "Какво купува" /
// "Как купува" entity breakdowns and the contracts browser. Shared by the
// offline builder (scripts/procurement/eop_breakdowns.ts) and the UI so the
// labels stay in one place. The division is `cpv.slice(0, 2)`.

export type Lang = string;

// 2-digit CPV division → human title. Bulgarian phrasings follow АОП/ЦАИС ЕОП
// usage; English follows the official CPV 2008 division titles.
export const CPV_DIVISION: Record<string, { bg: string; en: string }> = {
  "03": {
    bg: "Селско стопанство, земеделие, риболов, горско стопанство",
    en: "Agriculture, farming, fishing, forestry",
  },
  "09": {
    bg: "Нефтопродукти, горива, електричество и други енергоизточници",
    en: "Petroleum, fuel, electricity and other energy sources",
  },
  "14": {
    bg: "Продукти на минната промишленост и основни метали",
    en: "Mining, basic metals and related products",
  },
  "15": {
    bg: "Хранителни продукти, напитки и тютюн",
    en: "Food, beverages and tobacco",
  },
  "16": { bg: "Селскостопански машини", en: "Agricultural machinery" },
  "18": {
    bg: "Облекло, обувки и аксесоари",
    en: "Clothing, footwear and accessories",
  },
  "19": {
    bg: "Кожа, текстил, пластмаси и каучук",
    en: "Leather, textiles, plastics and rubber",
  },
  "22": {
    bg: "Печатни материали и свързани продукти",
    en: "Printed matter and related products",
  },
  "24": { bg: "Химически продукти", en: "Chemical products" },
  "30": {
    bg: "Канцеларска и компютърна техника и консумативи",
    en: "Office and computing machinery and supplies",
  },
  "31": {
    bg: "Електрически машини, оборудване и осветление",
    en: "Electrical machinery, equipment and lighting",
  },
  "32": {
    bg: "Радио-, телевизионно и далекосъобщително оборудване",
    en: "Radio, television and telecom equipment",
  },
  "33": {
    bg: "Медицинско оборудване, фармацевтични продукти и продукти за лични грижи",
    en: "Medical equipment, pharmaceuticals and personal-care products",
  },
  "34": {
    bg: "Транспортно оборудване и помощни продукти за транспортиране",
    en: "Transport equipment and auxiliary products",
  },
  "35": {
    bg: "Оборудване за сигурност, противопожарно и отбранително",
    en: "Security, fire-fighting, police and defence equipment",
  },
  "37": {
    bg: "Музикални инструменти, спортни стоки, игри и играчки",
    en: "Musical instruments, sports goods, games and toys",
  },
  "38": {
    bg: "Лабораторно, оптично и прецизно оборудване",
    en: "Laboratory, optical and precision equipment",
  },
  "39": {
    bg: "Мебели, обзавеждане, уреди и продукти за почистване",
    en: "Furniture, furnishings, appliances and cleaning products",
  },
  "41": { bg: "Събрана и пречистена вода", en: "Collected and purified water" },
  "42": { bg: "Промишлени машини", en: "Industrial machinery" },
  "43": {
    bg: "Машини за минно дело, добив и строителство",
    en: "Mining, quarrying and construction machinery",
  },
  "44": {
    bg: "Строителни конструкции и материали",
    en: "Construction structures and materials",
  },
  "45": { bg: "Строителни и монтажни работи", en: "Construction work" },
  "48": {
    bg: "Софтуерни пакети и информационни системи",
    en: "Software packages and information systems",
  },
  "50": {
    bg: "Услуги по ремонт и поддръжка",
    en: "Repair and maintenance services",
  },
  "51": {
    bg: "Услуги по инсталиране (без софтуер)",
    en: "Installation services (except software)",
  },
  "55": {
    bg: "Хотелиерски, ресторантьорски и търговски услуги",
    en: "Hotel, restaurant and retail-trade services",
  },
  "60": {
    bg: "Транспортни услуги (без извозване на отпадъци)",
    en: "Transport services (excl. waste haulage)",
  },
  "63": {
    bg: "Спомагателни услуги в транспорта; туристически агенции",
    en: "Supporting transport services; travel agencies",
  },
  "64": {
    bg: "Пощенски и далекосъобщителни услуги",
    en: "Postal and telecommunications services",
  },
  "65": { bg: "Обществени комунални услуги", en: "Public utilities" },
  "66": {
    bg: "Финансови и застрахователни услуги",
    en: "Financial and insurance services",
  },
  "70": { bg: "Услуги с недвижими имоти", en: "Real-estate services" },
  "71": {
    bg: "Архитектурни, строителни, инженерни и инспекционни услуги",
    en: "Architectural, engineering and inspection services",
  },
  "72": {
    bg: "ИТ услуги: консултации, софтуер, интернет и поддръжка",
    en: "IT services: consulting, software, internet and support",
  },
  "73": {
    bg: "Научноизследователски и развойни услуги",
    en: "Research and development services",
  },
  "75": {
    bg: "Услуги на държавното управление и отбраната",
    en: "Public administration and defence services",
  },
  "76": {
    bg: "Услуги, свързани с нефтената и газовата промишленост",
    en: "Oil and gas industry services",
  },
  "77": {
    bg: "Услуги в селското и горското стопанство и градинарството",
    en: "Agricultural, forestry and horticultural services",
  },
  "79": {
    bg: "Бизнес услуги: право, маркетинг, консултиране, печат и охрана",
    en: "Business services: legal, marketing, consulting, printing, security",
  },
  "80": {
    bg: "Образователни услуги и обучение",
    en: "Education and training services",
  },
  "85": {
    bg: "Здравни и социални услуги",
    en: "Health and social-work services",
  },
  "90": {
    bg: "Услуги по отпадъчни води, отпадъци, чистота и околна среда",
    en: "Sewage, refuse, cleaning and environmental services",
  },
  "92": {
    bg: "Услуги в културата, спорта и развлеченията",
    en: "Recreational, cultural and sporting services",
  },
  "98": {
    bg: "Други обществени, социални и персонални услуги",
    en: "Other community, social and personal services",
  },
};

export const cpvDivisionName = (
  code: string | undefined,
  lang: Lang,
): string => {
  const d = String(code ?? "").slice(0, 2);
  const e = CPV_DIVISION[d];
  if (!e) return d ? `CPV ${d}` : lang === "bg" ? "неизвестен" : "unknown";
  return lang === "bg" ? e.bg : e.en;
};

// Procedure-type buckets ("Как купува"). АОП/ЦАИС ЕОП and the OCDS export use
// different free-text strings for the same procedure; we fold them into the
// EU-recognised families. `key` is stored in the breakdowns; the label resolves
// in the UI.
export type ProcedureBucket =
  | "open"
  | "competition"
  | "collection"
  | "direct"
  | "framework"
  | "other"
  | "unknown";

export const procedureBucket = (
  method: string | undefined,
): ProcedureBucket => {
  const s = String(method ?? "")
    .toLowerCase()
    .trim();
  if (!s) return "unknown";
  // OCDS English method enums (the ЦАИС ЕОП flat-договори feed, 2024+). These
  // arrive as bare codes — without this mapping they'd all fall through to
  // "other" and the whole recent corpus would read as "Друга" in the browser.
  switch (s) {
    case "open":
      return "open";
    case "selective":
      return "competition"; // restricted / two-stage competitive
    case "limited":
    case "direct":
      return "direct"; // limited tendering / direct award — no open advert
  }
  if (s.includes("открит")) return "open";
  if (s.includes("събиране на оферт")) return "collection";
  if (
    s.includes("пряко") ||
    s.includes("без обявление") ||
    s.includes("без публикуване") ||
    s.includes("договаряне без")
  )
    return "direct";
  if (s.includes("състезат") || s.includes("конкурс")) return "competition";
  if (s.includes("рамков")) return "framework";
  if (s.includes("неизвест")) return "unknown";
  return "other";
};

export const PROCEDURE_LABEL: Record<
  ProcedureBucket,
  { bg: string; en: string }
> = {
  open: { bg: "Открита", en: "Open" },
  competition: { bg: "Състезателна", en: "Competitive" },
  collection: { bg: "Събиране на оферти", en: "Request for quotations" },
  direct: { bg: "Пряко / без обявление", en: "Direct / no notice" },
  framework: { bg: "Рамково споразумение", en: "Framework agreement" },
  other: { bg: "Друга", en: "Other" },
  unknown: { bg: "Неизвестна", en: "Unknown" },
};

export const procedureLabel = (b: ProcedureBucket, lang: Lang): string =>
  lang === "bg" ? PROCEDURE_LABEL[b].bg : PROCEDURE_LABEL[b].en;

// Display label for a raw procurementMethod. The АОП feed already publishes a
// Bulgarian phrase ("Открита процедура", "Договаряне без обявление", …) — keep
// it verbatim. The ЦАИС ЕОП flat feed publishes bare OCDS enums; translate
// those so a contract page never shows "limited" / "open" untranslated.
const OCDS_METHOD_LABEL: Record<string, { bg: string; en: string }> = {
  open: { bg: "Открита процедура", en: "Open procedure" },
  selective: {
    bg: "Ограничена процедура",
    en: "Selective (restricted) procedure",
  },
  limited: {
    bg: "Договаряне без обявление",
    en: "Limited (negotiated) procedure",
  },
  direct: { bg: "Пряко възлагане", en: "Direct award" },
};

export const displayProcurementMethod = (
  method: string | undefined,
  lang: Lang,
): string => {
  if (!method) return "";
  const hit = OCDS_METHOD_LABEL[method.toLowerCase().trim()];
  if (hit) return lang === "bg" ? hit.bg : hit.en;
  return method; // already a Bulgarian free-text phrase
};

// Contract category (OCDS mainProcurementCategory). Same split: the АОП feed
// gives "доставки" / "услуги" / "строителство"; the flat feed gives the English
// enum. Map the English; pass through anything already localised.
const CATEGORY_LABEL: Record<string, { bg: string; en: string }> = {
  goods: { bg: "доставки", en: "Goods" },
  services: { bg: "услуги", en: "Services" },
  works: { bg: "строителство", en: "Works" },
};

export const contractCategoryLabel = (
  category: string | undefined,
  lang: Lang,
): string => {
  if (!category) return "";
  const hit = CATEGORY_LABEL[category.toLowerCase().trim()];
  if (hit) return lang === "bg" ? hit.bg : hit.en;
  return category;
};
