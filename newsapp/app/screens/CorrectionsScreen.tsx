import { Card } from "@/components/ui/card";
import {
  CORRECTIONS,
  RIGHT_OF_REPLY_POLICY,
  safeCorrectionPath,
  type CorrectionEntry,
} from "../corrections";
import { ReportIssueLink } from "../components/ReportIssueLink";

export const CorrectionsScreen = ({
  entries = CORRECTIONS,
}: {
  entries?: readonly CorrectionEntry[];
}) => (
  <article className="mx-auto max-w-4xl py-6">
    <header>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Редакционен процес
      </p>
      <h1 className="mt-1 font-title text-3xl">Поправки и право на отговор</h1>
      <p className="mt-3 max-w-3xl leading-relaxed text-foreground/90">
        Приемаме сигнали за фактическа грешка, погрешно групирана статия,
        аналитична оценка, права за изображение и право на отговор. Посочете
        точния адрес и проверими публични основания.
      </p>
    </header>

    <Card className="mt-6 p-5">
      <h2 className="font-title text-xl">Какво следва след сигнал</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
        <li>
          Проверяваме сигнала спрямо оригиналния материал и наличните данни.
        </li>
        <li>
          При потвърдена грешка поправяме или оттегляме засегнатото съдържание.
        </li>
        <li>
          Публикуваме датата, вида и обяснение на промяната в регистъра по-долу.
        </li>
        <li>{RIGHT_OF_REPLY_POLICY}</li>
      </ol>
      <p className="mt-3 text-sm text-muted-foreground">
        GitHub сигналите са публични. Не изпращайте лични или чувствителни
        данни. В момента няма частен канал и не обещаваме срок, който не можем
        надеждно да спазим.
      </p>
      <div className="mt-4">
        <ReportIssueLink />
      </div>
    </Card>

    <section className="mt-8" aria-labelledby="corrections-log">
      <h2 id="corrections-log" className="font-title text-2xl">
        Публичен регистър
      </h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Няма публикувани поправки, оттегляния или права на отговор.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {[...entries]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((entry) => (
              <li key={entry.id}>
                <Card className="p-4 text-sm">
                  <time dateTime={entry.date}>{entry.date}</time> · {entry.kind}{" "}
                  — {entry.note}
                  {safeCorrectionPath(entry.path) ? (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={safeCorrectionPath(entry.path)}
                        className="font-medium text-primary hover:underline"
                      >
                        Засегната страница
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
