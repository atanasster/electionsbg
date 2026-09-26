import { NEWS_PERSON_ID_PATTERN } from "./newsPersonId";

export type CorrectionKind = "поправка" | "оттегляне" | "право на отговор";

export interface CorrectionEntry {
  id: string;
  date: string;
  path: string;
  kind: CorrectionKind;
  note: string;
}

/** Public, append-only editorial log. Empty means no published corrections yet. */
export const CORRECTIONS: readonly CorrectionEntry[] = [];

const ISSUE_BASE = "https://github.com/atanasster/electionsbg/issues/new";
// ⚠️ An ALLOWLIST, not a sanitiser: the path is interpolated into a URL that
// leaves this origin, so a family reaches it only by being named here. The
// person arm COMPOSES the shared `news_person_id` charset rather than
// restating it — an id the shard writer would refuse must not become a link
// telling a reader to report a page that cannot exist.
const ALLOWED_PATH = new RegExp(
  `^\\/(?:story\\/[A-Za-z0-9._~-]+|article\\/[A-Za-z0-9.-]+\\/[A-Za-z0-9._~-]+|person\\/${NEWS_PERSON_ID_PATTERN})$`,
);

export const safeCorrectionPath = (candidate?: string): string => {
  if (!candidate || !ALLOWED_PATH.test(candidate)) return "";
  try {
    const url = new URL(candidate, "https://news.electionsbg.com");
    return url.origin === "https://news.electionsbg.com" &&
      !url.search &&
      !url.hash &&
      url.pathname === candidate
      ? candidate
      : "";
  } catch {
    return "";
  }
};

export const RIGHT_OF_REPLY_POLICY =
  "Засегнато от публикацията лице или организация може да поиска право на отговор. Публикуваме ясно обозначен, относим и законосъобразен отговор по редакционна преценка; публикацията не е автоматична и не заменя поправка при установена фактическа грешка.";

/**
 * A signal about ONE person on a page — a wrong identity, or the person
 * objecting to how the article's framing was read (news-person-sentiment-v1
 * §5). The id is validated like any other path segment.
 */
export interface CorrectionPerson {
  id: string;
  name?: string | null;
}

export const correctionIssueUrl = (
  path?: string,
  person?: CorrectionPerson,
): string => {
  const safePath = safeCorrectionPath(path);
  const personId =
    person && safeCorrectionPath(`/person/${person.id}`) ? person.id : null;
  const params = new URLSearchParams({
    labels: "news-correction",
    title: personId
      ? "[Наясно Новини] Сигнал за лице"
      : "[Наясно Новини] Сигнал за поправка",
    body: [
      "## Страница",
      safePath
        ? `https://news.electionsbg.com${safePath}`
        : "(добавете точния адрес)",
      "",
      ...(personId
        ? [
            "## Лице",
            `${(person?.name ?? "").trim() || personId} (${personId})`,
            "",
            "Погрешна самоличност или възражение срещу оценката как материалът представя лицето — посочете кое.",
            "",
          ]
        : []),
      "## Вид на сигнала",
      "Фактическа грешка / погрешно свързване / аналитична оценка / права за изображение / право на отговор",
      "",
      "## Проверими основания",
      "(опишете фактите и посочете публични източници)",
      "",
      "Не включвайте лични или чувствителни данни — сигналът е публичен.",
    ].join("\n"),
  });
  return `${ISSUE_BASE}?${params.toString()}`;
};
