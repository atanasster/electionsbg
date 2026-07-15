// "Какво се вижда и какво — не" — the МВР transparency caveat, made explicit.
// Day-to-day buying (patrol cars, fuel, uniforms, IT, buildings) flows through ЗОП
// and is in the corpus above; classified security procurement does NOT — weapons,
// surveillance/СРС, and part of the border-security tech are exempt under ЗОП Част
// четвърта / чл. 149 / чл. 13 (Art. 346 TFEU). This tile names the gap instead of
// letting the thin footprint read as "МВР barely buys surveillance". Mirrors
// DefenseTransparencyTile. See plan §7 tile 8 / §7b.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";

export const MvrTransparencyTile: FC<{ groupTotalEur: number }> = ({
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
            ? "Виждате патрулните коли, горивото и униформите. Не виждате наблюдението, СРС и класифицираната техника за сигурност."
            : "You can see the patrol cars, fuel and uniforms. You cannot see the surveillance, special intelligence means and classified security tech."}
        </p>

        {/* Visible vs invisible — a shown split, not an omission. The invisible
            share has no published € (classified), so it is drawn as an
            explicitly-labelled, non-measured band, not a fake number. */}
        <div className="flex h-9 overflow-hidden rounded-md border text-[11px] font-medium">
          <div
            className="flex items-center justify-center bg-primary/80 px-2 text-center text-primary-foreground"
            style={{ width: "45%" }}
          >
            {bg ? "Видимо в ЗОП" : "Visible in ЗОП"}
          </div>
          <div className="flex flex-1 items-center justify-center bg-[repeating-linear-gradient(45deg,hsl(var(--muted)),hsl(var(--muted))_7px,hsl(var(--muted-foreground)/0.18)_7px,hsl(var(--muted-foreground)/0.18)_14px)] px-2 text-center text-muted-foreground">
            {bg
              ? "Извън открита процедура — чл. 149 / чл. 13 ЗОП"
              : "Outside open procedure — чл. 149 / чл. 13 ЗОП"}
          </div>
        </div>

        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">
              {formatEurCompact(groupTotalEur, lang)}
            </span>{" "}
            {bg
              ? "договорена стойност през ЗОП от групата на МВР (коли, горива, ИТ, строителство, медицина)."
              : "contracted through ЗОП by the МВР group (vehicles, fuel, IT, construction, medical)."}
          </li>
          <li>
            {bg
              ? "Класифицираните доставки за сигурност се възлагат по Част четвърта на ЗОП (отбрана и сигурност) — ограничени/договаряни процедури с тайно избран изпълнител."
              : "Classified security buys are awarded under ЗОП Part Four (defence & security) — limited/negotiated procedures with a secretly-chosen contractor."}
          </li>
          <li>
            {bg
              ? "Поръчки, засягащи същественото на националната сигурност, изобщо не влизат в регистъра (чл. 13 ЗОП във вр. с чл. 346 ДФЕС)."
              : "Procurement touching essential national-security interests need not enter the register at all (чл. 13 ЗОП / Art. 346 TFEU)."}
          </li>
        </ul>
      </CardContent>
    </Card>
  );
};
