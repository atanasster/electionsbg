/**
 * Empty-state hero for the AI chat (concept C). A Gemini-painted atmospheric
 * backdrop (light/dark variant, theme-swapped) with crisp mini answer-cards
 * floating on top and a short invite. Each card fires a representative query, so
 * the collage previews — and launches — the kinds of answers the chat gives.
 * Replaces the old two-line text filler; the composer is pinned below it.
 */
import { useContext } from "react";
import { ThemeContext } from "@/theme/ThemeContext";
import { themeDark } from "@/theme/utils";
import type { Lang } from "../../tools/types";
import heroLight from "../../assets/hero-bg-light.webp";
import heroDark from "../../assets/hero-bg-dark.webp";
import {
  MiniBarCard,
  MiniDonutCard,
  MiniHemicycleCard,
  MiniLineCard,
  MiniMapCard,
} from "./MiniCards";

export const EmptyHero = ({
  lang,
  onPick,
}: {
  lang: Lang;
  onPick: (q: string) => void;
}) => {
  const { theme } = useContext(ThemeContext);
  const t = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const bg = theme === themeDark ? heroDark : heroLight;
  const q = (bg: string, en: string) => () => onPick(lang === "bg" ? bg : en);

  return (
    <div className="relative isolate flex min-h-[360px] flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl border border-border/60">
      <img
        src={bg}
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full object-cover"
      />
      {/* scrim keeps cards + text legible over the painted backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-card/30 via-card/5 to-card/75"
      />

      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center gap-5 px-4 py-8 text-center">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-balance text-xl font-semibold text-foreground sm:text-2xl">
            {t(
              "Питайте за изборите, парите и властта",
              "Ask about elections, money and power",
            )}
          </h2>
          <p className="text-balance text-sm text-muted-foreground">
            {t(
              "Резултати, активност, партии, бюджет, депутати, местни избори — отговарям с числа от официалните данни.",
              "Results, turnout, parties, budget, MPs, local elections — answered with numbers from the official data.",
            )}
          </p>
        </div>

        <div className="flex w-full flex-wrap items-start justify-center gap-3 sm:gap-4">
          <MiniBarCard
            rotate={-3}
            title={t("Резултати", "Results")}
            source={t("Избори · ЦИК", "Elections · CEC")}
            ariaLabel={t(
              "Попитай за резултатите от последните избори",
              "Ask about the latest election results",
            )}
            onClick={q(
              "Какви са резултатите от последните избори?",
              "What are the results of the latest election?",
            )}
          />
          <MiniLineCard
            rotate={3}
            className="translate-y-3"
            title={t("Активност", "Turnout")}
            source={t("2005–2024", "2005–2024")}
            ariaLabel={t(
              "Попитай как се променя активността",
              "Ask how turnout has changed",
            )}
            onClick={q(
              "Как се променя избирателната активност от 2005 насам?",
              "How has voter turnout changed since 2005?",
            )}
          />
          <MiniMapCard
            rotate={-4}
            title={t("По области", "By region")}
            source={t("28 области", "28 regions")}
            ariaLabel={t(
              "Попитай за резултатите по области",
              "Ask about results by region",
            )}
            onClick={q(
              "Покажи резултатите по области.",
              "Show the results by region.",
            )}
          />
          <MiniHemicycleCard
            rotate={4}
            className="hidden translate-y-3 sm:block"
            title={t("Депутати", "Seats")}
            source={t("Народно събрание", "National Assembly")}
            ariaLabel={t(
              "Попитай колко места има всяка партия",
              "Ask how many seats each party holds",
            )}
            onClick={q(
              "Колко места има всяка партия в парламента?",
              "How many seats does each party hold in parliament?",
            )}
          />
          <MiniDonutCard
            rotate={-3}
            className="hidden sm:block"
            title={t("Бюджет", "Budget")}
            source={t("Министерство на финансите", "Ministry of Finance")}
            ariaLabel={t(
              "Попитай за държавния бюджет",
              "Ask about the state budget",
            )}
            onClick={q(
              "За какво се харчи държавният бюджет?",
              "What is the state budget spent on?",
            )}
          />
        </div>

        <p className="max-w-2xl text-balance text-xs text-muted-foreground">
          {t(
            "По подразбиране отговарям за последните избори; посочете година (напр. 2021), за да попитате за друг вот.",
            "I answer for the latest election by default; name a year (e.g. 2021) to ask about another.",
          )}
        </p>
      </div>
    </div>
  );
};
