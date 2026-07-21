// NGO public-interest signal metadata — the ordering, per-code presentation meta,
// and payload types shared by NgoSignalPills and the dev browse/company screens.
// Split out of NgoSignalPills.tsx so that component file only exports a component
// (keeps react-refresh fast-refresh happy). Every signal is a public-interest
// INDICATOR, never proof; `foreign_funded` is a NEUTRAL disclosure (slate, non-red).

import { ReactNode } from "react";
import {
  Landmark,
  Scissors,
  Star,
  HandCoins,
  Globe,
  TrendingUp,
  Users,
  Scale,
  Briefcase,
} from "lucide-react";
import { type SignalTone } from "@/screens/components/procurement/SignalPill";

// One signal object as served by ngo_signals_for(eik) / the ngos_list `signals`.
export type NgoSignal = {
  code: string;
  class?: string;
  valueEur?: number | null;
  count?: number | null;
  share?: number | null;
  asOf?: string | number | null;
  detail?: string | null; // e.g. the connected person's name
  firm?: string | null; // related_party: the board member's own contractor firm
  confidence?: string | null;
};

export type NgoSignalMeta = {
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
  "related_party",
  "public_contracts",
  "single_bid",
  "eu_funds",
  "budget_subsidy",
  "foreign_funded",
  "large",
] as const;

export const NGO_SIGNAL_META: Record<string, NgoSignalMeta> = {
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
  related_party: {
    tone: "rose",
    icon: <Briefcase className={ICON} />,
    short: ["ngo_signal_related_party_short", "Свързана фирма"],
    long: [
      "ngo_signal_related_party_long",
      "Член на ръководството с фирма — обществен изпълнител",
    ],
    hint: [
      "ngo_signal_related_party_hint",
      "Лице от управата контролира фирма, която печели обществени поръчки — потенциален конфликт на интереси, следа, не доказателство.",
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
