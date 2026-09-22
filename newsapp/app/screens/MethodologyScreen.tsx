// Методология — the page that makes the rest publishable.
//
// ⚠️ This is a PRECONDITION for the product, not documentation of it. Ground
// News can point at three third-party raters when challenged; we have no such
// shield. Our only authority is that the method is written down and the
// evidence is attached to each label — so if this page is wrong or absent,
// every judgment the app publishes about a named newsroom is unsupported.
//
// Two rules the layout encodes:
//
//   1. WHAT THE CORPUS DOES NOT COVER COMES FIRST, before any number. A reader
//      who learns about the 8.4% at the bottom has already read the figures
//      above it as complete.
//   2. EVERY FIGURE IS DERIVED from the bundles the app already loads. A
//      hard-coded "4,366 articles" is a claim that goes stale silently, and
//      this is the one page where a stale claim is a credibility failure
//      rather than a cosmetic one.

import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LEANING_META,
  LEANING_META_EN,
  LEANING_ORDER,
  RUSSIA_META,
  RUSSIA_META_EN,
  RUSSIA_ORDER,
  formatDate,
} from "../labels";
import { useOutlets, useStats, type Outlet, type Stats } from "../data";
import { useNewsLocale } from "../i18n";
import {
  FUNDING_TRANSPARENCY_COVERAGE,
  retirementReason,
} from "../sourceTransparency";
import { RIGHT_OF_REPLY_POLICY } from "../corrections";

const Figure = ({ value, label }: { value: string; label: string }) => (
  <div>
    <div className="font-title text-2xl leading-tight">{value}</div>
    <div className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
  </div>
);

const Section = ({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) => (
  <section id={id} className="mt-8 scroll-mt-20">
    <h2 className="app-section-title">{title}</h2>
    <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground/90">
      {children}
    </div>
  </section>
);

/** The five-step legend, rendered from the SAME META the cards use. */
const ScaleLegend = ({
  order,
  meta,
}: {
  order: readonly string[];
  meta: Record<string, { label: string; color: string }>;
}) => (
  <div>
    <div className="flex h-2.5 overflow-hidden rounded-full">
      {order.map((key) => (
        <span
          key={key}
          className="block flex-1"
          style={{ backgroundColor: meta[key]?.color }}
        />
      ))}
    </div>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {order.map((key) => (
        <span
          key={key}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span
            aria-hidden
            className="inline-block size-2 rounded-sm"
            style={{ backgroundColor: meta[key]?.color }}
          />
          {meta[key]?.label ?? key}
        </span>
      ))}
    </div>
  </div>
);

/**
 * Retirement reasons, in the app's words.
 *
 * ⚠️ `blocked_captcha` and `bot_refused` are the two that are POLICY rather
 * than breakage, and the page says so in that language: an outlet is not
 * missing because we failed, it is missing because collecting it would have
 * meant doing something we do not do.
 */
const RETIREMENT_LABELS: Record<string, string> = {
  bot_refused: "отказва обхождане от ботове",
  blocked_captcha: "изисква решаване на CAPTCHA",
  broken_sitemaps: "неизползваеми карти на сайта",
  no_article_text: "не публикува четим текст на статиите",
  portal_not_newsroom: "портал, не редакция",
  duplicate_outlet: "дубликат на друго издание",
};

const countBy = (outlets: Outlet[], reason: string): number =>
  outlets.filter((o) => o.retired && o.retired_reason === reason).length;

/**
 * `n` with its Bulgarian noun form.
 *
 * ⚠️ Bulgarian has no "1 издания" and no "1 запазени статии". Four strings on
 * this page got it wrong, two of them ONE CLAUSE after an `n === 1` branch
 * written for exactly this — the branch fixed the subject and left the rest
 * of the sentence plural.
 */
const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

export const MethodologyScreen = () => {
  const { isEnglish, tr } = useNewsLocale();
  const stats = useStats();
  const outlets = useOutlets();

  if (stats.error) {
    return (
      <section className="py-8">
        <h1 className="app-page-title">{tr("Методология", "Methodology")}</h1>
        <Card className="mt-4 p-4 text-sm text-destructive">
          {tr(
            "Данните за методологията не се заредиха",
            "Methodology data could not be loaded",
          )}
          : {stats.error.message}
        </Card>
      </section>
    );
  }
  if (!stats.data) {
    return (
      <section className="py-8">
        <h1 className="app-page-title">{tr("Методология", "Methodology")}</h1>
        <Skeleton className="mt-4 h-40" />
      </section>
    );
  }

  const s = stats.data;
  const all = outlets.data?.outlets ?? [];
  const retired = all.filter((o) => o.retired);
  // ⚠️ An outlets failure must be SAID, not absorbed. Without this the
  // bot-refusal and CAPTCHA bullets simply vanish and the retired list
  // disappears — the page then understates its own limitations, which is the
  // one direction this card must never fail in. Measured: 2 of 4 bullets
  // survive an outlets error.
  const outletsMissing = Boolean(outlets.error) || !outlets.data;
  const botRefused = countBy(all, "bot_refused");
  const captcha = countBy(all, "blocked_captcha");
  // ⚠️ FLOOR, not round, and clamped below 100 unless it really is 100.
  // Math.round printed „100% от събраното е анализирано" beside
  // „(4349 от 4366 статии)" — a limitation stated as its own opposite, on the
  // one card whose job is to under-promise. Understating is the safe
  // direction here; overstating is the failure.
  const fullyAnalysed = s.analyzed_articles >= s.total_articles;
  const analysedPct = fullyAnalysed
    ? 100
    : Math.min(99, Math.floor(s.analyzed_pct));

  if (isEnglish) {
    return (
      <EnglishMethodology
        stats={s}
        retired={retired}
        analysedPct={analysedPct}
        botRefused={botRefused}
        captcha={captcha}
        outletsMissing={outletsMissing}
      />
    );
  }

  return (
    <section className="py-6">
      <h1 className="app-page-title">Методология</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        Всяка статия се оценява поотделно. Не оценяваме медии — оценяваме
        материали, а позицията на едно издание е разпределението на неговите
        собствени материали.
      </p>

      {/* ⚠️ FIRST, and accent-bordered. A reader who meets the 8.4% after the
          figures has already read them as complete. */}
      <Card className="mt-6 border-primary p-4">
        <h2 className="app-section-title">Какво този корпус не покрива</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground/90">
          <li>
            <strong>{analysedPct}% от събраното е анализирано</strong> (
            {s.analyzed_articles.toLocaleString("bg-BG")} от{" "}
            {s.total_articles.toLocaleString("bg-BG")} статии). Всяка обобщена
            оценка важи за анализираното подмножество, не за целия поток.
          </li>
          {botRefused > 0 ? (
            <li>
              <strong>
                {botRefused === 1
                  ? "Едно издание отказва"
                  : `${botRefused} издания отказват`}{" "}
                обхождане от ботове.
              </strong>{" "}
              {botRefused === 1
                ? "Уважаваме отказа — новите му материали не се събират."
                : "Уважаваме отказа — новите им материали не се събират."}
            </li>
          ) : null}
          {captcha > 0 ? (
            <li>
              <strong>
                {captcha === 1
                  ? "Едно издание изисква"
                  : `${captcha} издания изискват`}{" "}
                решаване на CAPTCHA.
              </strong>{" "}
              {captcha === 1
                ? "Не решаваме CAPTCHA, затова това издание липсва изцяло."
                : "Не решаваме CAPTCHA, затова тези издания липсват изцяло."}
            </li>
          ) : null}
          {outletsMissing ? (
            <li>
              <strong>Списъкът с източници не се зареди.</strong> Тази страница
              не може да покаже кои издания са извадени от обхождането и защо —
              а част от ограниченията се броят именно оттам.
            </li>
          ) : null}
          <li>
            <strong>Няма телевизия и радио.</strong> Само публикуван текст.
          </li>
          <li>
            <strong>Част от статиите нямат дата на публикуване.</strong>{" "}
            Изданието не я обявява; подредбата им пада върху момента на
            събиране.
          </li>
        </ul>
      </Card>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure
          value={s.total_articles.toLocaleString("bg-BG")}
          label="събрани статии"
        />
        <Figure
          value={s.analyzed_articles.toLocaleString("bg-BG")}
          label="анализирани"
        />
        <Figure value={String(s.domains)} label="източника" />
        <Figure value={String(s.stories)} label="истории" />
      </div>

      <Section title="Двете оси">
        <p>
          Оценява се <strong>рамката на конкретния материал</strong>, не
          редакционната линия: подбор на източници, приписване на мотив, кой
          получава последната дума.
        </p>
        <div className="space-y-4 pt-1">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide">
              Политическо рамкиране
            </h3>
            <ScaleLegend order={LEANING_ORDER} meta={LEANING_META} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide">
              Отношение към Русия
            </h3>
            <ScaleLegend order={RUSSIA_ORDER} meta={RUSSIA_META} />
            <p className="mt-2 text-sm">
              Отделна ос, защото в българския контекст тя не съвпада с
              ляво-дясно. Прилага се само когато материалът се позовава на
              Русия.
            </p>
          </div>
        </div>
        <p>
          <strong>
            „Извън политическата ос" и „Русия не е спомената" са най-честите
            отговори, при това с голяма разлика.
          </strong>{" "}
          Това не означава „безпристрастен материал". Означава, че рубриката не
          е приложима — например при спорт или кратка сервизна новина. „Без ясно
          рамкиране" е различно: оста е приложима, но текстът не показва ясно
          прогресивна или консервативна рамка. Разпределението на всяко издание
          се вижда на неговата страница.
        </p>
        <p>
          <strong>Всяка оценка носи обосновка</strong> от самия материал.
          Необработената увереност на модела се показва само като техническа
          подробност с изрично предупреждение: тя не е калибрирана вероятност
          оценката да е вярна.
        </p>
      </Section>

      <Section id="outlet-transparency" title="Прозрачност на източниците">
        <p>
          Когато има проверен запис за вписан собственик, показваме името,
          регистъра и датата на справката. Това не е твърдение за действителен
          контрол, краен собственик или редакционна независимост.
        </p>
        <p>
          <strong>Финансирането на изданията не се събира.</strong> Към{" "}
          {formatDate(FUNDING_TRANSPARENCY_COVERAGE.documentedAt)} наборът няма
          проверка на финансиращ модел, реклама или спонсорство по издание.
          Затова профилите показват общото състояние „Не се събира“, а не
          „проверено — няма декларация“. Това е граница на покритието, не оценка
          за доверие.
        </p>
      </Section>

      <Section title="Кое НЕ правим">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Не оценяваме верността на твърденията.</strong> Няма етикет
            „фалшива новина" — нямаме проверителен апарат за това.
          </li>
          <li>
            <strong>Не даваме единна оценка на медия.</strong> Отделни мерки с
            показана основа, никога едно число.
          </li>
          <li>
            <strong>
              Не свързваме име с човек, ако името съвпада с повече от един.
            </strong>{" "}
            Грешната връзка е по-лоша от липсващата.
          </li>
          <li>
            <strong>
              Не заобикаляме CAPTCHA и не се представяме за браузър на човек.
            </strong>{" "}
            Сайт, който отказва бот, не се събира.
          </li>
          <li>
            <strong>Доставянето и правото за показване са различни.</strong>{" "}
            Дали сървърът на изданието връща снимката не доказва разрешение.
            Затова основанието, авторът, кредитът и проверката се записват
            отделно за всяко изображение.
          </li>
        </ul>
      </Section>

      <Section title="Как се събира">
        <p>
          Събираме публично достъпните страници на изданията, спазвайки{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            robots.txt
          </code>{" "}
          и обявената в него скорост. Обхождащият се представя с истинското си
          име и връзка към проекта — не се маскира като браузър на човек.
        </p>
        <p>
          <strong>Пълните текстове не се препубликуват.</strong> Приложението
          показва заглавие, кратко описание и анализ, и сочи към оригинала.
        </p>
        {retired.length > 0 ? (
          <div>
            <p className="mb-2">
              {/* ⚠️ The whole clause switches, not just the noun: the
                  participle has to agree too, and „11 издания са … извадено"
                  is exactly what a noun-only plural helper produces. */}
              <strong>
                {retired.length === 1
                  ? "Едно издание е извадено"
                  : `${retired.length} издания са извадени`}
              </strong>{" "}
              от обхождането. Събраните преди това материали остават — те са
              събрани добросъвестно — но изданията не се представят като активни
              източници:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {retired.map((o) => (
                <li key={o.domain}>
                  <span className="text-foreground">{o.outlet}</span> —{" "}
                  {RETIREMENT_LABELS[o.retired_reason ?? ""] ??
                    o.retired_reason ??
                    "без записана причина"}
                  {o.article_count > 0
                    ? ` (${plural(o.article_count, "запазена статия", "запазени статии")})`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section title="Точност на модела">
        {/* ⚠️ SHIPS EMPTY, and says so. Until the gold-set evaluation exists,
            "предстои" is the honest content; a placeholder implying a number
            would be worse than a blank. */}
        <p>
          Тук ще стои измерената точност спрямо ръчно проверен набор — по поле,
          не като едно число, заедно с това колко често самият проверяващ модел
          си противоречи.
        </p>
        <p className="text-muted-foreground">
          <strong>Тази оценка още не е направена.</strong> До момента, в който
          таблицата съществува, страницата казва, че я няма.
        </p>
      </Section>

      {/* ⚠️ MOVED HERE FROM THE RETIRED /about PAGE (2026-09-21), not
          rewritten. „За редакцията" now points at naiasno.bg/about — the
          project's own page — and everything below is specific to THIS
          corpus, so it would have been lost in the redirect. The ownership
          paragraph in particular is a dated transparency disclosure: it is
          the one thing on this page that must never quietly disappear. */}
      <Section id="editorial" title="Какво публикуваме">
        <p>
          Събираме публично достъпни статии, групираме материалите за едно
          събитие и показваме заглавията, източниците и анализа им един до друг.
          Началната страница показва само анализирани истории, за които
          избраното изображение има проверено основание за повторна употреба.
        </p>
      </Section>

      <Section id="person-pages" title="Страници за лица">
        <p>
          Страница за лице съществува само след редакционно решение:
          самоличност, която е проверена и отбелязана като активна.
          Споменаването в материал не създава страница. На всяка такава страница
          пише колко двойки (лице, материал) са оценени от всички, за които
          лицето е основен или споменат участник, и какво е останало без
          преценка — непрочетен изцяло текст, неоценено или без достатъчно
          доказателство. Показваме кратък цитат като основание, никога целия
          текст на чуждата публикация.
        </p>
        <p className="mt-3">
          Пълните правила — кой получава страница, какво не публикуваме и как се
          иска поправка или право на отговор — са в{" "}
          <a
            className="app-link"
            href="https://github.com/atanasster/electionsbg/blob/main/docs/policies/news-person-pages.md"
            target="_blank"
            rel="noreferrer"
          >
            политиката за страници на лица (news-person-policy-v1) ↗
          </a>
          .
        </p>
      </Section>

      <Section title="Кой носи отговорност">
        <p>
          Първоначалните оценки се създават автоматично по публикувана рубрика.
          Приета редакционна проверка може да потвърди, замени, оттегли или
          изпрати за нова проверка само означените полета. Източникът на всяко
          показано поле, моделът и датата на анализа се публикуват при статията,
          а редакционната отговорност остава при екипа на „Наясно“.
        </p>
      </Section>

      <Section title="Редакционни принципи">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Оценяваме отделния материал, не поставяме етикет на цяла медия.
          </li>
          <li>
            Показваме обосновката до оценката; необработената увереност на
            модела е техническа подробност с изрично ограничение, не вероятност
            за истинност.
          </li>
          <li>Не представяме липсващ анализ като неутрална оценка.</li>
          <li>Водим читателя към оригиналната публикация и нейния издател.</li>
        </ul>
      </Section>

      <Section title="Собственост и финансиране">
        <p>
          Проектът се поддържа от Мартин Стоянов и Атанас Стоянов. Към 28 август
          2026 г. не е публикувана проверена декларация за юридически
          собственик, източници на финансиране, реклама, спонсорство или
          потенциални конфликти на интереси. Докато такава декларация липсва, не
          твърдим институционална или финансова независимост.
        </p>
      </Section>

      <Section title="Поправки и право на отговор">
        <p>
          Читател, автор или издание може да оспори фактическа грешка, погрешно
          свързана статия, нарушение на права за изображение или аналитична
          оценка. Посочете точния адрес и проверими основания. Екипът преглежда
          сигнала; потвърдена грешка се поправя или материалът се оттегля, а
          промяната се отбелязва с дата. Общата обратна връзка се разглежда като
          сигнал, но сама по себе си не е право на отговор.{" "}
          {RIGHT_OF_REPLY_POLICY} Не обещаваме срок, който не можем надеждно да
          спазим.
        </p>
        <p className="text-muted-foreground">
          В момента има само публичен GitHub канал и няма частен канал за
          чувствителни доказателства. Това е ограничение на текущия процес.
        </p>
        <p className="flex flex-wrap gap-3 font-medium">
          <Link to="/corrections" className="text-primary hover:underline">
            Процес и публичен регистър
          </Link>
          <a
            href="https://github.com/atanasster/electionsbg/issues"
            className="text-primary hover:underline"
          >
            Отвори сигнал в GitHub <span aria-hidden>↗</span>
          </a>
        </p>
      </Section>

      <p className="mt-8 text-xs text-muted-foreground">
        Таксономия v{s.taxonomy_version} · последно обновяване{" "}
        {formatDate(s.generated_at)}
      </p>
    </section>
  );
};

const EnglishMethodology = ({
  stats: s,
  retired,
  analysedPct,
  botRefused,
  captcha,
  outletsMissing,
}: {
  stats: Stats;
  retired: Outlet[];
  analysedPct: number;
  botRefused: number;
  captcha: number;
  outletsMissing: boolean;
}) => (
  <section className="py-6">
    <h1 className="app-page-title">Methodology</h1>
    <p className="mt-2 max-w-3xl text-muted-foreground">
      Every article is rated separately. We do not rate outlets: an outlet's
      position is the distribution of ratings across its own articles.
    </p>

    <Card className="mt-6 border-primary p-4">
      <h2 className="app-section-title">What this corpus does not cover</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-foreground/90">
        <li>
          <strong>
            {analysedPct}% of collected articles have been analyzed
          </strong>{" "}
          ({s.analyzed_articles.toLocaleString("en-GB")} out of{" "}
          {s.total_articles.toLocaleString("en-GB")}). Every aggregate rating
          describes the analyzed subset, not the entire flow.
        </li>
        {botRefused > 0 ? (
          <li>
            <strong>
              {botRefused}{" "}
              {botRefused === 1 ? "outlet refuses" : "outlets refuse"} bot
              crawling.
            </strong>{" "}
            We respect that refusal and do not collect new articles from them.
          </li>
        ) : null}
        {captcha > 0 ? (
          <li>
            <strong>
              {captcha} {captcha === 1 ? "outlet requires" : "outlets require"}{" "}
              solving a CAPTCHA.
            </strong>{" "}
            We do not solve CAPTCHAs, so those outlets are absent.
          </li>
        ) : null}
        {outletsMissing ? (
          <li>
            <strong>The source directory could not be loaded.</strong> This page
            cannot show which outlets were removed from crawling and why.
          </li>
        ) : null}
        <li>
          <strong>Television and radio are not included.</strong> Only published
          text is collected.
        </li>
        <li>
          <strong>Some articles have no publication date.</strong> When an
          outlet does not state one, collection time determines their order.
        </li>
      </ul>
    </Card>

    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Figure
        value={s.total_articles.toLocaleString("en-GB")}
        label="collected articles"
      />
      <Figure
        value={s.analyzed_articles.toLocaleString("en-GB")}
        label="analyzed"
      />
      <Figure value={String(s.domains)} label="sources" />
      <Figure value={String(s.stories)} label="stories" />
    </div>

    <Section title="The two axes">
      <p>
        We rate the <strong>framing of the individual article</strong>, not the
        outlet's editorial line: source selection, attributed motives, and who
        receives the last word.
      </p>
      <div className="space-y-4 pt-1">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide">
            Political framing
          </h3>
          <ScaleLegend order={LEANING_ORDER} meta={LEANING_META_EN} />
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide">
            Stance toward Russia
          </h3>
          <ScaleLegend order={RUSSIA_ORDER} meta={RUSSIA_META_EN} />
          <p className="mt-2 text-sm">
            This is a separate axis because it does not coincide with left and
            right in the Bulgarian context. It applies only when an article
            refers to Russia.
          </p>
        </div>
      </div>
      <p>
        <strong>
          “Outside the political axis” and “Russia not mentioned” are the most
          common results.
        </strong>{" "}
        That does not mean an article is impartial; it means the rubric is not
        applicable. “No clear framing” is different: the axis applies, but the
        text does not show clear progressive or conservative framing.
      </p>
      <p>
        Each rating carries supporting evidence. Raw model confidence appears
        only as a caveated technical detail; it is not a calibrated probability
        that the finding is true. On the English page, untranslated Bulgarian
        evidence is withheld so the two languages are not mixed in one
        interface.
      </p>
    </Section>

    <Section id="outlet-transparency" title="Source transparency">
      <p>
        When a verified registered-owner record exists, we show the name,
        registry, and lookup date. This is not a claim about actual control,
        ultimate beneficial ownership, or editorial independence.
      </p>
      <p>
        <strong>Outlet funding is not collected.</strong> As of{" "}
        {formatDate(FUNDING_TRANSPARENCY_COVERAGE.documentedAt, "en")}, this
        dataset does not verify funding models, advertising, or sponsorship by
        outlet. Profiles therefore show the corpus-wide state “Not collected,”
        not “checked — no disclosure.” This is a coverage boundary, not a trust
        rating.
      </p>
    </Section>

    <Section title="What we do not do">
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          <strong>We do not rate the truth of claims.</strong> We have no “fake
          news” label and no fact-checking operation.
        </li>
        <li>
          <strong>We do not give an outlet one overall score.</strong> We show
          separate measures and their evidence base.
        </li>
        <li>
          <strong>
            We do not link a name when it matches more than one person.
          </strong>{" "}
          A wrong link is worse than a missing link.
        </li>
        <li>
          <strong>
            We do not bypass CAPTCHAs or impersonate a human browser.
          </strong>{" "}
          Sites that refuse bots are not collected.
        </li>
        <li>
          <strong>
            Image delivery and permission to display it are different.
          </strong>{" "}
          Rights basis, author, credit, and verification are recorded separately
          for each image.
        </li>
      </ul>
    </Section>

    <Section title="How collection works">
      <p>
        We collect publicly accessible outlet pages while respecting{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">robots.txt</code>{" "}
        and its stated crawl rate. The crawler identifies itself and links to
        the project; it does not impersonate a human browser.
      </p>
      <p>
        <strong>Full article text is not republished.</strong> The app shows a
        headline, short description, and analysis, then links to the original.
      </p>
      {retired.length > 0 ? (
        <div>
          <p className="mb-2">
            <strong>
              {retired.length}{" "}
              {retired.length === 1 ? "outlet has" : "outlets have"} been
              removed
            </strong>{" "}
            from crawling. Previously collected articles remain, but those
            outlets are not presented as active sources:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {retired.map((outlet) => (
              <li key={outlet.domain}>
                <span className="text-foreground">{outlet.outlet}</span> —{" "}
                {retirementReason(outlet.retired_reason, "en")}
                {outlet.article_count > 0
                  ? ` (${outlet.article_count} saved ${outlet.article_count === 1 ? "article" : "articles"})`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>

    <Section title="Model accuracy">
      <p>
        Measured accuracy against a manually reviewed set will appear here by
        field, together with how often the reviewing model contradicts itself.
      </p>
      <p className="text-muted-foreground">
        <strong>This evaluation has not been completed yet.</strong> Until the
        table exists, the page states that it is unavailable.
      </p>
    </Section>

    {/* See the Bulgarian note: moved here from the retired /about page. */}
    <Section id="editorial" title="What we publish">
      <p>
        We collect publicly available articles, group coverage of the same
        event, and compare headlines, sources, and analysis. The home page shows
        only analyzed stories whose selected image has a verified basis for
        reuse.
      </p>
    </Section>

    <Section id="person-pages" title="Pages about people">
      <p>
        A page about a person exists only after an editorial decision: an
        identity that has been reviewed and marked active. Being mentioned in an
        article does not create one. Each such page states how many (person,
        article) pairs are assessed out of every one where the person is a main
        or named participant, and what was left unassessed — text not read in
        full, not yet assessed, or not enough evidence. We show a short quote as
        grounds, never the full text of someone else&apos;s article.
      </p>
      <p className="mt-3">
        The full rules — who gets a page, what we do not publish, and how to ask
        for a correction or a right of reply — are in the{" "}
        <a
          className="app-link"
          href="https://github.com/atanasster/electionsbg/blob/main/docs/policies/news-person-pages.md"
          target="_blank"
          rel="noreferrer"
        >
          person-pages policy (news-person-policy-v1) ↗
        </a>
        .
      </p>
    </Section>

    <Section title="Editorial responsibility">
      <p>
        Initial assessments are generated automatically using a published
        rubric. An accepted editorial review may confirm, replace, withdraw, or
        send only marked fields for revalidation. Each displayed field names its
        source, and the model and analysis date appear with the article;
        editorial responsibility remains with the Naiasno team.
      </p>
    </Section>

    <Section title="Editorial principles">
      <ul className="list-disc space-y-2 pl-5">
        <li>We rate individual articles, not entire media outlets.</li>
        <li>
          We show rationale beside the assessment; raw model confidence is a
          caveated technical detail, not a probability of truth.
        </li>
        <li>We never present missing analysis as a neutral rating.</li>
        <li>We direct readers to the original publication and publisher.</li>
      </ul>
    </Section>

    <Section title="Ownership and funding">
      <p>
        The project is maintained by Martin Stoyanov and Atanas Stoyanov. As of
        28 August 2026, no verified disclosure of legal ownership, funding
        sources, advertising, sponsorship, or potential conflicts of interest
        has been published. Until such a disclosure exists, we do not claim
        institutional or financial independence.
      </p>
    </Section>

    <Section title="Corrections and right of reply">
      <p>
        A reader, author, or publisher may challenge a factual error, an
        incorrectly linked article, an image-rights issue, or an analytical
        rating. Include the exact URL and verifiable grounds. The team reviews
        the report; confirmed errors are corrected or withdrawn, and the change
        is dated. General feedback is reviewed as a report but does not by
        itself constitute a right of reply. A right-of-reply request must
        identify the affected person or organization, the disputed claim, and a
        factual response intended for publication. We do not promise a deadline
        we cannot reliably meet.
      </p>
      <p className="text-muted-foreground">
        Only a public GitHub channel is currently available; there is no private
        channel for sensitive evidence. This is a limitation of the current
        process.
      </p>
      <p className="flex flex-wrap gap-3 font-medium">
        <Link to="/corrections" className="text-primary hover:underline">
          Process and public register
        </Link>
        <a
          href="https://github.com/atanasster/electionsbg/issues"
          className="text-primary hover:underline"
        >
          Open a GitHub issue <span aria-hidden>↗</span>
        </a>
      </p>
    </Section>

    <p className="mt-8 text-xs text-muted-foreground">
      Taxonomy v{s.taxonomy_version} · last updated{" "}
      {formatDate(s.generated_at, "en")}
    </p>
  </section>
);
