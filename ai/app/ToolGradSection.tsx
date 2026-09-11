import type { Lang } from "../tools/types";

// Frozen 2026-09-11 snapshot. Sources: ai/toolgrad/{RESULTS.md,
// defaults/ROUTING_RESULTS.md,release/RESULTS.md}; keep fresh runs and replays separate.
export const ToolGradSection = ({ lang }: { lang: Lang }) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const stages = [
    [t("Първоначално изпълнение", "Initial run"), "44/48", "32/48"],
    [
      t("Локално преизпълнение след корекции", "Local replay after fixes"),
      "48/48",
      "48/48",
    ],
    [t("Нов контролен набор", "Fresh confirmation set"), "7/8", "7/8"],
    [
      t(
        "Локално преизпълнение на контролния набор след корекция",
        "Confirmation replay after its fix",
      ),
      "8/8",
      "8/8",
    ],
    [
      t("Четири нови целеви въпроса", "Four fresh targeted questions"),
      "4/4",
      "4/4",
    ],
  ];
  return (
    <section
      aria-labelledby="toolgrad-title"
      className="space-y-4 rounded border p-4 sm:p-6"
    >
      <div>
        <h2
          id="toolgrad-title"
          className="font-title text-2xl text-popover-foreground"
        >
          {t(
            "ToolGrad: подобрения при извикването на инструменти",
            "ToolGrad: tool-calling improvements",
          )}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "Измерено на 11 септември 2026 г. · Gemini 3.5 Flash-Lite · BG / EN",
            "Measured 11 September 2026 · Gemini 3.5 Flash-Lite · BG / EN",
          )}
        </p>
      </div>
      <p className="max-w-3xl text-sm">
        {t(
          "Използвахме идея от ToolGrad: първо изпълняваме инструментите, после създаваме въпроси с проверими очаквани резултати и анализираме грешките. Това е адаптиран метод за оценка, без дообучение на модел и без пълния оптимизатор на ToolGrad.",
          "We adapted an idea from ToolGrad: execute tools first, then create questions with verifiable expected results and review failures. This is an adapted evaluation method, without model fine-tuning or ToolGrad’s full optimizer.",
        )}
      </p>
      <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm">
        <li>
          {t(
            "„Пловдив“ означава града, освен ако изрично е посочена областта. Последващите въпроси запазват заявения географски обхват.",
            "“Plovdiv” means the city unless the province is explicit. Follow-up questions preserve the requested geographic scope.",
          )}
        </li>
        <li>
          {t(
            "„Общински трансфери“ означава суми по вид трансфер. Разпределение или класация по общини се избира при изрична заявка.",
            "“Municipal transfers” means totals by transfer type. Distribution or ranking by municipality requires an explicit request.",
          )}
        </li>
        <li>
          {t(
            "Проверяваме и крайния текст: към какво се отнася сумата, правилния знаменател на избирателната активност и неподкрепени години. При открита грешка показваме отговор по шаблон с проверени данни.",
            "We also check the final text: what an amount refers to, the turnout denominator and unsupported years. Detected failures use a template answer with verified data.",
          )}
        </li>
      </ul>
      <div>
        <h3 className="font-title text-lg text-popover-foreground">
          {t("Избор на инструмент и аргументи", "Tool and argument selection")}
        </h3>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          {t(
            "В отделен тест с 50 нови въпроса суровият отговор на модела се подобри от 39/50 на 40/50 след уточняване на правилата. С еднакъв текущ валидатор и разговорни правила и двата варианта постигнаха 50/50. Това не е сравнение на стария и новия чат от край до край.",
            "In a separate test of 50 fresh questions, raw model calls improved from 39/50 to 40/50 after clarifying the defaults. With the same current validator and conversation rules, both variants reached 50/50. This is not an old-versus-new end-to-end chat comparison.",
          )}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="pb-3 text-left font-medium">
            {t(
              "Проверка на целия отговор · 60 различни въпроса/езикови варианта",
              "Full-answer validation · 60 distinct question/language instances",
            )}
          </caption>
          <thead>
            <tr className="border-b-2">
              <th scope="col" className="p-2">
                {t("Етап", "Stage")}
              </th>
              <th scope="col" className="p-2">
                {t("Обхват и данни", "Scope and data")}
              </th>
              <th scope="col" className="p-2">
                {t("Качество на целия отговор", "Full-answer quality")}
              </th>
            </tr>
          </thead>
          <tbody>
            {stages.map(([label, scope, quality]) => (
              <tr key={label} className="border-b">
                <th scope="row" className="p-2 font-medium">
                  {label}
                </th>
                <td className="p-2 tabular-nums">{scope}</td>
                <td className="p-2 tabular-nums">{quality}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        {t(
          "Преизпълненията използват запазени отговори на модела с коригираните инструменти, проверки и шаблони — не са нов независим тест. Първоначалният резултат 7/8 е запазен; четирите нови въпроса проверяват конкретната поправка. Качеството включва правилни данни, подкрепени твърдения, полезност и език.",
          "Replays reuse saved model responses with repaired tools, checks and templates; they are not fresh independent tests. The original 7/8 result is retained; the four new questions test that specific repair. Quality includes correct data, supported claims, usefulness and language.",
        )}
      </p>
      <p className="max-w-3xl text-sm text-muted-foreground">
        {t(
          "Отделните проверки за подкрепени твърдения се подобриха от 13/20 на 20/20. При преизпълнението 16 от 38 отговора с данни използват шаблон. В 12-те нови контролни и целеви въпроса три генерирани текста бяха отхвърлени и заменени с шаблон. Това не са измерени дялове в реалния трафик.",
          "Separate grounding checks improved from 13/20 to 20/20. In the primary replay, 16 of 38 data answers use templates. Across the 12 fresh confirmation and targeted questions, three generated texts were rejected and replaced with templates. These are not measured production fallback rates.",
        )}
      </p>
      <details className="rounded border p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          {t(
            "Метод, ограничения и първоначален експеримент",
            "Method, limitations and initial experiment",
          )}
        </summary>
        <div className="mt-3 max-w-3xl space-y-3 text-muted-foreground">
          <p>
            {t(
              "Първият експеримент с допълнение към подканата не оправда внедряване: точните извиквания върху отделения набор спаднаха от 33/36 на 31/36. Допълнението беше отхвърлено. По-късните подобрения са конкретни поправки в маршрутизацията и проверката на отговорите, а не доказателство за общо подобрение от ToolGrad.",
              "The initial prompt-appendix experiment did not justify promotion: exact calls on the held-out set fell from 33/36 to 31/36. The appendix was rejected. Later gains are specific routing and answer-validation repairs, not evidence of a general ToolGrad improvement.",
            )}
          </p>
          <p>
            {t(
              "Числовите данни са измислени тестови стойности. Въпросите и оценките са изготвени от програмния AI агент; езиковите двойки са свързани, а наборът е малък. Проверен е облачният доставчик, не моделите в браузъра. Препоръката към датата на измерването е проверка в тестова среда през нормалната автентикация, прокси и браузър с реални данни преди публично внедряване.",
              "Numerical inputs are fictional fixtures. The coding agent authored the questions and judgments; language pairs are correlated and the suite is small. This tested the cloud provider, not browser models. At the measurement date, the recommendation is staging validation through normal authentication, proxy and browser with live data before public deployment.",
            )}
          </p>
          <p className="break-words">
            {t("Архив в хранилището:", "Repository evidence:")}{" "}
            <code>ai/toolgrad/release/RESULTS.md</code> ·{" "}
            <code>ai/toolgrad/defaults/ROUTING_RESULTS.md</code> ·{" "}
            <code>data/ai/toolgrad/release/final-review.json</code>
          </p>
          <a
            className="text-primary underline underline-offset-4"
            href="https://research.google/blog/toolgrad-efficient-tool-use-dataset-generation-with-textual-gradients/"
          >
            {t("ToolGrad — Google Research", "ToolGrad — Google Research")}
          </a>
        </div>
      </details>
    </section>
  );
};
