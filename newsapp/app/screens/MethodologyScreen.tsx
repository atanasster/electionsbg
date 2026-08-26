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

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LEANING_META,
  LEANING_ORDER,
  RUSSIA_META,
  RUSSIA_ORDER,
  formatDate,
} from "../labels";
import { useOutlets, useStats, type Outlet } from "../data";

const Figure = ({ value, label }: { value: string; label: string }) => (
  <div>
    <div className="font-title text-2xl leading-tight">{value}</div>
    <div className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
      {label}
    </div>
  </div>
);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="mt-8">
    <h2 className="font-title text-xl">{title}</h2>
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
  const stats = useStats();
  const outlets = useOutlets();

  if (stats.error) {
    return (
      <section className="py-8">
        <h1 className="font-title text-3xl">Методология</h1>
        <Card className="mt-4 p-4 text-sm text-destructive">
          Данните за методологията не се заредиха: {stats.error.message}
        </Card>
      </section>
    );
  }
  if (!stats.data) {
    return (
      <section className="py-8">
        <h1 className="font-title text-3xl">Методология</h1>
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

  return (
    <section className="py-6">
      <h1 className="font-title text-3xl">Методология</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        Всяка статия се оценява поотделно. Не оценяваме медии — оценяваме
        материали, а позицията на едно издание е разпределението на неговите
        собствени материали.
      </p>

      {/* ⚠️ FIRST, and accent-bordered. A reader who meets the 8.4% after the
          figures has already read them as complete. */}
      <Card className="mt-6 border-primary p-4">
        <h2 className="font-title text-lg">Какво този корпус не покрива</h2>
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
              Политическа ос
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
            „Без пристрастие" и „Без позиция" са най-честите отговори, при това
            с голяма разлика.
          </strong>{" "}
          Повечето материали просто не заемат позиция по нито една от двете оси
          — репортажи, новини от чужбина, спорт. Това не е слабост на метода, но
          означава, че материалите с изразена позиция са малка част дори от
          анализираните. Разпределението на всяко издание се вижда на неговата
          страница.
        </p>
        <p>
          <strong>Всяка оценка носи цитат</strong> от самия материал и степен на
          увереност. Те се показват на страницата на статията, до етикета.
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
            <strong>Не публикуваме чужди снимки като свои.</strong> Всяка снимка
            се зарежда от сървъра на изданието и носи видим кредит към
            материала.
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

      <p className="mt-8 text-xs text-muted-foreground">
        Таксономия v{s.taxonomy_version} · последно обновяване{" "}
        {formatDate(s.generated_at)}
      </p>
    </section>
  );
};
