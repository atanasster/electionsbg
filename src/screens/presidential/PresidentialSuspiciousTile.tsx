// „Подозрителни населени места" — the three protocol red flags for one presidential round.
//
// ⚠⚠ THE CAVEAT COMES FROM THE ARTIFACT AND RENDERS ABOVE THE LISTS. This tile NAMES VILLAGES,
// so a reader who stops at the first row has to have read that none of the three thresholds
// proves wrongdoing on its own. `usePresidentialSuspicious` refuses a payload that lost the
// sentence, so „the list rendered" implies „the caveat rendered".
//
// ⚠⚠ A COLUMN WITH `discriminating: false` RENDERS PROSE, NEVER NAMES — and the producer sends
// no names in that state, so this is belt and braces rather than a second rule. The reason is
// measured: on 2006's runoff the concentration flag caught 2,537 settlements of which 205 sat
// at exactly 100%, and on 2011 round 1 the invalid flag caught 35.5% of the country in a year
// whose national rate was 6.44%. Three of those is not a finding, it is an arbitrary pick.
// What the column shows instead is the count and the national rate — the two numbers that make
// „the whole country was like this" legible.
//
// ⚠ THE NATIONAL RATE IS PRINTED BESIDE EVERY THRESHOLD, discriminating or not. „≥10% invalid"
// means something different in a year at 0.4% and a year at 6.4%, and a reader cannot calibrate
// the flag without it.
//
// ⚠ THE TITLE AND THE THREE COLUMN TITLES ARE THE PARLIAMENTARY KEYS' OWN WORDING, the hints
// are not. „Струпване на гласове" names the same phenomenon on either ballot and must read
// identically on both dashboards — in BOTH languages, which is why the tile's own heading is
// „Подозрителни населени места" / „Suspicious settlements" rather than a softer English one:
// a gentler EN beside an unchanged BG makes the Bulgarian half — the half nearly every reader
// sees — the accusatory one. The HINTS restate the threshold and its subject, and a
// presidential one is a PAIR rather than a party — the ported-copy trap this family's plan §5
// is about. `settlementLabel` is shared for the same reason.
//
// ⚠ IT IS NOT `SuspiciousSectionsTile`. That component reads the parliamentary
// `useSuspiciousSettlements` payload, resolves a `partyNum` against the canonical party corpus
// for its concentration column, and links each row to `/settlement/:ekatte` under the SELECTED
// PARLIAMENTARY election. None of those is true here — a presidential row has no party, and the
// settlement page it would link to is about a different ballot.

import { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BarChart3, FileX2, UserPlus } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatInt, formatPct } from "@/lib/currency";
import { settlementLabel } from "@/screens/dashboard/settlementLabel";
import {
  hasSuspiciousContent,
  type PresidentialSuspicious,
  type SuspiciousCategoryPayload,
} from "@/data/presidential/useSuspiciousSettlements";

const PCT_DIGITS = 1;

type Column = {
  key: "concentrated" | "invalidBallots" | "additionalVoters";
  icon: ReactNode;
  title: string;
  hint: string;
  data: SuspiciousCategoryPayload;
};

/** `formatPct` takes a FRACTION, and MOST of this payload is already 0-100 — `threshold`,
 *  `nationalPct` and every row's `value`. */
const pct = (v: number, lang: string) => formatPct(v / 100, lang, PCT_DIGITS);

/** ⚠ …BUT `flaggedShare` IS THE ONE FIELD THE PRODUCER STORES AS A FRACTION. Naming both units
 *  is what stops a reader „simplifying" `pct(share * 100)` into `pct(share)`, which would print
 *  „0,6%" for a flag covering 60% of the country — inside the sentence explaining that the flag
 *  separated nothing. */
const fraction = (v: number, lang: string) => formatPct(v, lang, PCT_DIGITS);

export const PresidentialSuspiciousTile: FC<{
  suspicious: PresidentialSuspicious;
}> = ({ suspicious }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isEn = lang === "en";

  // ⚠ THE SAME PREDICATE THE SECTION GATES ON, so a tile can never be the thing that keeps an
  // otherwise empty heading standing — the flash tile's own `tickets.length` rule.
  if (!hasSuspiciousContent(suspicious)) return null;

  const columns: Column[] = [
    {
      key: "concentrated",
      icon: <BarChart3 className="h-4 w-4" aria-hidden />,
      title: t("dashboard_suspicious_concentrated"),
      hint: t("presidential_suspicious_concentrated_hint"),
      data: suspicious.concentrated,
    },
    {
      key: "invalidBallots",
      icon: <FileX2 className="h-4 w-4" aria-hidden />,
      title: t("dashboard_suspicious_invalid"),
      hint: t("presidential_suspicious_invalid_hint"),
      data: suspicious.invalidBallots,
    },
    {
      key: "additionalVoters",
      icon: <UserPlus className="h-4 w-4" aria-hidden />,
      title: t("dashboard_suspicious_additional"),
      hint: t("presidential_suspicious_added_hint"),
      data: suspicious.additionalVoters,
    },
  ];

  return (
    <StatCard
      label={
        <Hint text={t("presidential_suspicious_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <span>{t("presidential_suspicious_title")}</span>
          </div>
        </Hint>
      }
    >
      {/* ⚠ THE CAVEAT FIRST, ABOVE THE NAMES. */}
      <p className="text-xs text-muted-foreground">
        {isEn ? suspicious.basisEn : suspicious.basis}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {columns.map((c) => (
          <div key={c.key} className="min-w-0">
            <Hint text={c.hint} underline={false}>
              <div className="flex items-center gap-2 text-sm font-medium">
                {c.icon}
                <span>{c.title}</span>
              </div>
            </Hint>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formatInt(c.data.count, lang)}
            </p>
            {/* ⚠ THE THRESHOLD AND THE BASELINE TOGETHER. „≥10%" is not a fact about a place
                until a reader knows what the country did. */}
            <p className="text-xs text-muted-foreground">
              {t("presidential_suspicious_of", {
                threshold: pct(c.data.threshold, lang),
                measurable: formatInt(c.data.measurableSettlements, lang),
                national: pct(c.data.nationalPct, lang),
              })}
            </p>
            {!c.data.discriminating ? (
              // ⚠⚠ PROSE, NOT THREE NAMES. This is the whole reason the producer computes
              // `discriminating`: a flag that caught a third of the country says something
              // about the year, and naming three villages under it says something about them.
              <p className="mt-2 text-xs italic text-muted-foreground">
                {t("presidential_suspicious_not_discriminating", {
                  share: fraction(c.data.flaggedShare, lang),
                })}
              </p>
            ) : c.data.top.length > 0 ? (
              // ⚠ THE LIST IS NAMED AFTER ITS COLUMN. The three titles are visually headings and
              // semantically plain text (the parliamentary tile's own shape), so without this a
              // screen-reader user meets three unlabelled lists of villages.
              <ul className="mt-2 space-y-1 text-xs" aria-label={c.title}>
                {c.data.top.map((p) => {
                  const label = settlementLabel(p, !isEn);
                  return (
                    <li key={p.ekatte} className="flex justify-between gap-2">
                      {/* ⚠ NOT A LINK. A presidential settlement page exists, but this row is a
                          FLAG rather than a result, and sending a reader from „подозрително" to
                          that place's page reads as the page being about the flag.

                          ⚠ TRUNCATED NAMES NEED A `title`. 27-character labels („с.Мало Малово,
                          София област") are ordinary in this corpus and the column is ~139px at
                          `sm`, so without it a flagged place is unreadable and unrecoverable —
                          on a tile whose entire content is WHICH places were flagged. The
                          parliamentary sibling sets one on both of its branches. */}
                      <span className="truncate" title={label}>
                        {label}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {pct(p.value, lang)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              // ⚠ NOT A BLANK. „Nothing crossed the threshold" and „the list did not load" must
              // not render identically, and a blank gap under a number reads as the second. The
              // parliamentary tile's own empty state, and its key — one phenomenon, one wording.
              <p className="mt-2 text-xs text-muted-foreground">
                {t("dashboard_suspicious_none")}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {t("presidential_suspicious_coverage", {
          settlements: formatInt(suspicious.coverage.settlements, lang),
          sections: formatInt(suspicious.coverage.sectionsWithoutEkatte, lang),
          votes: formatInt(suspicious.coverage.votesWithoutEkatte, lang),
        })}
      </p>
    </StatCard>
  );
};
