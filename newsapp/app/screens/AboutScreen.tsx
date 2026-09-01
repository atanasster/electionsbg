import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { RIGHT_OF_REPLY_POLICY } from "../corrections";
import { useNewsLocale } from "../i18n";

export const AboutScreen = () => {
  const { isEnglish, tr } = useNewsLocale();
  return (
    <article className="mx-auto max-w-4xl py-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {tr("За редакцията", "About the newsroom")}
        </p>
        <h1 className="mt-1 font-title text-3xl">
          {tr("За Наясно Новини", "About Naiasno News")}
        </h1>
        <p className="mt-3 max-w-3xl text-lg leading-relaxed text-foreground/90">
          {tr(
            "Наясно Новини е част от electionsbg.com. Целта му е да помага на читателя да сравнява как различни български медии отразяват една и съща история — без да заменя самите медии.",
            "Naiasno News is part of electionsbg.com. It helps readers compare how Bulgarian media cover the same story without replacing the original publishers.",
          )}
        </p>
      </header>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-title text-xl">
            {tr("Какво публикуваме", "What we publish")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground/90">
            {tr(
              "Събираме публично достъпни статии, групираме материалите за едно събитие и показваме заглавията, източниците и анализа им един до друг. Началната страница показва само анализирани истории, за които избраното изображение има проверено основание за повторна употреба.",
              "We collect publicly available articles, group coverage of the same event, and compare headlines, sources, and analysis. The home page shows only analyzed stories whose selected image has a verified basis for reuse.",
            )}
          </p>
        </Card>
        <Card className="p-5">
          <h2 className="font-title text-xl">
            {tr("Кой носи отговорност", "Editorial responsibility")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground/90">
            {tr(
              "Оценките се създават автоматично по публикувана рубрика, но редакционната отговорност за това как са представени, поправени или оттеглени остава при екипа на electionsbg.com. Моделът и датата на анализа се показват при всяка оценена статия.",
              "Ratings are generated automatically using a published rubric, but the electionsbg.com team remains editorially responsible for how they are presented, corrected, or withdrawn. The model and analysis date appear with every rated article.",
            )}
          </p>
        </Card>
        <Card className="p-5">
          <h2 className="font-title text-xl">
            {tr("Редакционни принципи", "Editorial principles")}
          </h2>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground/90">
            <li>
              {tr(
                "Оценяваме отделния материал, не поставяме етикет на цяла медия.",
                "We rate individual articles, not entire media outlets.",
              )}
            </li>
            <li>
              {tr(
                "Показваме обосновката и увереността, когато са налични.",
                "We show the rationale and confidence when available.",
              )}
            </li>
            <li>
              {tr(
                "Не представяме липсващ анализ като неутрална оценка.",
                "We never present missing analysis as a neutral rating.",
              )}
            </li>
            <li>
              {tr(
                "Водим читателя към оригиналната публикация и нейния издател.",
                "We direct readers to the original publication and publisher.",
              )}
            </li>
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="font-title text-xl">
            {tr("Проверимост", "Verifiability")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground/90">
            {tr(
              "Методът, ограниченията и покритието са публични. Кодът на проекта е отворен, така че техническите решения и промените могат да бъдат проследени.",
              "The method, limitations, and coverage are public. The project code is open, so technical decisions and changes can be traced.",
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm font-medium">
            <Link to="/methodology" className="text-primary hover:underline">
              {tr("Методология", "Methodology")}
            </Link>
            <a
              href="https://github.com/atanasster/electionsbg"
              className="text-primary hover:underline"
            >
              {tr("Отворен код", "Open-source code")} <span aria-hidden>↗</span>
            </a>
          </div>
        </Card>
      </div>

      <section className="mt-8 border-t pt-6">
        <h2 className="font-title text-xl">
          {tr("Собственост и финансиране", "Ownership and funding")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          {tr(
            "Проектът се поддържа от двамата посочени по-долу автори. Към 28 август 2026 г. не е публикувана проверена декларация за юридически собственик, източници на финансиране, реклама, спонсорство или потенциални конфликти на интереси. Докато такава декларация липсва, не твърдим институционална или финансова независимост.",
            "The project is maintained by the two authors named below. As of 28 August 2026, no verified disclosure of legal ownership, funding sources, advertising, sponsorship, or potential conflicts of interest has been published. Until such a disclosure exists, we do not claim institutional or financial independence.",
          )}
        </p>
      </section>

      <section className="mt-8 border-t pt-6">
        <h2 className="font-title text-xl">
          {tr("Поправки и право на отговор", "Corrections and right of reply")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          {tr(
            `Читател, автор или издание може да оспори фактическа грешка, погрешно свързана статия, нарушение на права за изображение или аналитична оценка. Посочете точния адрес и проверими основания. Екипът преглежда сигнала; потвърдена грешка се поправя или материалът се оттегля, а промяната се отбелязва с дата. Общата обратна връзка се разглежда като сигнал, но сама по себе си не е право на отговор. ${RIGHT_OF_REPLY_POLICY} Не обещаваме срок, който не можем надеждно да спазим.`,
            "A reader, author, or publisher may challenge a factual error, an incorrectly linked article, an image-rights issue, or an analytical rating. Include the exact URL and verifiable grounds. The team reviews the report; confirmed errors are corrected or withdrawn, and the change is dated. General feedback is reviewed as a report but does not by itself constitute a right of reply. A right-of-reply request must identify the affected person or organization, the disputed claim, and a factual response intended for publication. We do not promise a deadline we cannot reliably meet.",
          )}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {tr(
            "В момента има само публичен GitHub канал и няма частен канал за чувствителни доказателства. Това е ограничение на текущия процес.",
            "Only a public GitHub channel is currently available; there is no private channel for sensitive evidence. This is a limitation of the current process.",
          )}
        </p>
        <Link
          to="/corrections"
          className="mt-3 inline-block font-medium text-primary hover:underline"
        >
          {tr("Процес и публичен регистър", "Process and public register")}
        </Link>
      </section>

      <section className="mt-8 border-t pt-6">
        <h2 className="font-title text-xl">{tr("Екип", "Team")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          {tr(
            "electionsbg.com се поддържа от Мартин Стоянов и Атанас Стоянов. Повече за опита и ролята им е публикувано в основната страница на проекта.",
            "electionsbg.com is maintained by Martin Stoyanov and Atanas Stoyanov. More about their experience and roles is available on the main project site.",
          )}
        </p>
        <a
          href={`https://electionsbg.com${isEnglish ? "/en" : ""}/about`}
          className="mt-3 inline-block font-medium text-primary hover:underline"
        >
          {tr("За екипа на electionsbg.com", "About the electionsbg.com team")}{" "}
          <span aria-hidden>↗</span>
        </a>
      </section>

      <section className="mt-8 border-t pt-6">
        <h2 className="font-title text-xl">
          {tr("Въпроси и сигнали", "Questions and reports")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          {tr(
            "За въпрос за метода, данните или конкретна публикация използвайте публичния канал за сигнали на проекта. Не изпращайте лични или чувствителни данни.",
            "For questions about the method, data, or a specific publication, use the project's public issue channel. Do not submit personal or sensitive data.",
          )}
        </p>
        <a
          href="https://github.com/atanasster/electionsbg/issues"
          className="mt-3 inline-block font-medium text-primary hover:underline"
        >
          {tr("Отвори сигнал в GitHub", "Open a GitHub issue")}{" "}
          <span aria-hidden>↗</span>
        </a>
      </section>
    </article>
  );
};
