import { ARTICLE_CHAPTERS } from "../../../src/lib/flyover/programmes/tour";
import type { FlyoverState } from "../../../src/lib/flyover/state";
import type { ExplainerSpec } from "../lib/spec";

const chapterState = (id: string): Partial<FlyoverState> => {
  const chapter = ARTICLE_CHAPTERS.find((candidate) => candidate.id === id);
  if (!chapter) throw new Error(`Unknown flyover chapter: ${id}`);
  return chapter.state;
};

/**
 * E3 — four views of public money on the same Bulgaria flyover, plus an outro.
 *
 * The first four canvas states are the article's exact chapter states. Every
 * displayed figure comes from `video/src/generated/flyover.json`, which is an
 * asserted byte-for-byte copy of the home artifact. Voice-over carries no
 * digits; Gate 1 prints the written-out and displayed forms side by side.
 */
export const e3: ExplainerSpec<FlyoverState> = {
  slug: "2026-09-money-map",
  kind: "explainer",
  canvasKind: "flyover",
  runtimeSeconds: [60, 120],
  title: "Картата на парите: кой купува и къде отиват средствата",
  topic: "Обществени пари по области",
  period: "договори до 4 септември 2026",
  sourceLine:
    "Източници: АОП / ЦАИС ЕОП, ИСУН 2020, ДФ „Земеделие“ · naiasno.bg",
  link: "https://electionsbg.com/articles/2026-09-07-money-map",
  sources: [
    "data/home/flyover.json",
    "https://www2.aop.bg/e-uslugi/otvoreni-danni-ot-rop/",
    "https://2020.eufunds.bg/",
    "https://seu.dfz.bg/seu/f?p=727:8110:::NO",
  ],
  voice: {
    provider: "gemini",
    voiceId: "Rasalgethi",
    direction:
      "Read the following Bulgarian text as a calm, measured documentary narrator explaining something to an intelligent adult. Natural pacing, small pauses at commas and full stops, never rushed. Do not read this instruction aloud:",
  },
  scenes: [
    {
      id: 1,
      canvas: chapterState("buys"),
      kicker: "Къде купува държавата",
      stat: "56,6%",
      headline: "от сумата е при\nстолични възложители",
      body: "407 512 договора · по седалище на възложителя",
      voiceOver:
        "Започваме с четиристотин и седем хиляди петстотин и дванайсет договора. Петдесет и шест цяло и шест процента от сумата е при възложители със седалище в София. Това е мястото на купувача, не непременно мястото на работата.",
      onScreen: "407 512 · 56,6%",
      grounding: {
        file: "video/src/generated/flyover.json",
        path: "$.figures",
      },
    },
    {
      id: 2,
      canvas: chapterState("goes"),
      kicker: "Къде отиват парите",
      stat: "€43,9 млрд.",
      headline: "с двата края\nот €94,2 млрд.",
      body: "56,5% остават · 23,9% към София · 11,8% от София",
      voiceOver:
        "Към изпълнителя имаме двата края за четирийсет и три цяло и девет милиарда евро от деветдесет и четири цяло и две. В тази част петдесет и шест цяло и пет процента остават в областта, двайсет и три цяло и девет влизат в София, а единайсет цяло и осем излизат.",
      onScreen: "€43,9 млрд. / €94,2 млрд. · 56,5% · 23,9% · 11,8%",
      grounding: [
        {
          file: "video/src/generated/flyover.json",
          path: "$.flows.coverage",
          tokens: ["43,9", "94,2"],
        },
        {
          file: "video/src/generated/flyover.json",
          path: "$.figures",
          tokens: ["56,5", "23,9", "11,8"],
        },
      ],
    },
    {
      id: 3,
      canvas: chapterState("funds"),
      kicker: "Еврофондове срещу поръчки",
      stat: "€16,1 млрд.",
      headline: "имат област\nот €33,7 млрд.",
      body: "Малко под половината · слоевете не се събират",
      voiceOver:
        "Европейските фондове са отделен слой. Област имат шестнайсет цяло и един милиарда евро от общо трийсет и три цяло и седем. Това е малко под половината. Останалото често е национална програма, не грешка. Този слой не се събира с поръчките.",
      onScreen: "€16,1 млрд. / €33,7 млрд.",
      grounding: {
        file: "video/src/generated/flyover.json",
        path: "$.figures",
      },
    },
    {
      id: 4,
      canvas: chapterState("agri"),
      kicker: "Провинцията обръща картата",
      stat: "819 млн. €",
      headline: "Пловдив излиза\nнай-напред",
      body: "София 717 млн. € · Добрич 698 млн. €",
      voiceOver:
        "При земеделските субсидии картата се обръща. Пловдив е първи с осемстотин и деветнайсет милиона евро, следван от София със седемстотин и седемнайсет и Добрич с шестстотин деветдесет и осем. Софийската сума е висока и защото плащащата администрация е там.",
      onScreen: "819 · 717 · 698 млн. €",
      grounding: {
        file: "video/src/generated/flyover.json",
        path: "$.layers.all.agri",
      },
    },
    {
      id: 5,
      kicker: "Как да четем картата",
      headline: "Три слоя.\nТри различни основи.",
      body: "Възложител · проект · плащаща администрация",
      voiceOver:
        "Това не е един общ бюджет. Поръчките са по възложител, еврофондовете — по проект, а субсидиите — по плащане. На сайта можете да сменяте слоевете и да проверите източниците. Картата показва измереното и оставя неизвестното видимо.",
      onScreen: "electionsbg.com",
    },
  ],
};
