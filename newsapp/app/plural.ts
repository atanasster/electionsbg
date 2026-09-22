// The two agreement rules the story page's completeness sentences share —
// written once because T5.3 and T5.4 each got one of them wrong on a
// neighbouring line: the COUNT NOUN follows the total M, the VERB follows
// the subject N („N of them"). Bulgarian uses the бройна форма after a
// numeral („2 материала"), singular for one („1 материал").

export type Lang = "bg" | "en";

export const articleNoun = (m: number, lang: Lang): string =>
  lang === "en"
    ? m === 1
      ? "article"
      : "articles"
    : m === 1
      ? "материал"
      : "материала";

/** „Оценен е" / „Оценени са" — the verb of the assessed sentence, by N. */
export const assessedVerb = (n: number, lang: Lang): string =>
  lang === "en"
    ? n === 1
      ? "is"
      : "are"
    : n === 1
      ? "Оценен е"
      : "Оценени са";
