import { sqlQuestionHref } from "../../../src/lib/questions/sql/url";
import type { Lang } from "../../tools/types";
export default function SqlAlternative({
  id,
  lang,
}: {
  id: string;
  lang: Lang;
}) {
  return (
    <a
      className="inline-flex min-h-11 items-center text-sm text-primary underline"
      href={`https://electionsbg.com${sqlQuestionHref(id, {})}`}
    >
      {lang === "bg"
        ? "Отвори SQL пример в браузъра за данни"
        : "Open SQL example in the data browser"}{" "}
      ↗
    </a>
  );
}
