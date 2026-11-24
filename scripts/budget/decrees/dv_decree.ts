// Council of Ministers spending decrees (ПМС) from Държавен вестник material pages
// (dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=N) — docs/plans/insait-gap-v1.md §4.
//
// A ПМС „за одобряване на допълнителни разходи / трансфери по бюджета на …" is how the
// government moves money that no budget line named in advance: Чл. 1 states the amount,
// the budget it goes to and what for. That is the money a reader cannot find in the
// law's annexes or in procurement.
//
// ⚠️ APPROPRIATED ≠ TRANSFERRED ≠ SPENT. A decree authorises extra spending; whether the
// money was paid out, and to whom in the end, is a different record. An amount here is
// „до" (up to) where the decree says so — `upTo` keeps that.

import { BGN_PER_EUR } from "../named_appropriations";

export type DvHeader = {
  issuer: string; // „Министерски съвет", „Народно събрание", a court, a município…
  // NULL: DV lists the material without an issue („брой: null") — never promulgated.
  issueNo: number | null;
  issueDate: string | null; // YYYY-MM-DD
  official: boolean; // „Официален раздел" vs „Неофициален раздел"
  title: string;
};

export type DecreeClause = {
  seq: number;
  native: number;
  currency: "BGN" | "EUR";
  eur: number;
  upTo: boolean; // „в размер до …"
  purpose: string | null; // the „за …" clause, as written
};

export type SpendingDecree = {
  number: number;
  date: string; // YYYY-MM-DD
  kind: "разходи" | "трансфери" | "разходи/трансфери";
  budgetOf: string | null; // „Министерството на енергетиката"
  budgetYear: number | null;
  clauses: DecreeClause[];
  text: string; // the decree's whole text, for search
};

const MONTHS: Record<string, number> = {
  януари: 1,
  февруари: 2,
  март: 3,
  април: 4,
  май: 5,
  юни: 6,
  юли: 7,
  август: 8,
  септември: 9,
  октомври: 10,
  ноември: 11,
  декември: 12,
};

const decode = (s: string): string =>
  s
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&bdquo;|&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&[nm]dash;/g, "–")
    .replace(/&sect;/g, "§")
    .replace(/&amp;/g, "&");

/** Visible text of a fragment, style/comment blocks dropped, whitespace collapsed. */
export const visibleText = (html: string): string =>
  decode(
    html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

// Each header block sits alone in its own table cell, and „titleHead" nests an icon
// <div>, so a block is read up to its CELL's end rather than its own closing tag.
const classText = (html: string, cls: string): string | null => {
  const m = new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</td>`, "i").exec(html);
  return m ? visibleText(m[1]) : null;
};

/** The material's header, or null when the page is not a material (an id DV never
 *  issued answers a page with none of these blocks). */
export const parseHeader = (html: string): DvHeader | null => {
  const issuer = classText(html, "titleHead");
  const mark = classText(html, "mark");
  const title = classText(html, "tdHead1");
  if (!issuer || !mark || title == null) return null;
  const m = /брой:\s*(\d+),\s*от дата\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(
    mark,
  );
  const unissued = /брой:\s*null/.test(mark);
  if (!m && !unissued) throw new Error(`DV header without an issue: „${mark}"`);
  const pad = (n: string) => n.padStart(2, "0");
  return {
    issuer,
    issueNo: m ? Number(m[1]) : null,
    issueDate: m ? `${m[4]}-${pad(m[3])}-${pad(m[2])}` : null,
    official: /Официален раздел/.test(mark) && !/Неофициален/.test(mark),
    title,
  };
};

/** A Council of Ministers decree that moves budget money — the ones whose body we keep.
 *  A decree with no issue was never promulgated and is not one. */
export const isSpendingDecree = (h: DvHeader): boolean =>
  h.official &&
  h.issueNo != null &&
  /^Министерски съвет$/i.test(h.issuer) &&
  /^Постановление №/.test(h.title) &&
  /(допълнителни|разходи|трансфер)/i.test(h.title);

// The titles vary more than one pattern: „… допълнителни разходи по бюджета на X за 2026
// г.", „… допълнителни трансфери за 2021 г. за финансово осигуряване на …", „…
// допълнителен трансфер по бюджета на Община Добрич", „… допълнителни разходи/трансфери
// от резерва по …". So the title is read in parts: the head is required, the budget and
// the year are taken when present. A combined title („за определяне размера на … и за
// одобряване на допълнителни разходи …") is one too, so the kind is looked for anywhere.
const TITLE_HEAD = /^Постановление № (\d+) от (\d{1,2}) ([а-я]+) (\d{4}) г\./u;
const TITLE_KIND =
  /за одобряване на допълнител(?:ни|ен) (разходи\/трансфери|разходи|трансфери|трансфер)(?![\p{L}])/iu;
const AMOUNT =
  /в (общ )?размер(?: на)?( до)? (\d{1,3}(?: \d{3})*(?:,\d+)?) (лв|евро)\.?(?: \([^)]*\))?(?:,? (за [\s\S]+?)(?=\.\s*\(\d+\)|\.\s*\d+\.\s|\.\s*Чл\.|;\s|:\s|\.?$))?/;

/** The paragraphs that appropriate money: every „(n)" of every article (or the whole
 *  article when it has none) whose text starts with „Одобрява". */
export const appropriatingParagraphs = (text: string): string[] =>
  [...text.matchAll(/Чл\. \d+\.([\s\S]*?)(?=Чл\. \d+\.|Заключителн|$)/g)]
    .flatMap((a) => a[1].split(/\(\d+\)/))
    .map((p) => p.trim())
    .filter((p) => /^Одобрява(?![\p{L}])/u.test(p));
const BUDGET_OF = /по бюджета на (.+?)(?= за \d{4} г\.| за | от |\.?$)/;
const BUDGET_YEAR = /за (\d{4}) г\./;

/** „5 000 000" / „1 234 567,89" → number. */
const amount = (s: string): number =>
  Number(s.replace(/\s/g, "").replace(",", "."));

/** Parse a spending decree's page. Returns null for a decree whose title is not of the
 *  „одобряване на допълнителни разходи/трансфери по бюджета на …" form — other ПМС
 *  (a programme, an allocation rule) are kept in the raw store but not modelled here. */
export const parseSpendingDecree = (
  html: string,
  header: DvHeader,
): SpendingDecree | null => {
  const t = TITLE_HEAD.exec(header.title);
  const k = t && TITLE_KIND.exec(header.title);
  if (!t || !k) return null;
  const rest = header.title.slice(k.index + k[0].length);
  const month = MONTHS[t[3].toLowerCase()];
  if (!month) throw new Error(`unknown month „${t[3]}" in „${header.title}"`);
  const text = visibleText(
    html.slice(html.search(/class="tdHead1"/i)).replace(/^[^>]*>/, ""),
  );
  // One amount per appropriating paragraph: the first stated, which is the total. What
  // follows it — „разпределени, както следва:", „от които:", item subtotals („в общ
  // размер … лв., от които") — breaks the SAME money down and is never added to it, and
  // a paragraph that appropriates nothing („Допълнителната сума … е в размер 50 лв.")
  // carries no clause at all.
  const totals = appropriatingParagraphs(text)
    .map((p) => AMOUNT.exec(p))
    .filter((m): m is RegExpExecArray => m != null);
  const clauses: DecreeClause[] = totals.map((m, i) => {
    const native = amount(m[3]);
    const currency = m[4] === "евро" ? "EUR" : "BGN";
    return {
      seq: i + 1,
      native,
      currency,
      eur:
        currency === "EUR"
          ? native
          : Math.round((native / BGN_PER_EUR) * 100) / 100,
      upTo: !!m[2],
      purpose: m[5]?.replace(/[\s.]+$/, "") || null,
    };
  });
  return {
    number: Number(t[1]),
    date: `${t[4]}-${String(month).padStart(2, "0")}-${t[2].padStart(2, "0")}`,
    kind: /разходи\/трансфери/i.test(k[1])
      ? "разходи/трансфери"
      : /трансфер/i.test(k[1])
        ? "трансфери"
        : "разходи",
    budgetOf: BUDGET_OF.exec(rest)?.[1] ?? null,
    budgetYear: Number(BUDGET_YEAR.exec(rest)?.[1]) || null,
    clauses,
    text,
  };
};
