import { matchRollcallTemplate } from "../../src/lib/questions/contracts/rollcall";
import {
  validateRollcallQuery,
  ROLLCALL_TOPICS,
  type RollcallArgs,
  type RollcallCorpus,
  type RollcallQuery,
} from "../../src/lib/rollcallQuery";
import { isQueryDate } from "../../src/lib/queryDates";
import { latinSkeleton as foldSearch } from "../../src/lib/translitSearch";
export type RollcallCatalog = {
  councils?: {
    id: string;
    name: string;
    frontend_ids?: string[];
    year_only?: boolean;
    named?: number;
  }[];
};
export type RollcallUnderstanding =
  | { kind: "none" }
  | {
      kind: "scope";
      draft: RollcallArgs;
      names: string[];
      needs?: "council" | "dates" | "scope" | "record";
      message?: string;
    };
const excluded = (question: string) =>
  /избор|election|преференц|preferential|съдеб|judicial|колко места|how many seats|състав|composition/i.test(
    question.replace(/изборн(?:ия|ият|и) кодекс|election code/gi, ""),
  );
export function rollcallCorpus(question: string): RollcallCorpus | null {
  const template = matchRollcallTemplate(question);
  if (template) return template.draft.corpus;
  const explicitBody =
    /парламент|народно.*събрание|общинск.*съвет|съветник|parliament|assembly|council/i.test(
      question,
    );
  if (
    !explicitBody &&
    /(?:\b(?:town|city|village|municipality|province|neighbou?rhoods?|turnout|presidential|runoff)\b|гр\.|с\.\s|община|област|квартал|ромск|\bRoma\b|президент|балотаж|под прага|votes come from|от кои партии идват|къде отидоха гласовете)/i.test(
      question,
    )
  )
    return null;
  if (
    /^(?:What were the most contested votes|Кои са най-оспорваните гласувания)\??$/i.test(
      question,
    )
  )
    return null;
  if (
    excluded(question) ||
    /присъстви|отсъств|attendance|absent|най-рядко|участват най-рядко/i.test(
      question,
    ) ||
    /received votes|получи.*гласов|партии.*гласов|parties.*votes/i.test(
      question,
    ) ||
    /прахос|wasted|диаспор|diaspora|out-of-country|council vote.*(?:cycles|changed)|parliamentary votes go|transition model|how does .+ vote in parliament|секция\s+\d|section\s+\d|най-единно|cohesiv|моята община|^кой гласува за |^who votes for /i.test(
      question,
    ) ||
    (/машин|machine/i.test(question) &&
      !/парламент|закон|parliament|legislat/i.test(question)) ||
    /^(?:Как гласува парламентът за бюджета|How did parliament vote on the budget)\??$/i.test(
      question,
    ) ||
    /votes? did .+ get|гласове.*получи|гласува като|votes? like|voting profile|профил.*гласув/i.test(
      question,
    ) ||
    /^Как гласува [А-Я][а-я]+(?: [А-Я][а-я]+){1,2} в парламента\??$/iu.test(
      question,
    )
  )
    return null;
  if (
    !/гласува|гласуван|гласов|гласа\s+на|решени|поимен|заседани|votes?|votings?|roll.call|resolutions?|sittings?|sessions?|покритие|coverage|which periods|which municipalities|кои периоди|кои общини/i.test(
      question,
    )
  )
    return null;
  const council = /общинск|съветник|council|councillor/i.test(question);
  if (
    !council &&
    !/парламент|народно.*събрание|\bНС\b|parliament|assembly|гласува|гласуван|гласов|гласа\s+на|\bvotes?\b|sittings?/i.test(
      question,
    )
  )
    return null;
  const session = /заседани|sittings?|sessions?/i.test(question);
  const person =
    !/как гласува (?:парламент|общинск|съвет(?:ът)?(?:\s|$))|how did (?:the )?(?:parliament|council) vote/i.test(
      question,
    ) &&
    /(?:гласов.+|гласа\s+)на [А-Я]|колко често|how often|съветник|councillor|кой гласува|who voted|как гласува|how did .+ vote|гласувания на (?!парламента|народното)|[’']s.*votes|votes (?:of|by) /i.test(
      question,
    );
  return council
    ? session
      ? "councilSessions"
      : person
        ? "councilCasts"
        : "councilResolutions"
    : session
      ? "parliamentSessions"
      : person
        ? "parliamentCasts"
        : "parliamentVotes";
}
const dayAfter = (s: string) =>
  new Date(Date.parse(s + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
const monthStart = (year: number, month: number) =>
  new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
/** Capture dates independently of people and titles; all relative dates pin Sofia's date. */
export function rollcallDates(
  text: string,
  now = new Date(),
): {
  from?: string;
  toExclusive?: string;
  invalid?: boolean;
  matched: string[];
} {
  const matched: string[] = [];
  const endpoints = [
    ...text.matchAll(
      /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]20\d{2})\b/g,
    ),
  ];
  const dates = endpoints.map((m) => {
    const e = m[0].match(/^(\d{1,2})[/.](\d{1,2})[/.](20\d{2})$/);
    return e
      ? `${e[3]}-${e[2].padStart(2, "0")}-${e[1].padStart(2, "0")}`
      : m[0];
  });
  if (dates.length) {
    matched.push(...endpoints.map((m) => m[0]));
    if (
      dates.length > 2 ||
      dates.some((d) => !isQueryDate(d)) ||
      (dates.length === 2 && dates[0] > dates[1])
    )
      return { invalid: true, matched };
    return { from: dates[0], toExclusive: dayAfter(dates.at(-1)!), matched };
  }
  const monthNames = [
    "януари|january",
    "февруари|february",
    "март|march",
    "април|april",
    "май|may",
    "юни|june",
    "юли|july",
    "август|august",
    "септември|september",
    "октомври|october",
    "ноември|november",
    "декември|december",
  ];
  const named = [
    ...text.matchAll(
      new RegExp(`(?<![\\p{L}])(${monthNames.join("|")})(?![\\p{L}])`, "giu"),
    ),
  ];
  if (named.length) {
    const years = [...text.matchAll(/\b20\d{2}\b/g)];
    if (named.length > 2 || years.length !== 1)
      return { invalid: true, matched };
    const year = +years[0][0];
    const first =
        monthNames.findIndex((m) =>
          new RegExp(`^(?:${m})$`, "i").test(named[0][0]),
        ) + 1,
      last =
        monthNames.findIndex((m) =>
          new RegExp(`^(?:${m})$`, "i").test(named.at(-1)![0]),
        ) + 1;
    return {
      from: monthStart(year, first),
      toExclusive: monthStart(year, last + 1),
      invalid: first > last,
      matched: [...named.map((m) => m[0]), years[0][0]],
    };
  }
  const months = [...text.matchAll(/\b(\d{1,2})\/(20\d{2})\b/g)];
  if (months.length) {
    matched.push(...months.map((m) => m[0]));
    if (months.length > 2 || months.some((m) => +m[1] < 1 || +m[1] > 12))
      return { invalid: true, matched };
    const first = months[0],
      last = months.at(-1)!;
    const from = monthStart(+first[2], +first[1]),
      toExclusive = monthStart(+last[2], +last[1] + 1);
    return { from, toExclusive, invalid: from >= toExclusive, matched };
  }
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const y = +local.slice(0, 4),
    m = +local.slice(5, 7);
  const relative = text.match(
    /днес|today|миналия месец|last month|този месец|this month|миналата година|last year|тази година|this year|последните\s+\d+\s+дни|last\s+\d+\s+days/i,
  );
  if (relative) {
    matched.push(relative[0]);
    const t = relative[0];
    if (/дни|days/.test(t)) {
      const n = Number(t.match(/\d+/)?.[0]);
      if (!Number.isFinite(n) || n < 1 || n > 3660)
        return { invalid: true, matched };
      return {
        from: new Date(Date.parse(local + "T00:00:00Z") - (n - 1) * 86400000)
          .toISOString()
          .slice(0, 10),
        toExclusive: dayAfter(local),
        invalid: n < 1 || n > 3660,
        matched,
      };
    }
    if (/днес|today/i.test(t))
      return { from: local, toExclusive: dayAfter(local), matched };
    if (/месец|month/i.test(t)) {
      const month = m - (/минал|last/i.test(t) ? 1 : 0);
      return {
        from: monthStart(y, month),
        toExclusive: monthStart(y, month + 1),
        matched,
      };
    }
    const year = y - (/минал|last/i.test(t) ? 1 : 0);
    return { from: `${year}-01-01`, toExclusive: `${year + 1}-01-01`, matched };
  }
  const years = [...text.matchAll(/\b20\d{2}\b/g)].map((m) => m[0]);
  if (years.length === 1)
    return {
      from: years[0] + "-01-01",
      toExclusive: +years[0] + 1 + "-01-01",
      matched: years,
    };
  return { invalid: years.length > 1, matched };
}
export function understandRollcall(
  question: string,
  options: {
    catalog?: RollcallCatalog;
    previous?: RollcallQuery;
    now?: Date;
    corpus?: RollcallCorpus;
  } = {},
): RollcallUnderstanding {
  const corpus =
    options.corpus || rollcallCorpus(question) || options.previous?.corpus;
  if (!corpus || excluded(question)) return { kind: "none" };
  const template = matchRollcallTemplate(question);
  const q: RollcallArgs = { ...(options.previous || {}), corpus, offset: 0 };

  if (template) {
    Object.assign(q, template.draft);
    if (template.draft.topicIds) delete q.keyword;
    else if (template.draft.keyword) delete q.topicIds;
    if (template.missing)
      return {
        kind: "scope",
        draft: q,
        names: [],
        needs: template.missing as "scope" | "dates" | "record",
      };
    if (!template.municipality && !q.corpus.startsWith("council"))
      return { kind: "scope", draft: q, names: template.names };
    if (q.operation === "methodology")
      return { kind: "scope", draft: q, names: [] };
  }
  let text = question.replace(/[–—]/g, "-");
  const names: string[] = [];
  const reference = question.match(
    /\b\d{1,2}:\d{4}-\d{2}-\d{2}:\d+(?:::\d+)?\b/,
  );
  if (reference) {
    q.key = reference[0];
    q.operation = "detail";
    text = text.replace(reference[0], " ");
  }
  const comparison = question.match(
    /(?:сравни|compare).*?(20\d{2}).*?(20\d{2})/i,
  );
  if (comparison) {
    q.operation = "compare";
    q.from = comparison[1] + "-01-01";
    q.toExclusive = String(+comparison[1] + 1) + "-01-01";
    q.compareFrom = comparison[2] + "-01-01";
    q.compareToExclusive = String(+comparison[2] + 1) + "-01-01";
    text = text.replace(comparison[1], " ").replace(comparison[2], " ");
  }
  const date = rollcallDates(text, options.now);
  if (date.invalid) return { kind: "scope", draft: q, names, needs: "dates" };
  if (date.from) {
    q.from = date.from;
    q.toExclusive = date.toExclusive;
  }
  for (const m of date.matched) text = text.replace(m, " ");
  const n = text.match(/(?:последните|last|latest)\s+(\d+)/i);
  if (n) {
    q.latestN = Number(n[1]);
    text = text.replace(n[0], " ");
  }
  const assembly = text.match(
    /(?:assembly\s*|НС\s*)(\d{1,2})\b|\b(\d{1,2})(?:-?(?:ото|то|ро|во))?\s*(?:НС|народно събрание)/i,
  );
  if (assembly) {
    q.assemblyIds = [assembly[1] || assembly[2]];
    text = text.replace(assembly[0], " ");
  }
  if (corpus.startsWith("council")) {
    const foldWords = (s: string) => s.split(/\s+/).map(foldSearch).join(" ");
    const aliases = (c: { id: string; name: string }) => [
      c.name,
      c.name.replace(/^община\s+(?:град\s+)?/i, ""),
      ...(c.id === "SOF" ? ["София", "Sofia", "Столична община"] : []),
    ];
    const councils = (options.catalog?.councils || []).filter((c) =>
      aliases(c).some(
        (alias) =>
          (template?.municipality &&
            foldSearch(template.municipality) === foldSearch(alias)) ||
          new RegExp(`(?:^|\\s)${foldWords(alias)}(?:$|\\s|[.,?!])`).test(
            foldWords(text),
          ),
      ),
    );
    if (councils.length > 1) {
      delete q.councilIds;
      return { kind: "scope", draft: q, names, needs: "council" };
    }
    if (councils.length === 1) {
      q.councilIds = [councils[0].id];
      for (const alias of aliases(councils[0]))
        text = text.replace(new RegExp(alias, "ig"), " ");
    } else if (/(?:\sв\s|\sin\s)[\p{L}]/iu.test(text) && !q.assemblyIds) {
      delete q.councilIds;
    }
    if (!q.councilIds && !q.key && !q.parentQuery)
      return { kind: "scope", draft: q, names, needs: "council" };
  }
  const namePatterns = [
    /(?:гласов.+?|гласа\s+)на\s+(.+?)(?=\s+(?:през|от|по|за)(?:\s|$)|[?!.]|$)/i,
    /(?:колко често|how often)\s+(.+?)(?=\s+(?:гласуват|vote))/i,
    /(?:как гласува(?:ха)?\s+(?:съветникът\s+)?|how did\s+(?:councillor\s+)?)(.+?)(?=\s+(?:vote|по|за|в|през|от|on|in|from)(?:\s|$)|[?!.]|$)/i,
    /(?:гласувания(?:та)? на|votes (?:of|by))\s+(.+?)(?=\s+(?:по|за|в|през|от|on|in|from)(?:\s|$)|[?!.]|$)/i,
    /(?:what are\s+)?([A-ZА-Я][\p{L}-]+(?:\s+[A-ZА-Я][\p{L}-]+){1,2})[’']s/gu,
    /(?:на|of)\s+(.+?)(?=\s+(?:през|от|по|за|in|on|from)(?:\s|$)|[?!.]|$)/i,
  ];
  if (corpus.endsWith("Casts"))
    for (const re of namePatterns) {
      const match = text.match(re);
      if (match) {
        let name = match[1];
        if (!name && re.global) {
          name = match[0]
            .replace(/(?:what are\s+)?/i, "")
            .replace(/[’']s$/, "");
        }
        if (name && !/парламент|parliament|съвет|council/i.test(name)) {
          names.push(...name.trim().split(/\s+(?:и|and)\s+/i));
          text = text.replace(match[0], " ");
          break;
        }
      }
    }
  const topicIds = Object.entries(ROLLCALL_TOPICS)
    .filter(
      ([, t]) =>
        t.stems.some((s) => text.toLowerCase().includes(s)) ||
        new RegExp(t.en, "i").test(text),
    )
    .map(([id]) => id);
  if (topicIds.length) {
    q.topicIds = topicIds;
    delete q.keyword;
  }
  const quoted = text.match(/[„“"]([^„“"]{2,200})[“”"]/);
  if (quoted) q.keyword = quoted[1];
  if (/против|against/i.test(text)) q.choice = "against";
  else if (/въздърж|abstain/i.test(text)) q.choice = "abstain";
  else if (/отсъст|recorded absent/i.test(text)) q.choice = "recordedAbsent";
  else if (
    /гласове.?\s*[„“"]?за|votes?\s+(?:were\s+)?for|share.+for/i.test(text)
  )
    q.choice = "for";
  if (/процент|дял|share|percentage/i.test(text)) {
    q.metric = "choiceShare";
    q.operation = "share";
  }
  if (/еднакво|vote alike|agreement/i.test(question)) {
    q.metric = "agreement";
    q.corpus = "parliamentCasts";
  }
  if (/групата|faction/i.test(text) && /съглас|alignment|align/i.test(text)) {
    q.metric = "alignment";
    q.corpus = "parliamentCasts";
  }
  if (/оспорван|contested/i.test(text)) {
    q.metric = "contested";
    q.operation = "rank";
  }
  if (/колко|how many|count/i.test(text) && q.metric !== "choiceShare")
    q.operation = "count";
  if (/по месеци|by month|monthly/i.test(text)) {
    q.operation = "trend";
    q.groupBy = "month";
  }
  if (/без.*преглас|standing/i.test(text)) q.basis = "standing";
  else if (/всички.*опити|all attempts/i.test(text)) q.basis = "attempts";
  if (corpus.startsWith("council")) {
    if (/приети|adopted/i.test(text)) q.outcome = "adopted";
    if (/нямат.*поимен|без.*поимен|no.*named|without.*named/i.test(text))
      q.named = "no";
    else if (/поимен|named/i.test(text) && !corpus.endsWith("Casts"))
      q.named = "yes";
  }
  if (
    /първоизточ|покритие|кои периоди|кои общини|coverage|which periods|which municipalities|methodology/i.test(
      text,
    )
  )
    q.operation = "methodology";
  const record = text.match(/\b\d{1,2}:\d{4}-\d{2}-\d{2}:\d+(?:::\d+)?\b/);
  if (record) {
    q.key = record[0];
    q.operation = "detail";
  }
  if (
    corpus.endsWith("Casts") &&
    !names.length &&
    !q.seatIds &&
    !q.councilCastKeys &&
    !q.key &&
    !q.parentQuery &&
    !/кой гласува|who voted|поименния вот|named roll/i.test(question)
  )
    return { kind: "scope", draft: q, names, needs: "scope" };
  if (!q.topicIds && !q.keyword) {
    const subject = text.match(
      /(?:за|по|on|about)\s+(.+?)(?=\s+(?:през|от|in|from)(?:\s|$)|[?.!]|$)/i,
    );
    if (
      subject &&
      subject[1].trim() &&
      !/парламент|съвет|parliament|council/i.test(subject[1])
    )
      q.keyword = subject[1].trim();
  }
  if (/решение\s+\d|resolution\s+\d|протокол|protocol/i.test(text) && !q.key)
    return { kind: "scope", draft: q, names, needs: "record" };
  if (template)
    return {
      kind: "scope",
      draft: { ...q, ...template.draft, councilIds: q.councilIds },
      names: template.names,
    };
  if (names.length) return { kind: "scope", draft: q, names };
  if (/кой гласува|who voted/i.test(question) && !q.key && !q.parentQuery)
    return { kind: "scope", draft: q, names, needs: "record" };
  const parsed = validateRollcallQuery(q);
  if (!parsed.ok)
    return {
      kind: "scope",
      draft: q,
      names,
      needs: "scope",
      message: parsed.errors.join(","),
    };
  return { kind: "scope", draft: parsed.query, names };
}
