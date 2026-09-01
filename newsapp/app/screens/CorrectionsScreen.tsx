import { Card } from "@/components/ui/card";
import {
  CORRECTIONS,
  RIGHT_OF_REPLY_POLICY,
  safeCorrectionPath,
  type CorrectionEntry,
} from "../corrections";
import { ReportIssueLink } from "../components/ReportIssueLink";
import { useNewsLocale } from "../i18n";

export const CorrectionsScreen = ({
  entries = CORRECTIONS,
}: {
  entries?: readonly CorrectionEntry[];
}) => {
  const { isEnglish, tr } = useNewsLocale();
  const policy = tr(
    RIGHT_OF_REPLY_POLICY,
    "A right-of-reply request must identify the affected person or organization, the disputed claim, and a factual response intended for publication.",
  );
  return (
    <article className="mx-auto max-w-4xl py-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {tr("Редакционен процес", "Editorial process")}
        </p>
        <h1 className="mt-1 font-title text-3xl">
          {tr("Поправки и право на отговор", "Corrections and right of reply")}
        </h1>
        <p className="mt-3 max-w-3xl leading-relaxed text-foreground/90">
          {tr(
            "Приемаме сигнали за фактическа грешка, погрешно групирана статия, аналитична оценка, права за изображение и право на отговор. Посочете точния адрес и проверими публични основания.",
            "We accept reports about factual errors, incorrectly grouped articles, analytical ratings, image rights, and rights of reply. Include the exact URL and verifiable public grounds.",
          )}
        </p>
      </header>

      <Card className="mt-6 p-5">
        <h2 className="font-title text-xl">
          {tr("Какво следва след сигнал", "What happens after a report")}
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
          <li>
            {tr(
              "Проверяваме сигнала спрямо оригиналния материал и наличните данни.",
              "We check the report against the original publication and available data.",
            )}
          </li>
          <li>
            {tr(
              "При потвърдена грешка поправяме или оттегляме засегнатото съдържание.",
              "When an error is confirmed, we correct or withdraw the affected content.",
            )}
          </li>
          <li>
            {tr(
              "Публикуваме датата, вида и обяснение на промяната в регистъра по-долу.",
              "We publish the date, type, and explanation of the change in the register below.",
            )}
          </li>
          <li>{policy}</li>
        </ol>
        <p className="mt-3 text-sm text-muted-foreground">
          {tr(
            "GitHub сигналите са публични. Не изпращайте лични или чувствителни данни. В момента няма частен канал и не обещаваме срок, който не можем надеждно да спазим.",
            "GitHub issues are public. Do not submit personal or sensitive data. There is currently no private channel, and we do not promise a deadline we cannot reliably meet.",
          )}
        </p>
        <div className="mt-4">
          <ReportIssueLink />
        </div>
      </Card>

      <section className="mt-8" aria-labelledby="corrections-log">
        <h2 id="corrections-log" className="font-title text-2xl">
          {tr("Публичен регистър", "Public register")}
        </h2>
        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {tr(
              "Няма публикувани поправки, оттегляния или права на отговор.",
              "No corrections, withdrawals, or rights of reply have been published.",
            )}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {[...entries]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((entry) => (
                <li key={entry.id}>
                  <Card className="p-4 text-sm">
                    <time dateTime={entry.date}>{entry.date}</time> ·{" "}
                    {isEnglish ? "Editorial register entry" : entry.kind}
                    {!isEnglish ? <> — {entry.note}</> : null}
                    {safeCorrectionPath(entry.path) ? (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href={safeCorrectionPath(entry.path)}
                          className="font-medium text-primary hover:underline"
                        >
                          {tr("Засегната страница", "Affected page")}
                        </a>
                      </>
                    ) : null}
                  </Card>
                </li>
              ))}
          </ul>
        )}
      </section>
    </article>
  );
};
