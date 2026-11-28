// Parse one Комисия по досиетата decision (its full text, D3) into the decision
// header and the persons it announces. Pure — no I/O — so every rule below is
// unit-tested.
//
// The document layout has not changed since 2007: each announced person is a
// block opening with „Три имена", followed by labelled fields, and the decision
// ends with the Commission's signature block („Председател:").
//
// What is deliberately NOT extracted (plan §4):
//   - the recruiting / handling officer's NAME — a third party who was not the
//     subject of the decision. Only the recruitment YEAR is kept;
//   - anything about the deceased: the Commission COUNTS them („на N лица, данните
//     за които не подлежат на публикуване") and publishes nothing else, and only
//     the count is read.
// A decision lists ESTABLISHED affiliation only — the people checked with no
// finding are never named in it — so every block here is a finding.
//
// ⚠ JS `\b` is ASCII-only and never matches next to a Cyrillic letter. Every
// word boundary below is a `u`-flag lookaround over `\p{L}\p{N}` instead.

/** The category a person's „Качеството" names, in the plan's priority order. */
export type DsCategory =
  | "staff"
  | "resident"
  | "safehouse"
  | "informer"
  | "trusted"
  | "agent"
  | "collab";

/** Which part of the decision a block sits in. */
export type DsSection =
  /** „установява и обявява принадлежност" — a new finding. */
  | "establish"
  /** чл. 29, ал. 6 — affiliation already announced by an earlier decision. */
  | "already"
  /** чл. 28 — only further documents found for an already-announced person. */
  | "newdocs";

export interface DsPerson {
  name: string;
  section: DsSection;
  /** ISO date, or null when the block prints none. */
  birthDate: string | null;
  birthPlace: string | null;
  /** The „Качеството" text as printed (capped). */
  qualityRaw: string;
  categories: DsCategory[];
  pseudonyms: string | null;
  structures: string | null;
  /** Year of the FIRST recruitment date in the recruiter field; the officer's name
   *  is never kept. */
  recruitYear: number | null;
  /** „… след 10.11.1989" — the Commission holds data on activity after the fall. */
  afterNov1989: boolean;
  /** The public office / activity that brought the person under check (capped). */
  office: string;
  /** The nominating party of a candidate („издигнат от …"). */
  party: string | null;
  /** The МИР number of a parliamentary candidate. */
  mir: string | null;
  /** For a re-disclosure: the earlier decision numbers it cites. */
  priorDecisions: string[];
}

export interface DsDecisionText {
  /** „общо N лица" — the people the requesting body submitted. */
  total: number | null;
  /** „Проверени са M лица". */
  checked: number | null;
  /** Deceased people with a finding, counted and not published. */
  deceased: number;
  persons: DsPerson[];
}

const WB = "(?<![\\p{L}\\p{N}])";
const WE = "(?![\\p{L}\\p{N}])";

const CATEGORIES: [DsCategory, RegExp][] = [
  ["staff", /щатен служител|кадров|разузнавач/iu],
  ["resident", /резидент/iu],
  [
    "safehouse",
    new RegExp(
      `явочна квартира|${WB}явка${WE}|${WB}ЯК${WE}|квартиродател|конспиративна квартира`,
      "iu",
    ),
  ],
  ["informer", /осведомител|информатор/iu],
  ["trusted", new RegExp(`доверено лице|${WB}ДЛ${WE}`, "iu")],
  ["agent", new RegExp(`${WB}агент`, "iu")],
  ["collab", /сътрудник|нещатен/iu],
];

const SECTIONS: [DsSection, RegExp][] = [
  ["already", /за ко(?:ито|ето) вече е обявена принадлежност/giu],
  ["newdocs", /налични и други документи/giu],
  ["establish", /установява и обявява принадлежност/giu],
];

const digits = (s: string | undefined): number | null => {
  const d = (s ?? "").replace(/\D/g, "");
  return d ? Number(d) : null;
};

const squash = (s: string): string => s.replace(/\s+/g, " ");

const iso = (d: string, m: string, y: string): string =>
  `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

/** Normalise converter output and drop the signature block. */
export const cleanDecisionText = (raw: string): string =>
  raw
    .replace(/\r/g, "\n")
    .replace(/\f/g, "\n")
    .replace(/\u00a0/g, " ")
    .split(/\n\s*Председател\s*:/)[0];

/** The category set of one block: from its „Качеството" text, else the first
 *  match in the block's opening (older decisions print the quality unlabelled). */
export const categoriesOf = (quality: string, flat: string): DsCategory[] => {
  const own = CATEGORIES.filter(([, rx]) => rx.test(quality)).map(([c]) => c);
  if (own.length) return own;
  const head = flat.slice(0, 900);
  const first = CATEGORIES.find(([, rx]) => rx.test(head));
  return first ? [first[0]] : [];
};

type LabelKind =
  | "dob"
  | "pob"
  | "recruiter"
  | "handler"
  | "structures"
  | "quality"
  | "pseudonyms"
  | "docs"
  | "office"
  | "prior"
  | "candidacy"
  | "stop";

/** Every label a block carries, as the documents print them (measured over the
 *  whole corpus), plus the decision-level phrases that END a block's last field.
 *
 *  A value is the text between its label and the NEXT label of ANY kind. That is
 *  the whole point of the table: a per-field regex with its own stop list let an
 *  EMPTY „Място на раждане" swallow the following „Вербувал го служител <name>"
 *  line, i.e. publish a recruiting officer — a third party — as a birth place
 *  (29 rows). Here the recruiter segment exists only to be skipped. */
const LABELS: [LabelKind, string][] = [
  ["dob", "Дата на раждане"],
  ["pob", "Място на раждане"],
  ["recruiter", "Вербувал[аи]? (?:го|я) служител(?:и)?"],
  ["handler", "Ръководил[аи]? (?:го|я) служител(?:и)?"],
  // Older decisions name the case officers in a free „Оперативни работници: …"
  // line instead — the same third parties, the same rule.
  ["handler", "Оперативн(?:и|ия|ият)? работни(?:к|ци)"],
  [
    "structures",
    "Структури(?:,? в които е (?:осъществявано(?: сътрудничеството)?|работил[а]?))?",
  ],
  [
    "quality",
    "Качество(?:то)?(?:,? в което е (?:осъществявано(?: сътрудничеството)?)?)?",
  ],
  ["pseudonyms", "Псевдоними?"],
  [
    "docs",
    "Документи,? (?:въз основа на които е(?: установена принадлежността)?|свързани с кариерното(?: му развитие)?)",
  ],
  ["docs", "Архивни документи(?: за принадлежност)?"],
  ["docs", "Данни в наличните документи"],
  ["docs", "Документи? за получени?(?:о|те)?"],
  ["docs", "Снемане от действащия оперативен(?: отчет)?"],
  ["docs", "Резултат от проверката"],
  ["office", "Публична длъжност(?: или публична дейност)?"],
  ["office", "Ново публично качество(?: по чл\\. 26, ал\\. 1 от Закона)?"],
  ["prior", "Решение за установяване и обявяване(?: на принадлежност)?"],
  ["candidacy", "Кандидат(?: за)?(?=\\s)"],
  [
    "stop",
    "Комисията|На основание|Установява|Обяв(?:ен|ена|ява|яван)|Освен това|не е установена принадлежност|Доклад|Забележка",
  ],
];

/** textutil flattens the two-column field tables ROW-INTERLEAVED, so a label that
 *  wraps onto a second line lands INSIDE the value beside it: „Структури, в които е
 *  осъществявано ОУ на МВР-Бургас-ДС, отдел II, сътрудничеството отделение К/Р".
 *  These are the wrapped tails of the labels above; they are removed from every
 *  stored value. */
const LABEL_TAILS =
  /(?<![\p{L}\p{N}])(?:сътрудничеството|въз основа на които е|установена принадлежността към|органите по чл\. 1(?: от Закона)?|свързани с кариерното|му развитие)(?![\p{L}\p{N}])/gu;

const clean = (v: string | null): string | null => {
  if (v == null) return null;
  const out = v
    .replace(LABEL_TAILS, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "");
  return out || null;
};

const LABEL_RX = new RegExp(
  `(?<=^|\\s)(?:${LABELS.map(([, rx], i) => `(?<l${i}>${rx})`).join("|")})\\s*:?\\s*`,
  "gu",
);

interface Segment {
  kind: LabelKind;
  label: string;
  value: string;
}

/** Split one flattened block into labelled segments, in document order. */
export const segmentBlock = (flat: string): Segment[] => {
  const hits = [...flat.matchAll(LABEL_RX)].map((m) => {
    const i = Number(
      Object.entries(m.groups ?? {})
        .find(([, v]) => v !== undefined)![0]
        .slice(1),
    );
    return {
      kind: LABELS[i][0],
      label: m.groups![`l${i}`],
      at: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    };
  });
  return hits.map((h, i) => ({
    kind: h.kind,
    label: h.label,
    value: flat.slice(h.end, hits[i + 1]?.at ?? flat.length).trim(),
  }));
};

const first = (segs: Segment[], kind: LabelKind): string | null =>
  clean(segs.find((s) => s.kind === kind && s.value)?.value ?? null);

const PARTY_RX =
  /издигнат[а]? от\s+(.+?)(?=\s+в\s+\d|\s+Кандидат|\s+и при условията|\s+Забележка|\s+Доклад|\s+Документи|\s+Архивни|\s+Решение|\s+За\s+\p{Lu}\p{Ll}+\s+\p{Lu}|;|$)/u;

/** The 2007-2008 candidate decisions print a reference column — „Решение № 19 /
 *  23.11. 2007 г." plus a row number — that textutil interleaves into the middle of
 *  whichever field sits beside it, splitting a recruitment date or a party name. */
const REFERENCE_COLUMN =
  /Решение № \d+ ?\/ ?\d{1,2}\.\d{1,2}\. ?\d{4} г\.(?: \d{1,4}(?= ))?/g;

const parseBlock = (block: string, section: DsSection): DsPerson => {
  const flat = squash(block.replace(REFERENCE_COLUMN, " "));
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const name = squash(
    lines[0].slice("Три имена".length).trim() || lines[1] || "",
  )
    .trim()
    .replace(/^[\s:]+|[\s:]+$/g, "");

  const segs = segmentBlock(flat);
  const sec: DsSection = segs.some((s) => s.kind === "prior")
    ? "already"
    : section;

  const dob = first(segs, "dob")?.match(
    /^(\d{1,2})[.\s/]+(\d{1,2})[.\s/]+(\d{4})/,
  );
  // „секретен сътрудник –" is the generic prefix every collaborator carries,
  // not a category of its own.
  const quality = (first(segs, "quality") ?? "")
    .replace(/^[-–]\s*/, "")
    .replace(/[-–]?\s*секретен(?:\s*сътрудник)?\s*[-–]?\s*/giu, " ")
    // a row number from the interleaved reference column
    .replace(/(?<![\p{L}\p{N}])\d{1,4}(?![\p{L}\p{N}])/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // The recruiter segment is read for its YEAR and then discarded — the
  // officer is a third party (plan §4 rule 4).
  const recruitYear = first(segs, "recruiter")?.match(
    /(?:на|от)\s+\d{1,2}\.\d{1,2}\.(19\d\d)/,
  )?.[1];
  const candidacies = segs
    .filter((s) => s.kind === "candidacy" && s.value)
    .map((s) => `Кандидат за ${s.value}`);
  const office = first(segs, "office") || candidacies.join(" | ");
  // Some candidate rows print „Кандидат общ. съветник …" with no label at all,
  // so the flat block is the last place the nominating party is looked for.
  const party = [...candidacies, office, flat]
    .map((c) => c.match(PARTY_RX)?.[1])
    .find(Boolean)
    ?.replace(/\s+/g, " ")
    .replace(/^[\s,.]+|[\s,.]+$/g, "");

  return {
    name,
    section: sec,
    birthDate: dob ? iso(dob[1], dob[2], dob[3]) : null,
    birthPlace: first(segs, "pob"),
    qualityRaw: quality.slice(0, 120),
    categories: categoriesOf(quality, flat),
    pseudonyms: first(segs, "pseudonyms")?.slice(0, 100) ?? null,
    structures: first(segs, "structures")?.slice(0, 200) ?? null,
    recruitYear: recruitYear ? Number(recruitYear) : null,
    afterNov1989: flat.includes("след 10.11.1989"),
    office: office.slice(0, 600),
    party: party || null,
    mir: flat.match(/(\d{1,2})\s*МИР\s*[-–]\s*[А-Яа-я\- ]+?,/)?.[1] ?? null,
    priorDecisions:
      sec === "already"
        ? [...flat.matchAll(/решение № ([\d-]+а?)\//giu)].map((m) => m[1])
        : [],
  };
};

/**
 * „Проверени са M лица", summed over EVERY occurrence in the text.
 *
 * Most decisions state it once, in the header. Six (media and NGO sweeps, e.g.
 * one per newspaper publisher) check several bodies in one decision and repeat
 * the phrase per body with no overall „общо" line — reading only the first
 * dropped 1,536 checks across those six (310: 3 instead of 631). Measured over
 * all 1,933 texts: those six are the ONLY ones with more than one occurrence,
 * so summing changes no single-block decision.
 */
const checkedCount = (t: string): number | null => {
  const ms = [...t.matchAll(/[Пп]роверени\s+(?:са\s+)?([\d ]{1,9})\s*лица/g)]
    .map((m) => digits(m[1]))
    .filter((n): n is number => n !== null);
  return ms.length ? ms.reduce((a, b) => a + b, 0) : null;
};

/** One decision's full text → its header counts and announced persons. */
export const parseDecisionText = (raw: string): DsDecisionText => {
  const t = cleanDecisionText(raw);
  const head = t.slice(0, 4000);

  const marks = SECTIONS.flatMap(([k, rx]) =>
    [...t.matchAll(rx)].map((m) => ({ at: m.index ?? 0, k })),
  ).sort((a, b) => a.at - b.at);

  const starts = [...t.matchAll(/Три имена/g)].map((m) => m.index ?? 0);
  const persons = starts.map((a, i) => {
    let section: DsSection = "establish";
    for (const m of marks) if (m.at < a) section = m.k;
    return parseBlock(t.slice(a, starts[i + 1] ?? t.length), section);
  });

  const deceased = [
    ...squash(t).matchAll(
      /на\s+(\d[\d ]*)\s*\/[^/]{1,30}\/\s*лиц[ае],\s*данните за ко[ие]то не подлежат на публикуване/g,
    ),
  ].reduce((n, m) => n + (digits(m[1]) ?? 0), 0);

  return {
    total: digits(head.match(/общо\s+([\d ]{1,9})\s*лица/)?.[1]),
    checked: checkedCount(t),
    deceased,
    persons,
  };
};
