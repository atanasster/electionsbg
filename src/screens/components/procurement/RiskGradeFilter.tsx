// A–F risk-grade multi-select for the contracts toolbars. Drives the ?grade URL
// filter, which maps to the server-side `risk_grade` column (migration 112) —
// so this filters in Postgres over the whole corpus, not just the loaded page.
//
// A DropdownMenu with checkbox items rather than a Select: the dimension is
// multi-select (grade IN (D,E,F)), which a Select cannot express, and
// modal={false} keeps it from locking body scroll ([[feedback_no_radix_select_scroll_lock]]).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { GRADE_TONE, type RiskGradeLetter } from "@/lib/riskGrade";

const GRADES = Object.keys(GRADE_TONE) as RiskGradeLetter[];

export const RiskGradeFilter: FC<{
  value: RiskGradeLetter[];
  onChange: (v: RiskGradeLetter[]) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const label =
    value.length === 0
      ? t("company_contract_risk_grade_any") || "Оценка: всички"
      : `${t("company_contract_risk_grade") || "Оценка"}: ${[...value].sort().join(", ")}`;

  const toggle = (g: RiskGradeLetter) =>
    onChange(value.includes(g) ? value.filter((x) => x !== g) : [...value, g]);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
        {label}
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[9rem]">
        {GRADES.map((g) => (
          <DropdownMenuCheckboxItem
            key={g}
            checked={value.includes(g)}
            onCheckedChange={() => toggle(g)}
            // Radix closes on select by default; keep it open so a multi-select
            // does not cost one re-open per letter.
            onSelect={(e) => e.preventDefault()}
          >
            <span className="font-semibold tabular-nums">{g}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
