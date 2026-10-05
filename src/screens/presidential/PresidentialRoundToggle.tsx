// The „1-и тур / 2-и тур" switch for the presidential place pages — the same control, the same
// `pollRound` URL parameter and the same default the country page uses, so a reader who picked
// the runoff keeps it as they drill down from the country map into an oblast and a município.
//
// ⚠ ROUND 1 IS THE DEFAULT, and that is the constitutional order rather than a preference:
// art. 93 (3) is a test on round 1. ⚠ An unavailable round resolves to round 1, so a link
// carrying `pollRound=2` into a place with no runoff ballot never selects a round that is not
// there.

import { FC } from "react";
import { useTranslation } from "react-i18next";

/** ⚠ RENDERS NOTHING FOR A SINGLE ROUND — a disabled „2-и тур" offers a round that did not
 *  happen. */
export const PresidentialRoundToggle: FC<{
  rounds: readonly (1 | 2)[];
  round: 1 | 2;
  onChange: (r: 1 | 2) => void;
}> = ({ rounds, round, onChange }) => {
  const { t } = useTranslation();
  if (rounds.length < 2) return null;
  return (
    <div
      role="group"
      aria-label={t("presidential_round_toggle_label")}
      className="flex gap-2"
    >
      {rounds.map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={r === round}
          onClick={() => onChange(r)}
          className={`rounded border px-3 py-1 text-sm ${
            r === round ? "bg-accent font-semibold" : ""
          }`}
        >
          {t("election_round", { round: r })}
        </button>
      ))}
    </div>
  );
};
