// МОН (Министерство на образованието и науката) sector pack — rendered inside
// the generic awarder dashboard (/awarder/000695114). Like the other packs it
// adds only the domain-unique tiles; the generic buy-side tiles (KPIs, top
// contracts/contractors, "Какво купува" by CPV, money-flow) sit above it.
//
// The differentiator is the education money МОН does NOT spend itself: the €51M
// textbook market, bought by 606 schools (not centrally), where two publisher
// groups — Klett (Анубис+Булвест) and Просвета — hold ~74%. See
// TextbookConcentrationTile + src/lib/textbookPublishers.ts.
//
// The textbook market is its own annual corpus (not the ministry's procurement
// scope), so it does NOT honour the host scope pill — it shows the full market.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GraduationCap, ArrowRight } from "lucide-react";
import type { ScopeWindow } from "@/data/procurement/useAwarderContracts";
import { useTextbookMarket } from "@/data/education/useTextbookMarket";
import { TextbookConcentrationTile } from "./TextbookConcentrationTile";

export const MonPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data: market, isLoading } = useTextbookMarket();

  if (isLoading)
    return (
      <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
    );
  if (!market) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pt-2">
        <GraduationCap className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Образование (МОН)" : "Education (МОН)"}
        </h2>
      </div>

      {/* The signature visual — framed by the OG card (data-og). */}
      <div data-og="textbook-treemap">
        <TextbookConcentrationTile market={market} />
      </div>

      <Link
        to="/education"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        {bg
          ? "Разгледай училищата и матурите"
          : "Explore schools & matura results"}
        <ArrowRight className="h-4 w-4" />
      </Link>

      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Пазарът на учебници е по данни от регистъра на обществените поръчки (АОП/ЦАИС ЕОП), код CPV 22112. Издателите са обединени по група (напр. Просвета обединява 3 юридически лица; Клет включва Анубис и Булвест 2000). Свободните учебници за 1–12 клас се купуват от самите училища, не централно от МОН."
          : "The textbook market is from the public-procurement register (CPV 22112). Publishers are rolled up by group (Prosveta merges 3 legal entities; Klett includes Anubis and Bulvest 2000). Free textbooks for grades 1–12 are bought by the schools themselves, not centrally by the ministry."}
      </p>
    </section>
  );
};
