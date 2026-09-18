import type { Lang } from "../tools/types";

// Frozen 2026-09-11 snapshot. Sources: ai/toolgrad/{RESULTS.md,
// defaults/ROUTING_RESULTS.md,release/RESULTS.md}; keep fresh runs and replays separate.
export const ToolGradSection = ({ lang }: { lang: Lang }) => {
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const stages = [
    [t("Първо измерване", "Initial run"), "44/48", "32/48"],
    [
      t("Повторна проверка след поправките", "Replay after fixes"),
      "48/48",
      "48/48",
    ],
    [t("Нови контролни въпроси", "Fresh confirmation set"), "7/8", "7/8"],
    [
      t(
        "Контролните въпроси след поправката",
        "Confirmation replay after its fix",
      ),
      "8/8",
      "8/8",
    ],
    [
      t("Четири нови въпроса за поправката", "Four fresh targeted questions"),
      "4/4",
      "4/4",
    ],
  ];
  // Rendered inside a <details> on the evals page whose <summary> is the title,
  // so this section carries no heading or frame of its own.
  return (
    <section aria-label="ToolGrad" className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          "Измерено на 11 септември 2026 г. · Gemini 3.5 Flash-Lite · български и английски",
          "Measured 11 September 2026 · Gemini 3.5 Flash-Lite · Bulgarian and English",
        )}
      </p>
      <p className="max-w-3xl text-sm">
        {t(
          "Взехме една идея от ToolGrad: първо изпълняваме инструментите, после съставяме въпроси, чийто верен отговор вече знаем, и разглеждаме грешките. Използвахме я само за оценка — без дообучаване на модела и без оптимизатора на ToolGrad.",
          "We adapted an idea from ToolGrad: execute tools first, then create questions with verifiable expected results and review failures. This is an adapted evaluation method, without model fine-tuning or ToolGrad’s full optimizer.",
        )}
      </p>
      <ul className="max-w-3xl list-disc space-y-2 pl-5 text-sm">
        <li>
          {t(
            "„Пловдив“ означава града, освен ако изрично е казано „областта“. Следващите въпроси в разговора запазват същия географски обхват.",
            "“Plovdiv” means the city unless the province is explicit. Follow-up questions preserve the requested geographic scope.",
          )}
        </li>
        <li>
          {t(
            "„Общински трансфери“ означава сумите по вид трансфер. Разбивка или класация по общини показваме само ако е поискана изрично.",
            "“Municipal transfers” means totals by transfer type. Distribution or ranking by municipality requires an explicit request.",
          )}
        </li>
        <li>
          {t(
            "Проверяваме и крайния текст: за какво се отнася сумата, дали активността е сметната спрямо правилната база и дали не се споменават години, за които нямаме данни. Ако открием грешка, показваме шаблонен отговор с проверени данни.",
            "We also check the final text: what an amount refers to, the turnout denominator and unsupported years. Detected failures use a template answer with verified data.",
          )}
        </li>
      </ul>
      <div>
        <h4 className="font-title text-lg text-popover-foreground">
          {t("Избор на инструмент и параметри", "Tool and parameter selection")}
        </h4>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          {t(
            "В отделен тест с 50 нови въпроса отговорът на модела — преди нашите проверки — се подобри от 39 на 40 от 50, след като уточнихме тълкуванията по подразбиране (например че „Пловдив“ е градът). Със сегашните проверки и логиката за продължаване на разговора и двата варианта стигат 50 от 50. Това не е сравнение на стария и новия чат като цяло.",
            "In a separate test of 50 fresh questions, raw model calls improved from 39/50 to 40/50 after clarifying the defaults. With the same current validator and conversation rules, both variants reached 50/50. This is not an old-versus-new end-to-end chat comparison.",
          )}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="pb-3 text-left font-medium">
            {t(
              "Проверка на целия отговор · 60 въпроса общо (двата езика заедно)",
              "Full-answer validation · 60 question/language instances in total",
            )}
          </caption>
          <thead>
            <tr className="border-b-2">
              <th scope="col" className="whitespace-nowrap p-2">
                {t("Етап", "Stage")}
              </th>
              <th scope="col" className="whitespace-nowrap p-2">
                {t("Обхват и данни", "Scope and data")}
              </th>
              <th scope="col" className="whitespace-nowrap p-2">
                {t("Качество на отговора", "Full-answer quality")}
              </th>
            </tr>
          </thead>
          <tbody>
            {stages.map(([label, scope, quality]) => (
              <tr key={label} className="border-b">
                <th scope="row" className="p-2 font-medium">
                  {label}
                </th>
                <td className="whitespace-nowrap p-2 tabular-nums">{scope}</td>
                <td className="whitespace-nowrap p-2 tabular-nums">
                  {quality}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        {t(
          "Повторните пускания използват вече записаните отговори на модела с поправените инструменти, проверки и шаблони, затова не са нов независим тест. Първият резултат, 7 от 8, остава; четирите нови въпроса проверяват само конкретната поправка. „Качество“ включва верни данни, подкрепени твърдения, полезност и език.",
          "Replays reuse saved model responses with repaired tools, checks and templates; they are not fresh independent tests. The original 7/8 result is retained; the four new questions test that specific repair. Quality includes correct data, supported claims, usefulness and language.",
        )}
      </p>
      <p className="max-w-3xl text-sm text-muted-foreground">
        {t(
          "Проверките дали твърденията се подкрепят от данните вече минават 20 от 20 (преди поправките — 13 от 20). При повторната проверка 16 от 38 отговора с данни са по шаблон, а в 12-те нови въпроса три текста на модела бяха отхвърлени и заменени с шаблон. Това не са дялове от реалните разговори.",
          "Separate grounding checks improved from 13/20 to 20/20. In the primary replay, 16 of 38 data answers use templates. Across the 12 fresh confirmation and targeted questions, three generated texts were rejected and replaced with templates. These are not measured production fallback rates.",
        )}
      </p>
      <details className="rounded border p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          {t(
            "Метод, ограничения и първият опит",
            "Method, limitations and initial experiment",
          )}
        </summary>
        <div className="mt-3 max-w-3xl space-y-3 text-muted-foreground">
          <p>
            {t(
              "Първият опит — допълнение към инструкциите на модела (подканата), написано от грешките на тренировъчните въпроси — не си заслужаваше: точните извиквания върху контролните въпроси спаднаха от 33 на 31 от 36 и го отхвърлихме. Подобренията след това са конкретни поправки в избора на инструмент и в проверката на отговорите, а не доказателство, че ToolGrad подобрява чата като цяло.",
              "The first attempt — one addition to the model's instructions (the prompt), written from the failures on the development questions — did not justify release: exact calls on the held-out questions fell from 33 to 31 of 36, so it was rejected. Later gains are specific routing and answer-validation fixes, not evidence of a general ToolGrad improvement.",
            )}
          </p>
          <p>
            {t(
              "Данните в тези тестове са изкуствени (примерни). Въпросите и оценките са подготвени от AI агента, с който пишем кода; българската и английската версия на един въпрос не са независими, а наборът е малък. Изпитан е облачният модел, не моделите в браузъра. Промените са пуснати на 11 септември след проверка на живо на двата езика; следващото пускане трябва първо да мине през тестова среда с реални данни.",
              "The data in these tests is synthetic (example values). The coding agent authored the questions and judgments; the two language versions of a question are not independent, and the set is small. This tested the cloud model, not browser models. The changes went live on 11 September after live bilingual smoke tests; the next release should first pass a staging check with live data.",
            )}
          </p>
          <p className="break-words">
            {t("Файлове в хранилището:", "Repository evidence:")}{" "}
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
