import { resolveChainEik } from "../tools/chainIdentity";
import {
  validateProcurementQuery,
  type ProcurementQuery,
  PROCUREMENT_BUYER_SECTORS,
} from "../../src/lib/procurementQuery";
import { detectTopic } from "../../src/lib/tenderTopics";
import type { ToolArgs, Lang } from "../tools/types";
export type ProcurementUnderstanding =
  | { kind: "none" }
  | { kind: "query"; query: ProcurementQuery }
  | {
      kind: "clarification" | "unsupported";
      message: { bg: string; en: string };
      options?: {
        label: { bg: string; en: string };
        query: ProcurementQuery;
      }[];
    };
export const PROCUREMENT_RISK_ALIASES: Record<string, RegExp> = {
  debarred: /отстранен|забранени? доставчи|debarred|debarment|blacklisted/i,
  mpConnected:
    /свързан[а-я]* с депутат|свързани с народни представители|mp.connected|linked to mps/i,
  pepConnected:
    /длъжностни лица|политически свързан|pep.connected|public officials/i,
  awarderConcentration: /концентраци|concentration/i,
  amendment: /с анекс|с изменение|with amendments/i,
  annexGrowth:
    /ръст.*анекс|увеличен.*анекс|голямо увеличение на стойността|large value.increase|annex growth|amendment growth/i,
  newFirmWinner:
    /нови фирми|нова фирма|новосъздад|новоучреден|new firm|newly formed|newly established/i,
  splitPurchase:
    /раздроб|разделени поръчки|разделяне на покупки|split.purchas/i,
  appealUpheld:
    /уважен.*обжалван|свързан[а-я]* с уважена жалба|linked to a recorded upheld appeal|upheld appeal risk/i,
  weakCompetition: /слаба конкуренция|weak.competition/i,
  directAward:
    /пряко възлагане|директно възлагане|без конкуренция|direct.award/i,
  shortTenderPeriod: /кратък срок за оферти|short tender.period/i,
  nkidMismatch:
    /несъответствие.*(?:нкид|дейност)|nkid mismatch|activity mismatch|activity versus procurement.subject mismatch/i,
  nonOpenProcedure:
    /неоткрита процедура|неоткрити процедури|non.open.procedure/i,
  rushedDeadline: /кратък срок|кратки срокове|rushed.deadline|short deadline/i,
  shortDecisionPeriod:
    /бързо решение|бързо сключване|кратък срок за решение|short decision period|short interval between submission deadline and signing/i,
  awardOverEstimate:
    /над прогнозната|над прогнозната стойност|надвишена прогнозна|award over estimate|above.*estimate/i,
};
const MONTHS = [
  ["януари", "january"],
  ["февруари", "february"],
  ["март", "march"],
  ["април", "april"],
  ["май", "may"],
  ["юни", "june"],
  ["юли", "july"],
  ["август", "august"],
  ["септември", "september"],
  ["октомври", "october"],
  ["ноември", "november"],
  ["декември", "december"],
];
const pad = (n: number) => String(n).padStart(2, "0");
const date = (y: number, m = 1, d = 1) => `${y}-${pad(m)}-${pad(d)}`;
const nextDay = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const fail = (
  bg: string,
  en: string,
  kind: "clarification" | "unsupported" = "clarification",
): ProcurementUnderstanding => ({ kind, message: { bg, en } });
export const isProcurementQuestion = (text: string): boolean => {
  if (
    /(?:картел|антитръст|монопол|antitrust|cartel|merger|омбудсман)/i.test(
      text,
    ) &&
    !/(?:зоп|обществен.*поръч|procurement)/i.test(text)
  )
    return false;
  return /обществен.*поръч|поръчк|договор|анекс|жалб|complaint|процедур|procedure|\btenders?\b|\bcontracts?\b|procurement|\bkzk\b|кзк|\bcpv\b|цпв|търг(?:ове|овете|ът|а)?(?:\s|$|[?.,])/iu.test(
    text,
  );
};
export function understandProcurement(
  text: string,
  options: { now?: Date; previous?: ProcurementQuery; lang?: Lang } = {},
): ProcurementUnderstanding {
  const original = text.trim();
  if (original.length > 2048)
    return fail(
      "Въпросът е прекалено дълъг.",
      "The question is too long.",
      "unsupported",
    );
  const follow =
    Boolean(options.previous) &&
    /^(?:а\s|и\s|and\s|what about\s|а?\s*(?:за |през )?20\d{2}|покажи ги|изброй ги|show them|list them|по възложител|by buyer|сравни|compare|само |only |без |clear |махни |добави )/i.test(
      original,
    );
  if (!isProcurementQuestion(original) && !follow) return { kind: "none" };
  if (
    /(?:изтрий|delete|drop table|ignore.*instructions|игнорирай.*инструкци|system prompt)/i.test(
      original,
    )
  )
    return fail(
      "Този инструмент изпълнява само справки.",
      "This tool supports read-only queries.",
      "unsupported",
    );
  let s = original
    .toLocaleLowerCase("bg")
    .replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g, "$3.$2.$1")
    .replace(/(?:два|двама|two)\s+(участни[а-я]*|bidders)/g, "2 $1");
  for (const [i, names] of MONTHS.entries())
    for (const name of names)
      s = s.replace(
        new RegExp(`${name}\\s+(20\\d{2})`, "g"),
        `${pad(i + 1)}/$1`,
      );
  const q: ToolArgs = follow
    ? { ...options.previous, offset: 0 }
    : { corpus: "contracts" };
  const chain = /метро\s*станц|subway|metro station/i.test(original)
    ? undefined
    : resolveChainEik(original);
  if (chain && /договор|contract/i.test(original)) q.supplierIds = [chain];
  const now = options.now || new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const year = Number(today.slice(0, 4));
  if (/тръж|търг|обявен.*поръч|announced.*procurement|\btender/.test(s))
    q.corpus = "tenders";
  const primaryKind = [
    { corpus: "contracts", re: /договор|contracts?/ },
    { corpus: "tenders", re: /търг|tenders?|процедур|procedures?/ },
    { corpus: "appeals", re: /жалб|complaints?|appeals?/ },
  ]
    .map((k) => ({ ...k, index: s.search(k.re) }))
    .filter((k) => k.index >= 0)
    .sort((a, b) => a.index - b.index)[0];
  if (primaryKind) q.corpus = primaryKind.corpus;
  else if (/кзк|\bkzk\b/.test(s)) q.corpus = "appeals";
  if (
    /(?:решения|актове|decisions|acts).*?(?:кзк|kzk)|(?:кзк|kzk).*?(?:решения|актове|decisions|acts)/.test(
      s,
    )
  )
    q.corpus = "decisions";
  if (
    /анекс|amendment/.test(s) &&
    !/(?:договор|contract|с анекс|with amendment)/.test(s)
  )
    q.corpus = "amendments";
  if (/измененията на договор|contract amendment events/.test(s))
    q.corpus = "amendments";
  if (follow && q.corpus !== options.previous!.corpus)
    return fail(
      "Уточнете дали периодът се отнася до процедурата, жалбата или решението.",
      "Specify whether the period applies to the procedure, complaint or decision.",
    );
  if (/подписан|signature|signing date|signed/.test(s)) q.dateBasis = "signed";
  if (
    /(?:краен срок|deadline).*(?:през|от |за 20|in |from )/.test(s) &&
    q.corpus === "tenders"
  )
    q.dateBasis = "deadline";
  if (/(?:дата на решени|decision date)/.test(s) && q.corpus === "appeals")
    q.dateBasis = "decision";
  if (/процент|дял|percent|share|rate/.test(s)) q.operation = "share";
  else if (/сравни|compare/.test(s)) q.operation = "compare";
  else if (/по месеци|месеч|monthly|trend|тенденц/.test(s)) {
    q.operation = "trend";
    q.groupBy = "month";
  } else if (/най-|top |rank/.test(s)) {
    q.operation = "rank";
    q.groupBy = /изпълнител|supplier|contractor/.test(s) ? "supplier" : "buyer";
  } else if (/покажи|изброй|списък|show|list/.test(s)) q.operation = "list";
  else if (!follow) q.operation = "count";
  if (
    /(?:най-висок|highest|rank|top).*|най-голем/.test(s) &&
    /възложител|buyers/.test(s)
  ) {
    q.operation = "rank";
    q.groupBy = "buyer";
  }
  const minimum = s.match(/(?:поне|at least)\s+(\d+)\s+(?:договор|contract)/);
  if (minimum) {
    q.minGroupCount = +minimum[1];
    q.minGroupCountBasis = "population";
    q.groupBy = "buyer";
    q.operation = "rank";
  }
  if (
    q.corpus === "tenders" &&
    /най-голям|biggest|largest/.test(s) &&
    !/възложител|buyers/.test(s)
  ) {
    q.operation = "list";
    q.metric = "value";
    q.limit = 1;
    delete q.groupBy;
  }
  if (/по възложител|by buyer/.test(s)) {
    q.groupBy = "buyer";
    if (q.operation !== "share") q.operation = "rank";
  }
  if (/по години|by year|annual/.test(s)) {
    q.groupBy = "year";
    q.operation = "trend";
  }
  const bidderPhrase = s.match(
    /(?:(поне|at least|най-много|at most|над|more than|под|fewer than)\s+)?\b(\d+)\s+(?:участни[а-я]*|оферт[а-я]*|bidders?|bids?)/,
  );
  const one =
    (!bidderPhrase || (!bidderPhrase[1] && +bidderPhrase[2] === 1)) &&
    /\b1\s+(?:участник|оферт|bidder|bid)|един участник|една оферта|one bidder|one bid|single.bid/.test(
      s,
    );
  const explicitMeasure =
    one ||
    /обжалван|обжалване|appealed|уважен|upheld|успешн|спрян|спрени|suspended|стойност|value|risk count|cri/.test(
      s,
    ) ||
    Object.values(PROCUREMENT_RISK_ALIASES).some((pattern) => pattern.test(s));
  const adding = /добави|add|also|също/.test(s);
  if (follow && explicitMeasure && !adding) {
    delete q.numeratorPredicates;
    delete q.numeratorMode;
    delete q.denominator;
    delete q.metric;
  }
  if (one) q.metric = "oneBid";
  if (
    /стойност|сума|value|amount|worth/.test(s) &&
    !/(?:прогнозн|estimate|над |above|under|под |надвиш|over estimate)/.test(s)
  ) {
    q.metric = "value";
    if (q.operation === "count") q.operation = "sum";
  }
  if (one && /стойност|value|amount/.test(s)) {
    q.metric = "oneBid";
    if (q.operation === "sum") q.operation = "summary";
  }
  const minRisk = s.match(
    /(?:поне|at least)\s+(два|две|two|\d+)\s+(?:рисков|risk)/,
  );
  if (minRisk)
    q.minRiskCount = /два|две|two/.test(minRisk[1]) ? 2 : +minRisk[1];
  if (/най-много рискови|most risk/.test(s)) {
    q.metric = "riskCount";
    q.operation = "list";
    delete q.groupBy;
  }
  if (/брой рисков|risk count/.test(s)) q.metric = "riskCount";
  if (/\bcri\b|индекс на риск/.test(s)) q.metric = "cri";
  if (
    /обжалван|обжалване|appealed/.test(s) &&
    !["appeals", "decisions"].includes(String(q.corpus))
  )
    q.metric = "appealed";
  if (/уважен|upheld|успешн/.test(s) && !s.includes("upheld appeal risk")) {
    q.metric = "upheld";
    if (q.operation === "share" && q.corpus === "appeals")
      q.denominator = "merits";
  }
  if (/спрян|спрени|suspended/.test(s)) q.metric = "suspended";
  if (
    /изцяло уважен|напълно успешн|fully successful|fully upheld|частично|partially/.test(
      s,
    )
  )
    return fail(
      "Данните не разграничават надеждно пълен от частичен успех по жалбоподател.",
      "The data cannot reliably distinguish full from partial success per complainant.",
      "unsupported",
    );
  const predicates: string[] = adding
    ? [...((q.numeratorPredicates as string[]) || [])]
    : [];
  for (const [id, pattern] of [
    [
      "oneBid",
      /1\s+(?:участни|оферт|bid)|един участник|една оферта|one bidder|one bid|single.bid/,
    ],
    ["appealed", /обжалван[а-я]*|обжалване|appealed/],
    ["upheld", /уважен[а-я]*|upheld|успешн[а-я]*/],
    ["suspended", /спрян[а-я]*|спрени|suspended/],
  ] as const) {
    const match = s.match(pattern);
    if (match && (id !== "oneBid" || one)) {
      const preceding = s.slice(Math.max(0, match.index! - 20), match.index);
      predicates.push(
        (/(?:без|не|not|without)\s*$/.test(preceding) ? "!" : "") + id,
      );
    }
  }
  for (const [id, pattern] of Object.entries(PROCUREMENT_RISK_ALIASES))
    if (pattern.test(s)) {
      if (id === "shortTenderPeriod" && q.corpus === "tenders") continue;
      if (id === "rushedDeadline" && q.corpus !== "tenders") continue;
      if (
        id === "amendment" &&
        /annex growth|ръст.*анекс|увеличен.*анекс/.test(s)
      )
        continue;
      const match = s.match(pattern)!;
      const preceding = s.slice(Math.max(0, match.index! - 12), match.index);
      predicates.push(
        (/(?:без|not|without)\s*$/.test(preceding) ? "!" : "") + "risk:" + id,
      );
    }
  if (predicates.length) {
    q.numeratorPredicates = predicates;
    if (predicates.some((p) => p.includes("risk:"))) {
      q.metric = "risk";
      if (q.operation === "sum") q.operation = "summary";
    }
    q.numeratorMode = /\sили\s|\sor\s/.test(s) ? "any" : "all";
  }
  if (/нямат.*връзка|няма.*връзка|unlinked/.test(s)) {
    q.metric = "records";
    q.numeratorPredicates = ["unlinked"];
  }
  if (
    /поискан.*временна|requested interim/.test(s) &&
    !/спрян|suspended/.test(s)
  ) {
    q.metric = "records";
    q.numeratorPredicates = ["interimRequested"];
  }
  if (/известни.*(?:участници|оферти)|known.*(?:bids|bidders)/.test(s))
    q.denominator = "positiveKnown";
  if (/оценим|evaluable/.test(s)) q.denominator = "evaluable";
  if (/всички|of all/.test(s)) q.denominator = "all";
  if (/отменен|отменени|прекратен|cancelled/.test(s)) q.status = "cancelled";
  if (/неотменен|not cancelled/.test(s)) q.status = "notCancelled";
  if (/активни|отворени|open now|open tenders/.test(s)) {
    q.status = "open";
    q.asOf = now.toISOString();
  }
  if (/приключили|closed tenders/.test(s)) {
    q.status = "closed";
    q.asOf = now.toISOString();
  }
  if (/еврофинанс|европейско финансиране|eu.funded/.test(s))
    q.funding = /без.*(?:евро|eu)|(?:not|non|without)[ -]+eu/.test(s)
      ? "notEu"
      : "eu";
  if (/рамков|framework/.test(s))
    q.framework = /без.*рамков|нерамков|(?:not|non|without)[ -]+framework/.test(
      s,
    )
      ? "no"
      : "yes";
  const cpvs = [...s.matchAll(/(?:cpv|цпв)\s*(\d{2,8})(?:-\d)?/g)].map(
    (m) => m[1],
  );
  if (cpvs.length) q.cpvPrefixes = cpvs;
  const subjectText = s.match(
    /(?:договори(?:те)?|contracts|търгове|tenders)\s+(?:за|for)\s+(.+?)(?=\s+(?:през|from|in)\s+|$)/,
  )?.[1];
  if (
    subjectText &&
    !/^(?:20\d{2}|\d+[./]|миналата|тази|this|last)/.test(subjectText)
  )
    q.keyword = subjectText;
  const topic = detectTopic(s);
  if (topic) {
    q.topic = topic.slug;
    delete q.keyword;
  }
  if (
    /на апи|агенция.*пътна инфраструктура|\bapi\b|road infrastructure agency/.test(
      s,
    )
  )
    q.buyerIds = ["000695089"];
  if (/мз\s*(?:и|\+)\s*нзок/.test(s)) q.buyerSectors = ["nzok"];
  else if (/\bнзок\b|nzok/.test(s)) q.buyerIds = ["121858220"];
  else if (/министерство на здравеопазването|мз(?:\s|$)/.test(s))
    q.buyerIds = ["000695317"];
  const identities = [...s.matchAll(/(?:еик|eik)\s*(\d{9,13})/g)].map(
    (m) => m[1],
  );
  if (identities.length)
    q[
      /изпълнител|supplier|contractor|фирма/.test(s)
        ? "supplierIds"
        : "buyerIds"
    ] = identities;
  if (/пътищ|пътни|roads?|roadworks/.test(s) && !topic)
    q.subjectSectors = [/ремонт|repair/.test(s) ? "roadRepair" : "roads"];
  if (/медицинско оборудване|medical equipment/.test(s))
    q.subjectSectors = ["medicalEquipment"];
  else if (/медицински услуги|health services/.test(s))
    q.subjectSectors = ["healthServices"];
  else if (/медицински (?:стоки|продукти)|medical goods/.test(s))
    q.subjectSectors = ["medicalGoods"];
  const sectorIds = Object.entries(PROCUREMENT_BUYER_SECTORS)
    .filter(([id, sector]) => {
      if (["roads", "nzok"].includes(id))
        return new RegExp(
          `(?:buyer sector|сектор възложители)\\s+${id}(?:\\s|$)`,
          "i",
        ).test(s);
      return [
        id,
        sector.label.bg.split("(")[0].trim().toLowerCase(),
        sector.label.en.split("(")[0].trim().toLowerCase(),
      ].some(
        (name) => s.includes("сектор " + name) || s.includes("sector " + name),
      );
    })
    .map(([id]) => id);
  if (sectorIds.length) q.buyerSectors = sectorIds;
  if (
    !q.buyerIds &&
    !q.supplierIds &&
    !/на КЗК|на АОП/.test(original) &&
    /(?:на|by)\s+[А-ЯA-Z][\p{L}-]+/u.test(original) &&
    !q.buyerSectors &&
    !q.subjectSectors
  )
    return fail(
      "Посочете ЕИК на организацията, за да запазим точния обхват.",
      "Specify the organization's EIK to preserve its exact scope.",
    );
  if (
    /(?:община|municipality|near|край)\s+\p{L}+|(?:в|in)\s+(?:София|Пловдив|Варна|Бургас)/iu.test(
      original,
    )
  )
    return fail(
      "Уточнете възложителя с ЕИК. Местоположение на изпълнението не е потвърдено.",
      "Specify the buyer EIK. Place of execution is not verified.",
    );
  if (q.subjectSectors) delete q.keyword;
  const healthAmbiguity =
    /здравеопазван|healthcare|health care/.test(s) &&
    !q.buyerSectors &&
    !q.buyerIds &&
    !q.subjectSectors &&
    !q.cpvPrefixes;
  const relatedYear = s.match(
    /(?:жалб[^.]*?подадени|complaints? filed)\s+(?:през|in)\s+(20\d{2})/,
  );
  if (relatedYear && ["contracts", "tenders"].includes(String(q.corpus))) {
    q.relatedCorpus = "appeals";
    q.relatedFrom = date(+relatedYear[1]);
    q.relatedToExclusive = date(+relatedYear[1] + 1);
    s = s.replace(relatedYear[0], "");
  }
  // Parse complete periods before isolated years so cross-year month spans stay intact.
  const dayPattern = "(\\d{1,2})[.](\\d{1,2})[.](20\\d{2})";
  const dayRange = s.match(
    new RegExp(dayPattern + "\\s*(?:до|to|–|—|-)\\s*" + dayPattern),
  );
  const monthRange = s.match(
    /(\d{1,2})\/(20\d{2})\s*(?:до|to|–|—|-)\s*(\d{1,2})\/(20\d{2})/,
  );
  const compare = s.match(
    /(?:сравни|compare).*?(20\d{2})\s*(?:и|and|с|with|to|vs\.?)\s*(20\d{2})/,
  );
  const yearRange = s.match(
    /(?:от|from|between)\s+(20\d{2})\s*(?:до|to|and|–|-)\s*(20\d{2})/,
  );
  const quarter = s.match(
    /(?:q([1-4])|([1-4])(?:-?о)? тримесечие|(?:първо|второ|трето|четвърто) тримесечие)\s*(20\d{2})/,
  );
  const setPeriod = (from?: string, to?: string) => {
    delete q.from;
    delete q.toExclusive;
    if (from) q.from = from;
    if (to) q.toExclusive = to;
  };
  try {
    if (compare) {
      q.operation = "compare";
      setPeriod(date(+compare[1]), date(+compare[1] + 1));
      q.compareFrom = date(+compare[2]);
      q.compareToExclusive = date(+compare[2] + 1);
    } else if (yearRange) {
      setPeriod(date(+yearRange[1]), date(+yearRange[2] + 1));
    } else if (dayRange) {
      const start = date(+dayRange[3], +dayRange[2], +dayRange[1]),
        end = date(+dayRange[6], +dayRange[5], +dayRange[4]);
      if (new Date(end + "T00:00:00Z").toISOString().slice(0, 10) !== end)
        throw Error();
      setPeriod(start, nextDay(end));
    } else if (monthRange) {
      if (
        +monthRange[1] < 1 ||
        +monthRange[1] > 12 ||
        +monthRange[3] < 1 ||
        +monthRange[3] > 12
      )
        throw Error();
      setPeriod(
        date(+monthRange[2], +monthRange[1]),
        +monthRange[3] === 12
          ? date(+monthRange[4] + 1)
          : date(+monthRange[4], +monthRange[3] + 1),
      );
    } else if (quarter) {
      const n = +(
        quarter[1] ||
        quarter[2] ||
        (/първо/.test(quarter[0])
          ? "1"
          : /второ/.test(quarter[0])
            ? "2"
            : /трето/.test(quarter[0])
              ? "3"
              : "4")
      );
      setPeriod(
        date(+quarter[3], (n - 1) * 3 + 1),
        n === 4 ? date(+quarter[3] + 1) : date(+quarter[3], n * 3 + 1),
      );
    } else if (/миналата година|last year/.test(s))
      setPeriod(date(year - 1), date(year));
    else if (/тази година|this year/.test(s))
      setPeriod(date(year), date(year + 1));
    else if (/последните 12 месеца|last 12 months/.test(s)) {
      const start = new Date(today + "T00:00:00Z");
      start.setUTCFullYear(start.getUTCFullYear() - 1);
      setPeriod(start.toISOString().slice(0, 10), nextDay(today));
    } else {
      const month = s.match(/(\d{1,2})\/(20\d{2})/),
        day = s.match(new RegExp(dayPattern));
      if (day) {
        const d = date(+day[3], +day[2], +day[1]);
        if (new Date(d + "T00:00:00Z").toISOString().slice(0, 10) !== d)
          throw Error();
        setPeriod(d, nextDay(d));
      } else if (month) {
        const m = +month[1],
          y = +month[2];
        if (m < 1 || m > 12) throw Error();
        const upper = m === 12 ? date(y + 1) : date(y, m + 1);
        setPeriod(
          /(?:до|until|through)\s+\d/.test(s) ? undefined : date(y, m),
          /(?:от|from)\s+\d/.test(s) ? undefined : upper,
        );
      } else {
        const years = [...s.matchAll(/\b(20\d{2})\b/g)].map((m) => m[1]);
        if (new Set(years).size > 1)
          return fail(
            "Уточнете дали годините са диапазон или сравнение.",
            "Specify whether the years form a range or comparison.",
          );
        if (years.length) setPeriod(date(+years[0]), date(+years[0] + 1));
      }
    }
  } catch {
    return fail(
      "Невалидна календарна дата или период.",
      "Invalid calendar date or period.",
    );
  }
  if (
    ["contracts", "tenders"].includes(String(q.corpus)) &&
    /обжалвани\s+през|appealed\s+in/.test(s) &&
    q.from
  ) {
    q.relatedCorpus = "appeals";
    q.relatedFrom = q.from;
    q.relatedToExclusive = q.toExclusive;
    delete q.from;
    delete q.toExclusive;
  }
  if (/за този парламент|this parliament/.test(s))
    return fail(
      "Посочете начална и крайна дата за парламентарния период.",
      "Specify the start and end dates of the parliamentary period.",
    );
  if (/махни.*период|clear.*period|всички години|all years/.test(s))
    setPeriod();
  if (/махни.*сектор|clear.*sector/.test(s)) {
    delete q.buyerSectors;
    delete q.subjectSectors;
  }
  const amount = s.match(
    /(над|повече от|over|above|под|по-малко от|below|under|поне|at least|най-много|at most)\s+(\d+(?:[.,]\d+)?)\s*(млн|милиона|million|хил|thousand)?\s*(евро|eur|€|лв|bgn)/,
  );
  if (amount) {
    const value =
      +amount[2].replace(",", ".") *
      (/млн|милиона|million/.test(amount[3] || "")
        ? 1e6
        : /хил|thousand/.test(amount[3] || "")
          ? 1e3
          : 1);
    const upper = /под|по-малко от|below|under|най-много|at most/.test(
      amount[1],
    );
    q[upper ? "amountMax" : "amountMin"] = value;
    q[upper ? "amountMaxRelation" : "amountMinRelation"] =
      /поне|at least|най-много|at most/.test(amount[1])
        ? upper
          ? "lte"
          : "gte"
        : upper
          ? "lt"
          : "gt";
    q.currency = /лв|bgn/.test(amount[4]) ? "BGN" : "EUR";
  }
  if (/(?:за|about|subject)\s+[„“"].+[“”"]/.test(s)) {
    const keyword = s.match(/[„“"]([^“”"]+)[“”"]/);
    if (keyword) q.keyword = keyword[1];
  }
  if (
    /(?:сектор|sector)\s+/.test(s) &&
    !q.buyerSectors &&
    !q.subjectSectors &&
    !healthAmbiguity
  )
    return fail(
      "Секторът не е разпознат. Посочете CPV код или възложител с ЕИК.",
      "Sector not recognized. Specify a CPV code or a buyer EIK.",
    );
  if (
    /(?:фирма|компания|company|supplier|възложител|buyer)\s+[„“"].+[“”"]/.test(
      s,
    ) &&
    !identities.length
  )
    return fail(
      "Посочете ЕИК, за да различим едноименните организации.",
      "Specify an EIK to distinguish organizations with the same name.",
    );
  if (
    /\b[2-9]\s+(?:участник|оферт|bidders|bids)/.test(s) &&
    q.operation === "share"
  )
    return fail(
      "За процент уточнете подкрепяния показател „един участник“. Брой участници може да се използва в списък.",
      "For shares, the supported bidder metric is “one bidder”. A bidder count can filter a list.",
      "unsupported",
    );
  const bidders = bidderPhrase;
  if (bidders && !one) {
    delete q.bidderMin;
    delete q.bidderMax;
    const op = bidders[1] || "equal",
      n = +bidders[2];
    if (!/най-много|at most|под|fewer than/.test(op))
      q.bidderMin = n + (/над|more than/.test(op) ? 1 : 0);
    if (!/поне|at least|над|more than/.test(op))
      q.bidderMax = n - (/под|fewer than/.test(op) ? 1 : 0);
  }
  if (q.operation !== "compare") {
    delete q.compareFrom;
    delete q.compareToExclusive;
  }
  if (q.operation === "list") delete q.groupBy;
  if (q.operation === "compare" && !q.compareFrom && follow) {
    const y = s.match(/20\d{2}/)?.[0];
    if (y) {
      q.from = options.previous!.from;
      q.toExclusive = options.previous!.toExclusive;
      q.compareFrom = date(+y);
      q.compareToExclusive = date(+y + 1);
    }
  }
  if (q.operation === "share" && !q.metric && !q.numeratorPredicates)
    return fail(
      "Уточнете какво измерва процентът: един участник, риск или обжалване.",
      "Specify the share: one bidder, a risk indicator or appeals.",
    );
  if (healthAmbiguity) {
    const choices = [
      {
        label: {
          bg: "Възложители МЗ + НЗОК",
          en: "Health ministry + NHIF buyers",
        },
        patch: { buyerSectors: ["nzok"] },
      },
      {
        label: {
          bg: "Медицински стоки и здравни услуги (CPV 33/851)",
          en: "Medical goods and health services (CPV 33/851)",
        },
        patch: { subjectSectors: ["medicalGoods", "healthServices"] },
      },
    ];
    return {
      kind: "clarification",
      message: {
        bg: "„Здравеопазване“ означава възложители или предмет на покупката?",
        en: "Does “healthcare” refer to buyers or the subject purchased?",
      },
      options: choices.flatMap((choice) => {
        const parsed = validateProcurementQuery({ ...q, ...choice.patch });
        return parsed.ok ? [{ label: choice.label, query: parsed.query }] : [];
      }),
    };
  }
  if (
    /каква е разликата|какво означава|източниците|показатели.*проверени|what is the difference|methodology|методологи/.test(
      s,
    )
  ) {
    q.operation = "methodology";
    if (q.metric === "risk" && !q.numeratorPredicates) q.metric = "records";
  }
  const parsed = validateProcurementQuery(q);
  return parsed.ok
    ? { kind: "query", query: parsed.query }
    : fail(
        "Тази комбинация изисква уточнение: " +
          Object.keys(parsed.errors).join(", "),
        "This combination needs clarification: " +
          Object.keys(parsed.errors).join(", "),
      );
}
