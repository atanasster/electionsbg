// „Кой решава" — the current НФЦ национални художествени комисии, the panels that
// score which film projects get state money. The plan's headline differentiator
// (§6): nobody else publishes this. Purely factual — who sits on each commission,
// drawn by lottery for a 6-month mandate — with NO claim about their decisions
// (the defamation-safe half of tile 9; the conflict lens 9b is out of scope).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Gavel } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useCultureCommissions } from "@/data/culture/useCulture";
import type { Commission, CommissionMember } from "@/data/culture/types";

// EN labels for the register sections (чл. 15 ЗФИ); fall back to the BG term.
const SECTION_EN: Record<string, string> = {
  Режисьори: "Directors",
  Продуценти: "Producers",
  Сценаристи: "Screenwriters",
  Актьори: "Actors",
  Кинокритици: "Film critics",
  Оператори: "Cinematographers",
  "Художник-постановчици в анимационното кино": "Production designers",
};

const fmtDate = (iso: string, bg: string): string => {
  const [y, m, d] = iso.split("-");
  return bg ? `${d}.${m}.${y}` : `${d}/${m}/${y}`;
};

const MemberRow: FC<{ m: CommissionMember; bg: boolean }> = ({ m, bg }) => (
  <li className="flex items-start justify-between gap-2 py-1">
    <div className="min-w-0">
      <div
        className={`truncate text-sm ${m.role === "chair" ? "font-semibold" : ""}`}
      >
        {m.name}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {m.role === "chair" && (
          <span className="mr-1 font-medium text-primary">
            {bg ? "председател ·" : "chair ·"}
          </span>
        )}
        {bg ? m.section : (SECTION_EN[m.section] ?? m.section)}
      </div>
    </div>
    <span
      className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${
        m.status === "titular"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground"
      }`}
      title={
        m.status === "titular"
          ? bg
            ? "титулярен експерт"
            : "full expert"
          : bg
            ? "резервен експерт"
            : "reserve expert"
      }
    >
      {m.status === "titular"
        ? bg
          ? "титуляр"
          : "full"
        : bg
          ? "резервен"
          : "reserve"}
    </span>
  </li>
);

const CommissionCol: FC<{ c: Commission; bg: boolean }> = ({ c, bg }) => (
  <div className="rounded-lg border border-border/60 p-3">
    <h3 className="mb-1 text-sm font-semibold">{bg ? c.bg : c.en}</h3>
    <ul className="divide-y divide-border/50">
      {c.members.map((m) => (
        <MemberRow key={m.name} m={m} bg={bg} />
      ))}
    </ul>
  </div>
);

export const CultureCommissionsTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useCultureCommissions();
  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Gavel className="h-4 w-4" />
          {bg ? "Кой решава за филмовите пари" : "Who decides the film money"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <p className="mb-3 text-sm text-muted-foreground">
          {bg
            ? `Националните художествени комисии оценяват кои проекти получават държавна субсидия. Съставите се теглят чрез жребий (${fmtDate(data.lotteryDate, "bg")}) за мандат ${fmtDate(data.mandateStart, "bg")} – ${fmtDate(data.mandateEnd, "bg")}.`
            : `The national artistic commissions score which projects get a state subsidy. Their members are drawn by lottery (${fmtDate(data.lotteryDate, "en")}) for the ${fmtDate(data.mandateStart, "en")} – ${fmtDate(data.mandateEnd, "en")} mandate.`}
        </p>

        <div className="grid gap-3 md:grid-cols-3">
          {data.commissions.map((c) => (
            <CommissionCol key={c.id} c={c} bg={bg} />
          ))}
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground/80">
          {bg ? data.note.bg : data.note.en}{" "}
          <a
            href={data.orderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {data.order}
          </a>
        </p>
      </CardContent>
    </Card>
  );
};
