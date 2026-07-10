// Build the НЗОК Рег.№ ЛЗ → EIK crosswalk — the linchpin that links each of the
// ~381 hospitals in hospital_payments.json to its own /company/:eik page
// (reimbursement-IN vs procurement-OUT on one page; hospitals are also ЗОП
// awarders). Writes data/budget/nzok/hospital_eik.json.
//
// WHY THIS IS A MATCH, NOT A LOOKUP (see docs/plans/nzok-health-pack-v1.md §4):
// there is NO public register that carries BOTH the 10-digit НЗОК Рег.№ ЛЗ and
// the EIK. The Рег.№ is a НЗОК-internal code (RRcc211sss); НЗОК's own договорни-
// партньори register (fetch_partners.ts) publishes the Рег.№ + manager + seat
// but not the EIK, while ИАМН/МЗ/TR carry the EIK but not the Рег.№. So the
// crosswalk is built by a HIGH-PRECISION match of the partner record against the
// commerce register (Postgres tr_companies/tr_officers), and only matches we can
// verify are shipped — everything else stays eik:null (honest).
//
// The precision comes from four guards, not from name similarity:
//   1. brand tokens — strip the facility-type acronym (УМБАЛ/МБАЛ/СБАЛ/…, any
//      token containing "БАЛ", plus ДКЦ/КОЦ/…) and the settlement, leaving the
//      distinctive name (Пълмед, Пирогов, a person's name); require ALL of them
//      to appear in the TR name.
//   2. type marker — a БАЛ facility must map to a TR "…БОЛНИЦА…", a ДКЦ to a
//      "…ЦЕНТЪР…" — never cross hospital↔polyclinic.
//   3. legal form — ЕАД↔EAD / ООД↔OOD / … must agree when it narrows the pool.
//   4. manager verification — when several TR hospitals share a brand token, the
//      partner's управител must appear among the TR company's active officers.
//   + a distinctive-shared-token safety gate rejects any accepted match whose
//     only overlap with the TR name is generic hospital vocabulary.
// A hand-verified MANUAL_OVERRIDES table resolves the famous high-€ hospitals the
// automatic guards can't (city-named, corporate groups, entities absent from TR
// like ВМА / МИ МВР which are state institutions surfaced on their awarder page).
//
// Requires the local Postgres (docker-compose, :5433). Because the Рег.№→EIK
// mapping is near-static (unlike the monthly payments), this is a SEPARATE,
// opt-in step — `npm run data:nzok -- --crosswalk` — not part of the default set.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getPool, end } from "../db/lib/pg";
import { fetchPartners } from "./fetch_partners";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/hospital_eik.json",
);
const PAYMENTS_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/hospital_payments.json",
);

// ── Hand-verified overrides (Рег.№ ЛЗ → EIK). Each was confirmed individually
// against the commerce register / awarder registry; comment = the facility. A
// null value force-excludes a Рег.№ from matching (a false positive we won't ship).
const MANUAL_OVERRIDES: Record<string, string | null> = {
  "1622211001": "115576405", // УМБАЛ Свети Георги, Пловдив
  "1524211020": "203831564", // МБАЛ Сърце и Мозък, Плевен  (one EIK, two sites)
  "0290211001": "203831564", // МБАЛ Сърце и Мозък, Бургас  (same EIK — Плевен+Бургас)
  "2201911042": "129000273", // Военномедицинска академия (ВМА), София
  "0306911012": "129000273", // ВМА — МБАЛ Варна
  "1524911008": "129000273", // ВМА — МБАЛ Плевен
  "1622911013": "129000273", // ВМА — МБАЛ Пловдив
  "1637232012": "129000273", // ВМА — БПЛР Хисаря
  "2020911006": "129000273", // ВМА — МБАЛ Сливен
  "2201232030": "129000273", // ВМА — БПЛР Банкя
  "2201911041": "129007218", // Медицински институт на МВР, София
  "1827211019": "117044162", // УМБАЛ Медика, Русе
  "0204211032": "201889501", // УМБАЛ Бургасмед, Бургас
  "2201211064": "130466880", // МБАЛ Света София, София
  "1319211001": "130072241", // МБАЛ Пазарджик (МБАЛ-ПЗ)
  "2201211083": "121663601", // МБАЛ Национална кардиологична болница (НКБ), София
  "1622211039": "201204876", // МБАЛ Света Каридад, Пловдив
  "0916211001": "108501669", // МБАЛ Д-р Атанас Дафовски, Кърджали
  "0204334013": "000053191", // Комплексен онкологичен център, Бургас
  "2201212075": "200105779", // СБАЛ хематологични заболявания, София
  "1622211044": "201397400", // МБАЛ Свети Иван Рилски, Пловдив
  "0140211003": "101522447", // МБАЛ Югозападна болница, Сандански
  "1432211001": "113513858", // МБАЛ Рахила Ангелова, Перник
  "1224211003": "130128163", // МБАЛ Свети Николай Чудотворец, Лом
  "2201212011": "000664332", // УСБАЛ по ендокринология Акад. Иван Пенчев, София
};

// ── Text normalisation (mirrors the offline prototype exactly).
const clean = (s: string): string =>
  s
    .replace(/&quot;/g, " ")
    .replace(/&#0?39;/g, " ")
    .replace(/&amp;/g, " ")
    .replace(/["„“”'`\-,.№()/]/g, " ")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

const NOISE = new Set([
  "УНИВЕРСИТЕТСКА",
  "МНОГОПРОФИЛНА",
  "БОЛНИЦА",
  "ЗА",
  "АКТИВНО",
  "ЛЕЧЕНИЕ",
  "СПЕШНА",
  "МЕДИЦИНА",
  "СПЕЦИАЛИЗИРАНА",
  "ПО",
  "ОБЛАСТНА",
  "ДИАГНОСТИЧНО",
  "КОНСУЛТАТИВЕН",
  "ЦЕНТЪР",
  "НАЦИОНАЛНА",
  "И",
  "ПРОДЪЛЖИТЕЛНО",
  "РЕХАБИЛИТАЦИЯ",
  "ЗАБОЛЯВАНИЯ",
  "ОНКОЛОГИЧЕН",
  "КОМПЛЕКСЕН",
  "ДЕТСКИ",
  "БОЛЕСТИ",
  "ГР",
  "ПРОФ",
  "АКАД",
  "ЛЕЧЕБНО",
  "ЗАВЕДЕНИЕ",
  "СВ",
  "СВЕТИ",
  "СВЕТА",
  "ДОКТОР",
  "ЗДРАВЕ",
]);
// Oblast-centre / common city names — a hospital's town is a separate field, not
// part of its brand (TR names usually omit it), so it must not gate the match.
const CITIES = new Set([
  "СОФИЯ",
  "ПЛОВДИВ",
  "ВАРНА",
  "БУРГАС",
  "РУСЕ",
  "СТАРА",
  "ЗАГОРА",
  "ПЛЕВЕН",
  "СЛИВЕН",
  "ДОБРИЧ",
  "ШУМЕН",
  "ПЕРНИК",
  "ХАСКОВО",
  "ЯМБОЛ",
  "ПАЗАРДЖИК",
  "БЛАГОЕВГРАД",
  "ВЕЛИКО",
  "ТЪРНОВО",
  "ВРАЦА",
  "ГАБРОВО",
  "ВИДИН",
  "МОНТАНА",
  "КЪРДЖАЛИ",
  "КЮСТЕНДИЛ",
  "ТЪРГОВИЩЕ",
  "РАЗГРАД",
  "СИЛИСТРА",
  "ЛОВЕЧ",
  "СМОЛЯН",
]);
const EXTRA_ACR = new Set([
  "ДКЦ",
  "КДЦ",
  "КОЦ",
  "ЦПЗ",
  "ЦКВЗ",
  "УСБ",
  "СБР",
  "МДОЗС",
  "ДМСГД",
  "МЦ",
  "МС",
  "ДЦ",
  "МК",
  "МИ",
  "НК",
  "ПЗ",
]);
// Legal-form suffixes — held in a separate TR column, never in the name, so they
// must never become brand tokens (ООД/ЕАД/… would zero out every candidate).
const LEGAL = new Set(["АД", "ЕАД", "ООД", "ЕООД", "ЕТ", "АГ"]);
const GENERIC = new Set([
  "БОЛНИЦА",
  "АКТИВНО",
  "ЛЕЧЕНИЕ",
  "МНОГОПРОФИЛНА",
  "УНИВЕРСИТЕТСКА",
  "ЦЕНТЪР",
  "МЕДИЦИНСКИ",
  "СПЕЦИАЛИЗИРАНА",
  "ДИАГНОСТИЧНО",
  "КОНСУЛТАТИВЕН",
  "СПЕШНА",
  "МЕДИЦИНА",
  "ЗДРАВЕ",
  "ПО",
]);

// A facility-type acronym: any token containing "БАЛ" (МБАЛ, УМБАЛ, СБАЛ, УСБАЛ,
// САГБАЛ, СГЕБАЛ, МБАЛНП, СБАЛОЗ…) or one of the explicit non-БАЛ acronyms.
const isTypeAcr = (t: string): boolean => t.includes("БАЛ") || EXTRA_ACR.has(t);

const brandTokens = (name: string): string[] => {
  const toks = clean(name)
    .split(" ")
    .filter(
      (t) =>
        t &&
        !NOISE.has(t) &&
        !CITIES.has(t) &&
        !LEGAL.has(t) &&
        t.length > 1 &&
        !/^\d+$/.test(t) &&
        !isTypeAcr(t),
    );
  if (toks.length) return toks;
  // City-named hospital ("МБАЛ Пловдив", "МБАЛ-Добрич") — nothing distinctive
  // remains, so fall back to the city token itself as the brand.
  return clean(name)
    .split(" ")
    .filter((t) => CITIES.has(t));
};

// What kind of TR entity a partner name should map to.
const typeMarker = (name: string): string | null => {
  const parts = clean(name).split(" ");
  for (const t of parts) if (t.includes("БАЛ") || t === "СБР") return "БОЛНИЦА";
  if (parts.includes("ДКЦ") || parts.includes("КДЦ") || parts.includes("МЦ"))
    return "ЦЕНТЪР";
  if (parts.includes("КОЦ")) return "ОНКОЛОГ";
  return null;
};

// Does a TR cleaned-name satisfy the partner's facility-type marker? TR registers
// hospitals by acronym (МБАЛ/УМБАЛ/СБАЛ/…) and polyclinics by ДКЦ/МЦ, NOT always the
// spelled-out БОЛНИЦА/ЦЕНТЪР the marker names — so accept the acronym form too. Without
// this, e.g. "МБАЛ ЗА ЖЕНСКО ЗДРАВЕ - НАДЕЖДА" (EIK 202195960) is dropped because its
// registered name never spells out "БОЛНИЦА", even though its brand tokens match 1:1.
const markerSatisfied = (cn: string, tm: string): boolean => {
  if (cn.includes(tm)) return true;
  const toks = cn.split(" ");
  if (tm === "БОЛНИЦА")
    return toks.some((t) => t.includes("БАЛ") || t === "СБР");
  if (tm === "ЦЕНТЪР")
    return toks.some((t) => ["ДКЦ", "КДЦ", "МЦ", "КОЦ"].includes(t));
  if (tm === "ОНКОЛОГ") return toks.some((t) => t === "КОЦ");
  return false;
};

const legalForm = (name: string): string => {
  const c = ` ${clean(name)} `;
  if (/ ЕАД /.test(c)) return "EAD";
  if (/ ЕООД /.test(c)) return "EOOD";
  if (/ ООД /.test(c)) return "OOD";
  if (/ АД /.test(c)) return "AD";
  return "";
};

// Manager name → token sets (surname+given, ≥2 tokens ≥3 chars) for officer x-check.
const managerTokenSets = (managers: string): Set<string>[] =>
  managers
    .split(",")
    .map(
      (p) =>
        new Set(
          clean(p)
            .split(" ")
            .filter((x) => x.length >= 3),
        ),
    )
    .filter((s) => s.size >= 2);

interface TrRow {
  uic: string;
  name: string;
  lf: string;
  seat: string;
  cn: string; // cleaned name
  offSets: Set<string>[]; // per-officer token sets
}

type MatchMethod =
  | "manager"
  | "unique"
  | "manager+settlement"
  | "settlement"
  | "override";

interface CrosswalkEntry {
  regNo: string;
  eik: string | null;
  name: string;
  settlement: string;
  method: MatchMethod | "ambiguous" | "no_match";
  confidence: "high" | "medium" | null;
}

const main = async (): Promise<void> => {
  const force = process.argv.includes("--force");
  const partners = await fetchPartners(force);
  // Restrict the crosswalk to the facilities НЗОК actually pays (болнична помощ) —
  // the payment file is the universe. regNos join 1:1 (~99.9%).
  const payments = JSON.parse(fs.readFileSync(PAYMENTS_FILE, "utf8")) as {
    hospitals: { regNo: string; name: string; cumulativeEur: number }[];
  };
  const payReg = new Map(payments.hospitals.map((h) => [h.regNo, h]));
  const partnerByReg = new Map(partners.map((p) => [p.regNo, p]));

  // Pull the hospital-like TR universe once (bounded ~12k rows), with active officers.
  const pool = getPool();
  const { rows } = await pool.query<{
    uic: string;
    name: string;
    lf: string | null;
    seat: string | null;
    officers: string | null;
  }>(
    `select c.uic, c.name, coalesce(c.legal_form,'') lf, coalesce(c.seat,'') seat,
       coalesce((select string_agg(o.name,'|') from tr_officers o
                 where o.uic=c.uic and coalesce(o.active,1)=1),'') officers
     from tr_companies c
     where c.legal_form in ('AD','EAD','OOD','EOOD')
       and c.name ~* '(БОЛНИЦА|ЛЕЧЕБНИ|ЛЕЧЕНИЕ|ДИСПАНСЕР|ОНКОЛОГ|ПСИХИАТ|КОНСУЛТАТИВ|ДИАГНОСТИЧ|МЕДИЦ|ЗДРАВ|КАРДИОЛОГ|АКУШЕР|ОРТОПЕД|ПУЛМОЛОГ|РЕХАБИЛИТ|ВЕНЕРИЧ|ГЕРИАТ|ХОСПИТАЛ|КЛИНИК|САНАТОР|ИСУЛ|ПИРОГОВ|ЦАРИЦА|АЛЕКСАНДРОВСКА|КАСПЕЛА|ТОКУДА|НКБ|АКАДЕМИЯ)'`,
  );
  const trs: TrRow[] = rows.map((r) => ({
    uic: r.uic,
    name: r.name,
    lf: r.lf ?? "",
    seat: clean(r.seat ?? ""),
    cn: clean(r.name),
    offSets: (r.officers ?? "")
      .split("|")
      .filter(Boolean)
      .map(
        (o) =>
          new Set(
            clean(o)
              .split(" ")
              .filter((x) => x.length >= 3),
          ),
      ),
  }));

  const entries: CrosswalkEntry[] = [];
  for (const [regNo, pay] of payReg) {
    const partner = partnerByReg.get(regNo);
    const displayName = partner?.name ?? pay.name;
    const settlement = partner?.settlement ?? "";

    // 0. Manual override wins (a string EIK, or null to force-exclude).
    if (regNo in MANUAL_OVERRIDES) {
      const eik = MANUAL_OVERRIDES[regNo];
      entries.push({
        regNo,
        eik,
        name: displayName,
        settlement,
        method: "override",
        confidence: eik ? "high" : null,
      });
      continue;
    }

    // Without a partner card (no manager/settlement) we can't verify a match — leave null.
    if (!partner) {
      entries.push({
        regNo,
        eik: null,
        name: displayName,
        settlement,
        method: "no_match",
        confidence: null,
      });
      continue;
    }

    const bt = brandTokens(partner.name);
    const lf = legalForm(partner.name);
    const tm = typeMarker(partner.name);
    const mgrs = managerTokenSets(partner.managers);
    const settleToks = clean(settlement)
      .split(" ")
      .filter((t) => t.length >= 3);

    let cands = bt.length
      ? trs.filter((t) => bt.every((tok) => t.cn.includes(tok)))
      : [];
    if (tm) {
      // Graded marker filter: the spelled-out word (БОЛНИЦА/ЦЕНТЪР) is authoritative,
      // so prefer candidates carrying it; only fall back to the acronym form (МБАЛ/…)
      // when NO spelled-out candidate survives. This keeps "МБАЛ БОЛНИЦА ЕВРОПА" a
      // unique match (both Европа hospitals would otherwise turn it ambiguous) while
      // still recovering acronym-only names like "МБАЛ ЗА ЖЕНСКО ЗДРАВЕ - НАДЕЖДА".
      const strong = cands.filter((c) => c.cn.includes(tm));
      cands = strong.length
        ? strong
        : cands.filter((c) => markerSatisfied(c.cn, tm));
    }
    const lfCands = lf ? cands.filter((c) => c.lf === lf) : [];
    const candPool = lfCands.length ? lfCands : cands;

    const hasSettle = (c: TrRow): boolean =>
      settleToks.length > 0 &&
      settleToks.some((st) => c.cn.includes(st) || c.seat.includes(st));
    const officerHit = (c: TrRow): boolean =>
      mgrs.length > 0 &&
      c.offSets.some((os) =>
        mgrs.some((mt) => [...mt].every((x) => os.has(x))),
      );

    const verified = candPool.filter(officerHit);
    const settleHits = candPool.filter(hasSettle);

    let eik: string | null = null;
    let method: CrosswalkEntry["method"] = "no_match";
    let confidence: CrosswalkEntry["confidence"] = null;
    if (verified.length === 1) {
      eik = verified[0].uic;
      method = "manager";
      confidence = "high";
    } else if (candPool.length === 1) {
      eik = candPool[0].uic;
      method = "unique";
      confidence = "high";
    } else if (verified.length > 1) {
      const vs = verified.filter(hasSettle);
      if (vs.length === 1) {
        eik = vs[0].uic;
        method = "manager+settlement";
        confidence = "high";
      } else method = "ambiguous";
    } else if (settleHits.length === 1) {
      eik = settleHits[0].uic;
      method = "settlement";
      confidence = "medium";
    } else if (candPool.length > 1) {
      method = "ambiguous";
    }

    // Distinctive-token safety gate: reject any accepted match whose only overlap
    // with the TR name is generic hospital vocabulary (kills e.g. "МИ МВР" →
    // "ФУТБОЛЕН КЛУБ АКАДЕМИЯ" style collisions the city fallback can create).
    if (eik) {
      const chosen = candPool.find((c) => c.uic === eik);
      if (chosen) {
        const trToks = new Set(chosen.cn.split(" "));
        const shared = bt.filter(
          (x) => trToks.has(x) && !GENERIC.has(x) && x.length > 3,
        );
        if (shared.length === 0) {
          eik = null;
          method = "no_match";
          confidence = null;
        }
      }
    }

    entries.push({
      regNo,
      eik,
      name: displayName,
      settlement,
      method,
      confidence,
    });
  }

  await end();

  entries.sort((a, b) => a.regNo.localeCompare(b.regNo));
  const matched = entries.filter((e) => e.eik);
  const distinctEik = new Set(matched.map((e) => e.eik));
  const totalEur = payments.hospitals.reduce((s, h) => s + h.cumulativeEur, 0);
  const matchedEur = matched.reduce(
    (s, e) => s + (payReg.get(e.regNo)?.cumulativeEur ?? 0),
    0,
  );

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      partners:
        "НЗОК договорни партньори (reports.nhif.bg/nhif_reports/nhif_partners) — Рег.№ ЛЗ + управител + седалище",
      register:
        "Търговски регистър (tr_companies/tr_officers) — EIK. Match verified by manager + type + legal form; famous cases hand-verified.",
    },
    note: "No public register carries BOTH the НЗОК Рег.№ ЛЗ and the EIK, so this is a high-precision verified match, not an authoritative lookup. Unmatched facilities carry eik:null.",
    facilityCount: entries.length,
    matchedCount: matched.length,
    distinctEikCount: distinctEik.size,
    matchedEur,
    matchedEurShare:
      totalEur > 0 ? Math.round((matchedEur / totalEur) * 1000) / 10 : 0,
    entries,
  };
  // Regression floor — the crosswalk is near-static and only improves as
  // MANUAL_OVERRIDES grow, so a drop in match rate vs the last committed run
  // means the partner scrape or the TR join silently regressed (e.g. a РЗОК page
  // returned fewer cards but still cleared the ≥300 gate). Fail loudly rather
  // than quietly pulling verified hospitals off their /company/:eik pages. No
  // readable baseline (first run / legacy shape) → skip the floor.
  let prev: { matchedCount?: number; matchedEurShare?: number } | null = null;
  if (fs.existsSync(OUT_FILE)) {
    try {
      prev = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
    } catch {
      prev = null;
    }
  }
  if (prev) {
    const prevCount = Number(prev.matchedCount ?? 0);
    const prevShare = Number(prev.matchedEurShare ?? 0);
    if (matched.length < prevCount - 5 || out.matchedEurShare < prevShare - 2)
      throw new Error(
        `crosswalk match-rate regression: ${matched.length}/${entries.length} matched (${out.matchedEurShare}% of YTD) vs prior ${prevCount} (${prevShare}%) — ` +
          `partner scrape or TR join may have regressed; re-check before overwriting ${OUT_FILE}`,
      );
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  const byMethod = new Map<string, number>();
  for (const e of entries)
    byMethod.set(e.method, (byMethod.get(e.method) ?? 0) + 1);
  console.log(
    `Wrote ${OUT_FILE}\n  ${matched.length}/${entries.length} facilities matched → ${distinctEik.size} distinct EIK` +
      ` · €${matchedEur.toLocaleString("en")} (${out.matchedEurShare}% of YTD)\n  by method: ` +
      [...byMethod].map(([m, n]) => `${m} ${n}`).join(" · "),
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
