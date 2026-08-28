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
const ALLOWED_PATH =
  /^\/(?:story\/[A-Za-z0-9._~-]+|article\/[A-Za-z0-9.-]+\/[A-Za-z0-9._~-]+)$/;

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

export const correctionIssueUrl = (path?: string): string => {
  const safePath = safeCorrectionPath(path);
  const params = new URLSearchParams({
    labels: "news-correction",
    title: "[Наясно Новини] Сигнал за поправка",
    body: [
      "## Страница",
      safePath
        ? `https://news.electionsbg.com${safePath}`
        : "(добавете точния адрес)",
      "",
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
