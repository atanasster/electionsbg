import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { RIGHT_OF_REPLY_POLICY } from "../corrections";

export const AboutScreen = () => (
  <article className="mx-auto max-w-4xl py-6">
    <header>
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        За редакцията
      </p>
      <h1 className="mt-1 font-title text-3xl">За Наясно Новини</h1>
      <p className="mt-3 max-w-3xl text-lg leading-relaxed text-foreground/90">
        Наясно Новини е част от electionsbg.com. Целта му е да помага на
        читателя да сравнява как различни български медии отразяват една и съща
        история — без да заменя самите медии.
      </p>
    </header>

    <div className="mt-8 grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-title text-xl">Какво публикуваме</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          Събираме публично достъпни статии, групираме материалите за едно
          събитие и показваме заглавията, източниците и анализа им един до друг.
          Началната страница показва само анализирани истории, за които
          избраното изображение има проверено основание за повторна употреба.
        </p>
      </Card>
      <Card className="p-5">
        <h2 className="font-title text-xl">Кой носи отговорност</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          Оценките се създават автоматично по публикувана рубрика, но
          редакционната отговорност за това как са представени, поправени или
          оттеглени остава при екипа на electionsbg.com. Моделът и датата на
          анализа се показват при всяка оценена статия.
        </p>
      </Card>
      <Card className="p-5">
        <h2 className="font-title text-xl">Редакционни принципи</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground/90">
          <li>
            Оценяваме отделния материал, не поставяме етикет на цяла медия.
          </li>
          <li>Показваме обосновката и увереността, когато са налични.</li>
          <li>Не представяме липсващ анализ като неутрална оценка.</li>
          <li>Водим читателя към оригиналната публикация и нейния издател.</li>
        </ul>
      </Card>
      <Card className="p-5">
        <h2 className="font-title text-xl">Проверимост</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          Методът, ограниченията и покритието са публични. Кодът на проекта е
          отворен, така че техническите решения и промените могат да бъдат
          проследени.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm font-medium">
          <Link to="/methodology" className="text-primary hover:underline">
            Методология
          </Link>
          <a
            href="https://github.com/atanasster/electionsbg"
            className="text-primary hover:underline"
          >
            Отворен код <span aria-hidden>↗</span>
          </a>
        </div>
      </Card>
    </div>

    <section className="mt-8 border-t pt-6">
      <h2 className="font-title text-xl">Собственост и финансиране</h2>
      <p className="mt-2 text-sm leading-relaxed text-foreground/90">
        Проектът се поддържа от двамата посочени по-долу автори. Към 28 август
        2026 г. не е публикувана проверена декларация за юридически собственик,
        източници на финансиране, реклама, спонсорство или потенциални конфликти
        на интереси. Докато такава декларация липсва, не твърдим институционална
        или финансова независимост.
      </p>
    </section>

    <section className="mt-8 border-t pt-6">
      <h2 className="font-title text-xl">Поправки и право на отговор</h2>
      <p className="mt-2 text-sm leading-relaxed text-foreground/90">
        Читател, автор или издание може да оспори фактическа грешка, погрешно
        свързана статия, нарушение на права за изображение или аналитична
        оценка. Посочете точния адрес и проверими основания. Екипът преглежда
        сигнала; потвърдена грешка се поправя или материалът се оттегля, а
        промяната се отбелязва с дата. Общата обратна връзка се разглежда като
        сигнал, но сама по себе си не е право на отговор.{" "}
        {RIGHT_OF_REPLY_POLICY} Не обещаваме срок, който не можем надеждно да
        спазим.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        В момента има само публичен GitHub канал и няма частен канал за
        чувствителни доказателства. Това е ограничение на текущия процес.
      </p>
      <Link
        to="/corrections"
        className="mt-3 inline-block font-medium text-primary hover:underline"
      >
        Процес и публичен регистър
      </Link>
    </section>

    <section className="mt-8 border-t pt-6">
      <h2 className="font-title text-xl">Екип</h2>
      <p className="mt-2 text-sm leading-relaxed text-foreground/90">
        electionsbg.com се поддържа от Мартин Стоянов и Атанас Стоянов. Повече
        за опита и ролята им е публикувано в основната страница на проекта.
      </p>
      <a
        href="https://electionsbg.com/about"
        className="mt-3 inline-block font-medium text-primary hover:underline"
      >
        За екипа на electionsbg.com <span aria-hidden>↗</span>
      </a>
    </section>

    <section className="mt-8 border-t pt-6">
      <h2 className="font-title text-xl">Въпроси и сигнали</h2>
      <p className="mt-2 text-sm leading-relaxed text-foreground/90">
        За въпрос за метода, данните или конкретна публикация използвайте
        публичния канал за сигнали на проекта. Не изпращайте лични или
        чувствителни данни.
      </p>
      <a
        href="https://github.com/atanasster/electionsbg/issues"
        className="mt-3 inline-block font-medium text-primary hover:underline"
      >
        Отвори сигнал в GitHub <span aria-hidden>↗</span>
      </a>
    </section>
  </article>
);
