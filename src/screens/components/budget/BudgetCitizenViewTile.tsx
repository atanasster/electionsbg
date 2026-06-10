// "Per €100 of state revenue / expenditure" — the citizen-friendly framing:
// scale the latest December КФП snapshot to a €100 base on each side and list
// the largest buckets in plain language. Designed to be skimmable in seconds:
// no charts, fixed bucket set, every row sums to €100.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Coins, Landmark, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { cn } from "@/lib/utils";
import { useKfp } from "@/data/budget/useBudget";
import type { KfpSnapshot, KfpSnapshotLine } from "@/data/budget/types";

// Q1 of an in-progress year is too seasonal to use as the composition base
// (corporate tax true-up arrives at year-end, capital spending back-loaded,
// etc.). Prefer a complete December snapshot; fall back to prior year.
const pickSnapshot = (
  snapshots: KfpSnapshot[],
  fiscalYear: number,
): KfpSnapshot | null => {
  const decAtFy = snapshots.find(
    (s) => s.fiscalYear === fiscalYear && s.period.endsWith("-12"),
  );
  if (decAtFy) return decAtFy;
  const priorDec = snapshots
    .filter((s) => s.fiscalYear < fiscalYear && s.period.endsWith("-12"))
    .reduce<KfpSnapshot | null>(
      (latest, s) =>
        latest == null || s.fiscalYear > latest.fiscalYear ? s : latest,
      null,
    );
  return priorDec;
};

interface Bucket {
  key: string;
  labelBg: string;
  labelEn: string;
  amount: number;
}

const sumLines = (
  lines: KfpSnapshotLine[],
  pred: (l: KfpSnapshotLine) => boolean,
): number => {
  let total = 0;
  for (const l of lines) {
    if (!pred(l)) continue;
    const v = l.executed?.amountEur;
    if (typeof v === "number") total += v;
  }
  return total;
};

const buildRevenueBuckets = (snap: KfpSnapshot): Bucket[] => {
  const revenue = snap.sections.find((s) => s.code === "I");
  if (!revenue) return [];
  const lines = revenue.lines;

  // Tax leaves under "Данъчни приходи" — pull the named big ones explicitly,
  // sum the rest into "Other taxes". The labelBg matches are stable strings
  // the КФП publishes year to year.
  const findTax = (needle: string) =>
    lines.find(
      (l) =>
        l.depth === 1 &&
        !l.isSubtotal &&
        l.groupLabelBg?.startsWith("Данъчни") &&
        l.labelBg.includes(needle),
    );

  const vat = findTax("добавената стойност");
  const pit = findTax("доходите на физически");
  const excise = lines.find(
    (l) =>
      l.depth === 1 &&
      !l.isSubtotal &&
      l.groupLabelBg?.startsWith("Данъчни") &&
      l.labelBg.startsWith("Акцизи"),
  );
  const corp = findTax("Корпоративен");

  const namedTaxes = [vat, pit, excise, corp].filter(
    (x): x is KfpSnapshotLine => Boolean(x),
  );
  const namedKeys = new Set(namedTaxes.map((l) => l.labelBg));
  const otherTaxes = sumLines(
    lines,
    (l) =>
      l.depth === 1 &&
      !l.isSubtotal &&
      Boolean(l.groupLabelBg?.startsWith("Данъчни")) &&
      !namedKeys.has(l.labelBg),
  );

  const nonTax = lines.find(
    (l) => l.depth === 0 && l.isSubtotal && l.labelBg.startsWith("Неданъчни"),
  );
  const grants = lines.find(
    (l) => l.depth === 0 && !l.isSubtotal && l.labelBg.startsWith("Помощи"),
  );

  const buckets: Bucket[] = [];
  const add = (
    key: string,
    labelBg: string,
    labelEn: string,
    amount: number | undefined,
  ) => {
    if (typeof amount === "number" && amount > 0)
      buckets.push({ key, labelBg, labelEn, amount });
  };

  add("vat", "ДДС", "VAT", vat?.executed?.amountEur);
  add(
    "pit",
    "Данък върху доходите на физическите лица",
    "Personal income tax",
    pit?.executed?.amountEur,
  );
  add("excise", "Акцизи", "Excise duties", excise?.executed?.amountEur);
  add("corp", "Корпоративен данък", "Corporate tax", corp?.executed?.amountEur);
  add("otherTax", "Други данъци", "Other taxes", otherTaxes);
  add(
    "nonTax",
    "Неданъчни приходи (такси, дивиденти, БНБ)",
    "Non-tax revenue (fees, dividends, BNB)",
    nonTax?.executed?.amountEur,
  );
  add(
    "grants",
    "Помощи и дарения (вкл. ЕС)",
    "Grants and donations (incl. EU)",
    grants?.executed?.amountEur,
  );

  return buckets.sort((a, b) => b.amount - a.amount);
};

const buildExpenditureBuckets = (snap: KfpSnapshot): Bucket[] => {
  const expense = snap.sections.find((s) => s.code === "II");
  const euCont = snap.sections.find((s) => s.code === "III");
  if (!expense) return [];
  const lines = expense.lines;

  // Direct expenses live as depth-1 leaves under "Разходи".
  const direct = (needle: string) =>
    lines.find(
      (l) =>
        l.depth === 1 &&
        !l.isSubtotal &&
        l.groupLabelBg === "Разходи" &&
        l.labelBg.startsWith(needle),
    );
  // Interest is a depth-1 subtotal under Разходи (has children depth-2).
  const interestLine = lines.find(
    (l) =>
      l.depth === 1 &&
      l.isSubtotal &&
      l.groupLabelBg === "Разходи" &&
      l.labelBg.startsWith("Лихви"),
  );

  const personnel = direct("Персонал");
  const operations = direct("Издръжка");
  const social = direct("Социални разходи");
  const subsidies = direct("Субсидии");
  const capital = direct("Капиталови");

  // Transfer recipients live as depth-2 leaves under "Предоставени на:".
  const transferTo = (needle: string) =>
    lines.find(
      (l) =>
        l.depth === 2 &&
        !l.isSubtotal &&
        l.groupLabelBg?.startsWith("Трансфери") &&
        l.labelBg.includes(needle),
    );
  const toSocial = transferTo("Социалноосигурителни");
  const toMunicipalities = transferTo("Общини");
  const toAcademia = lines.find(
    (l) =>
      l.depth === 2 &&
      !l.isSubtotal &&
      l.groupLabelBg?.startsWith("Трансфери") &&
      l.labelBg.includes("ДВУ"),
  );

  const namedTransferKeys = new Set(
    [toSocial, toMunicipalities, toAcademia]
      .filter((x): x is KfpSnapshotLine => Boolean(x))
      .map((l) => l.labelBg),
  );
  const otherTransfers = sumLines(
    lines,
    (l) =>
      l.depth === 2 &&
      !l.isSubtotal &&
      Boolean(l.groupLabelBg?.startsWith("Трансфери")) &&
      !namedTransferKeys.has(l.labelBg),
  );

  const buckets: Bucket[] = [];
  const add = (
    key: string,
    labelBg: string,
    labelEn: string,
    amount: number | undefined,
  ) => {
    if (typeof amount === "number" && amount > 0)
      buckets.push({ key, labelBg, labelEn, amount });
  };

  add(
    "toSocial",
    "Пенсии и осигуровки (ДОО, НЗОК)",
    "Pensions and social security",
    toSocial?.executed?.amountEur,
  );
  add(
    "personnel",
    "Заплати в държавния сектор",
    "Public-sector salaries",
    personnel?.executed?.amountEur,
  );
  add(
    "toMunicipalities",
    "Трансфери към общини",
    "Transfers to municipalities",
    toMunicipalities?.executed?.amountEur,
  );
  add(
    "operations",
    "Издръжка (текущи разходи)",
    "Operating costs",
    operations?.executed?.amountEur,
  );
  add(
    "capital",
    "Капиталови разходи (инвестиции)",
    "Capital investment",
    capital?.executed?.amountEur,
  );
  add(
    "social",
    "Социални разходи и стипендии",
    "Social benefits and scholarships",
    social?.executed?.amountEur,
  );
  add("subsidies", "Субсидии", "Subsidies", subsidies?.executed?.amountEur);
  add(
    "toAcademia",
    "Университети, БАН, БНТ, БНР",
    "Universities, academia, public media",
    toAcademia?.executed?.amountEur,
  );
  add(
    "interest",
    "Лихви по държавния дълг",
    "Interest on public debt",
    interestLine?.executed?.amountEur,
  );
  add("otherTransfers", "Други трансфери", "Other transfers", otherTransfers);
  add(
    "euCont",
    "Вноска в бюджета на ЕС",
    "EU budget contribution",
    euCont?.executed?.amountEur,
  );

  return buckets.sort((a, b) => b.amount - a.amount);
};

const Side: FC<{
  title: string;
  asOf: string;
  buckets: Bucket[];
  total: number;
  lang: "bg" | "en";
  tone: "revenue" | "expense";
  icon: typeof Coins;
}> = ({ title, asOf, buckets, total, lang, tone, icon: Icon }) => {
  const { t } = useTranslation();
  if (total <= 0) return null;
  const isRev = tone === "revenue";
  const tonedFigure = isRev
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-rose-700 dark:text-rose-400";
  const tonedBar = isRev ? "bg-emerald-500/70" : "bg-rose-500/70";

  // Scale every bucket to €100; rounding error rolls into the smallest row so
  // the column literally adds to €100 on screen.
  const scaled = buckets.map((b) => ({
    ...b,
    per100: (b.amount / total) * 100,
  }));
  let rounded = scaled.map((b) => ({
    ...b,
    per100Rounded: Math.round(b.per100 * 10) / 10,
  }));
  const drift = 100 - rounded.reduce((s, b) => s + b.per100Rounded, 0);
  if (Math.abs(drift) > 0.001 && rounded.length > 0) {
    const smallestIdx = rounded.reduce(
      (best, b, i, arr) =>
        b.per100Rounded < arr[best].per100Rounded ? i : best,
      0,
    );
    rounded = rounded.map((b, i) =>
      i === smallestIdx
        ? {
            ...b,
            per100Rounded: Math.round((b.per100Rounded + drift) * 10) / 10,
          }
        : b,
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("h-4 w-4", tonedFigure)} />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        {(t("budget_citizen_asof") || "Latest complete year") + ` · ${asOf}`}
      </p>
      <ul className="space-y-1.5">
        {rounded.map((b) => {
          const label = lang === "bg" ? b.labelBg : b.labelEn;
          const widthPct = Math.min(100, b.per100);
          return (
            <li key={b.key} className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate" title={label}>
                  {label}
                </span>
                <span
                  className={cn(
                    "tabular-nums font-semibold shrink-0",
                    tonedFigure,
                  )}
                >
                  €{b.per100Rounded.toFixed(1)}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={cn("h-full", tonedBar)}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export const BudgetCitizenViewTile: FC<{ fiscalYear: number }> = ({
  fiscalYear,
}) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { data: kfp } = useKfp();

  const data = useMemo(() => {
    if (!kfp) return null;
    const snap = pickSnapshot(kfp.snapshots, fiscalYear);
    if (!snap) return null;
    const revenueBuckets = buildRevenueBuckets(snap);
    const expenseBuckets = buildExpenditureBuckets(snap);
    const revTotal = revenueBuckets.reduce((s, b) => s + b.amount, 0);
    const expTotal = expenseBuckets.reduce((s, b) => s + b.amount, 0);
    return { snap, revenueBuckets, expenseBuckets, revTotal, expTotal };
  }, [kfp, fiscalYear]);

  if (!data || (data.revTotal <= 0 && data.expTotal <= 0)) return null;

  return (
    <Card className="my-4" data-og="budget-citizen-view">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Coins className="h-4 w-4" />
          {t("budget_citizen_title") || "For every €100"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("budget_citizen_subtitle") ||
            "Where the state's revenue comes from and where its spending goes, scaled so each side sums to €100."}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
          <Side
            title={
              t("budget_citizen_revenue_side") || "For every €100 collected"
            }
            asOf={data.snap.asOf}
            buckets={data.revenueBuckets}
            total={data.revTotal}
            lang={lang}
            tone="revenue"
            icon={Coins}
          />
          <Side
            title={t("budget_citizen_expense_side") || "For every €100 spent"}
            asOf={data.snap.asOf}
            buckets={data.expenseBuckets}
            total={data.expTotal}
            lang={lang}
            tone="expense"
            icon={Landmark}
          />
        </div>
        <div className="mt-4 border-t pt-3 flex flex-col gap-1.5">
          <Link
            to="/budget/tax-calculator"
            className="text-primary hover:underline inline-flex items-center gap-1 text-xs"
          >
            {t("budget_citizen_tax_calc_link") ||
              "What did your taxes buy? Open the tax calculator"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/budget/simulator"
            className="text-primary hover:underline inline-flex items-center gap-1 text-xs"
          >
            {t("budget_citizen_policy_sim_link") ||
              "What if a tax rate changes? Open the policy simulator"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
};
