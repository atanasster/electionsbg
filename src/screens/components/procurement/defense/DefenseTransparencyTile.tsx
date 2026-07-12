// "Какво се вижда и какво не" — the defining defense caveat, made explicit.
// Sustainment (engines, overhauls, fuel, logistic support) flows through ЗОП and
// is in the corpus above; acquisition of major platforms does NOT — F-16 and
// Stryker are US Foreign Military Sales (government-to-government, only a
// ratification law), and weapons/ammunition/intelligence are exempt under ЗОП
// чл. 148–149. This tile names the gap instead of letting the thin acquisition
// footprint read as "МО barely buys weapons". See plan §Part-2/§Part-10c.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";

export const DefenseTransparencyTile: FC<{ groupTotalEur: number }> = ({
  groupTotalEur,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  return (
    <Card id="transparency">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          {bg
            ? "Какво се вижда и какво — не"
            : "What is visible, and what is not"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3 text-sm">
        <p className="font-medium leading-snug">
          {bg
            ? "Виждате какво струва поддръжката на остаряващата техника. Не виждате какво струва подмяната ѝ."
            : "You can see what it costs to sustain the ageing fleet. You cannot see what it costs to replace it."}
        </p>

        {/* Visible vs invisible — a shown split, not an omission. The invisible
            share has no published € (FMS terms are classified), so it is drawn
            as an explicitly-labelled, non-measured band, not a fake number. */}
        <div className="flex h-9 overflow-hidden rounded-md border text-[11px] font-medium">
          <div
            className="flex items-center justify-center bg-primary/80 px-2 text-center text-primary-foreground"
            style={{ width: "38%" }}
          >
            {bg ? "Видимо в ЗОП" : "Visible in ЗОП"}
          </div>
          <div className="flex flex-1 items-center justify-center bg-[repeating-linear-gradient(45deg,hsl(var(--muted)),hsl(var(--muted))_7px,hsl(var(--muted-foreground)/0.18)_7px,hsl(var(--muted-foreground)/0.18)_14px)] px-2 text-center text-muted-foreground">
            {bg
              ? "Извън открита процедура — US FMS, чл. 149 ЗОП"
              : "Outside open procedure — US FMS, чл. 149 ЗОП"}
          </div>
        </div>

        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">
              {formatEurCompact(groupTotalEur, lang)}
            </span>{" "}
            {bg
              ? "договорена стойност през ЗОП от групата на МО (поддръжка, горива, техника, медицина)."
              : "contracted through ЗОП by the МО group (sustainment, fuel, equipment, medical)."}
          </li>
          <li>
            {bg
              ? "F-16 (~2,6 млрд $) и Stryker (~1,38 млрд $) са междудържавни сделки (US FMS) — без конкурентна процедура в ЦАИС ЕОП, само ратификационен закон."
              : "F-16 (~$2.6bn) and Stryker (~$1.38bn) are government-to-government (US FMS) — no competitive ЦАИС ЕОП record, only a ratification law."}
          </li>
          <li>
            {bg
              ? "Оръжие, боеприпаси и разузнаване са изключени от ЗОП по чл. 148–149 (Дир. 2009/81/ЕО)."
              : "Weapons, ammunition and intelligence are exempt from ЗОП under чл. 148–149 (EU Dir. 2009/81/EC)."}
          </li>
        </ul>
      </CardContent>
    </Card>
  );
};
