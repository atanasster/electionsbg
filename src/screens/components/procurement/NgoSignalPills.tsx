// NGO public-interest signal pills — a thin, meta-driven wrapper over the shared
// SignalPillStrip. Renders the signal set computed by ngo_signal_row() (migration
// 080) as chips on the /procurement/ngos list and the NGO page. Every signal is a
// public-interest INDICATOR, never proof; `foreign_funded` is a NEUTRAL disclosure
// (slate, non-red). Phase 1 covers the public-money class; the connection class
// (politician/magistrate on the board) is added in Phase 2.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Landmark,
  Scissors,
  Star,
  HandCoins,
  Globe,
  TrendingUp,
  Users,
  Scale,
} from "lucide-react";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { type SignalTone } from "@/screens/components/procurement/SignalPill";
import {
  SignalPillStrip,
  type SignalPillItem,
} from "@/screens/components/procurement/SignalPillStrip";

// One signal object as served by ngo_signals_for(eik) / the ngos_list `signals`.
export type NgoSignal = {
  code: string;
  class?: string;
  valueEur?: number | null;
  count?: number | null;
  share?: number | null;
  asOf?: string | number | null;
  detail?: string | null; // e.g. the connected person's name
  confidence?: string | null;
};

type Meta = {
  tone: SignalTone;
  icon: ReactNode;
  short: [string, string]; // [i18n key, fallback]
  long: [string, string];
  hint: [string, string];
};

const ICON = "h-3 w-3";

// Ordered, so the strip renders deterministically regardless of payload order.
// Connection signals first (the differentiator), then the public-money class.
export const NGO_SIGNAL_ORDER = [
  "politician_board",
  "magistrate_board",
  "public_contracts",
  "single_bid",
  "eu_funds",
  "budget_subsidy",
  "foreign_funded",
  "large",
] as const;

export const NGO_SIGNAL_META: Record<string, Meta> = {
  politician_board: {
    tone: "violet",
    icon: <Users className={ICON} />,
    short: ["ngo_signal_politician_short", "Политик в ръководството"],
    long: [
      "ngo_signal_politician_long",
      "Политик или служител в ръководството",
    ],
    hint: [
      "ngo_signal_politician_hint",
      "Политически изложено лице (PEP) с това име е в управата — рискова категория по съвпадение на име, не обвинение.",
    ],
  },
  magistrate_board: {
    tone: "fuchsia",
    icon: <Scale className={ICON} />,
    short: ["ngo_signal_magistrate_short", "Магистрат в ръководството"],
    long: ["ngo_signal_magistrate_long", "Магистрат в ръководството"],
    hint: [
      "ngo_signal_magistrate_hint",
      "Магистрат с това име фигурира в управата — възможно съвпадение на име, следа, не доказателство.",
    ],
  },
  public_contracts: {
    tone: "teal",
    icon: <Landmark className={ICON} />,
    short: ["ngo_signal_contracts_short", "Обществени поръчки"],
    long: ["ngo_signal_contracts_long", "Печели обществени поръчки"],
    hint: [
      "ngo_signal_contracts_hint",
      "Организацията е изпълнител по договори с публични възложители.",
    ],
  },
  single_bid: {
    tone: "amber",
    icon: <Scissors className={ICON} />,
    short: ["ngo_signal_single_bid_short", "Един кандидат"],
    long: ["ngo_signal_single_bid_long", "Висок дял поръчки с един кандидат"],
    hint: [
      "ngo_signal_single_bid_hint",
      "Голяма част от спечелената стойност е по процедури с един подаден оферент.",
    ],
  },
  eu_funds: {
    tone: "emerald",
    icon: <Star className={ICON} />,
    short: ["ngo_signal_eu_funds_short", "Средства от ЕС"],
    long: ["ngo_signal_eu_funds_long", "Бенефициент по фондове на ЕС (ИСУН)"],
    hint: [
      "ngo_signal_eu_funds_hint",
      "Организацията изпълнява проекти, финансирани от европейските фондове.",
    ],
  },
  budget_subsidy: {
    tone: "emerald",
    icon: <HandCoins className={ICON} />,
    short: ["ngo_signal_subsidy_short", "Държавна субсидия"],
    long: ["ngo_signal_subsidy_long", "Получава държавна субсидия"],
    hint: [
      "ngo_signal_subsidy_hint",
      "Организацията е получател на субсидия от държавния бюджет.",
    ],
  },
  foreign_funded: {
    tone: "slate",
    icon: <Globe className={ICON} />,
    short: ["ngo_signal_foreign_short", "Външно финансиране"],
    long: ["ngo_signal_foreign_long", "Получава външно финансиране"],
    hint: [
      "ngo_signal_foreign_hint",
      "Информационен показател — абсолютна сума от чуждестранни донори, не оценка.",
    ],
  },
  large: {
    tone: "yellow",
    icon: <TrendingUp className={ICON} />,
    short: ["ngo_signal_large_short", "Голям бюджет"],
    long: ["ngo_signal_large_long", "Голям обем публични средства"],
    hint: [
      "ngo_signal_large_hint",
      "Общата публична сума (поръчки + ЕС + субсидии) надхвърля 1 млн. евро.",
    ],
  },
};

export const NgoSignalPills: FC<{
  signals: NgoSignal[] | null | undefined;
  /** List cell caps the strip; the page header shows all. */
  maxVisible?: number;
  emptyDash?: boolean;
}> = ({ signals, maxVisible, emptyDash = true }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const ordered = (signals ?? [])
    .filter((s) => NGO_SIGNAL_META[s.code])
    .sort(
      (a, b) =>
        NGO_SIGNAL_ORDER.indexOf(a.code as (typeof NGO_SIGNAL_ORDER)[number]) -
        NGO_SIGNAL_ORDER.indexOf(b.code as (typeof NGO_SIGNAL_ORDER)[number]),
    );

  const items: SignalPillItem[] = ordered.map((sig) => {
    const m = NGO_SIGNAL_META[sig.code];
    const value =
      sig.valueEur != null && sig.valueEur > 0
        ? formatEurCompact(sig.valueEur, lang)
        : sig.share != null
          ? `${Math.round(sig.share * 100)}%`
          : null;
    return {
      key: sig.code,
      tone: m.tone,
      icon: m.icon,
      label: t(m.short[0]) || m.short[1],
      tooltip: (
        <div className="space-y-1">
          <div className="font-medium">{t(m.long[0]) || m.long[1]}</div>
          <div className="text-xs text-muted-foreground">
            {t(m.hint[0]) || m.hint[1]}
          </div>
          {sig.detail ? (
            <div className="text-xs">
              {decodeEntities(sig.detail)}
              {sig.count != null && sig.count > 1 ? ` +${sig.count - 1}` : ""}
            </div>
          ) : null}
          {value ? (
            <div className="text-xs tabular-nums">
              {value}
              {sig.count != null ? ` · ${sig.count}` : ""}
              {sig.asOf ? ` · ${sig.asOf}` : ""}
            </div>
          ) : null}
        </div>
      ),
    };
  });

  return (
    <SignalPillStrip
      items={items}
      maxVisible={maxVisible}
      emptyDash={emptyDash}
    />
  );
};
