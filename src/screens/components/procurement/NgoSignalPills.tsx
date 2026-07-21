// NGO public-interest signal pills — a thin, meta-driven wrapper over the shared
// SignalPillStrip. Renders the signal set computed by ngo_signal_row() (migration
// 080) as chips on the /procurement/ngos list and the NGO page. Every signal is a
// public-interest INDICATOR, never proof; `foreign_funded` is a NEUTRAL disclosure
// (slate, non-red). Phase 1 covers the public-money class; the connection class
// (politician/magistrate on the board) is added in Phase 2.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import {
  SignalPillStrip,
  type SignalPillItem,
} from "@/screens/components/procurement/SignalPillStrip";
import {
  NGO_SIGNAL_ORDER,
  NGO_SIGNAL_META,
  type NgoSignal,
} from "@/screens/components/procurement/ngoSignalMeta";

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
              {sig.firm ? ` · ${decodeEntities(sig.firm)}` : ""}
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
