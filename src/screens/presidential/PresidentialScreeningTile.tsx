// „Скрининг на секции" — which polling stations to look at first, for one presidential round.
//
// ⚠⚠ THE CAVEAT COMES FROM THE ARTIFACT AND RENDERS ABOVE THE LIST, and it carries two things a
// surface could not supply: that this is a screening rather than a determination, and that the
// invalid-ballot signal correlates with Roma population share (r = +0.36 at municipality level)
// with explanations such as ballot complexity. `usePresidentialScreening` refuses a payload that
// lost either sentence.
//
// ⚠⚠ A ROUND WITH `discriminating: false` LISTS NO SECTIONS — the producer sends none, and this
// renders the band table and the reason instead. 2011 round 1 puts 16.0% of its scored sections
// above „ниско"; naming twenty stations under that is an arbitrary pick presented as a finding,
// and the band shares are what make „the whole year was like this" legible.
//
// ⚠ THE SIGNAL COUNT IS ON EVERY ROW, and the round-level note fires when most rows carry one.
// 2021 counted on machines, so only 1,722 of 10,967 scored sections have a paper denominator —
// a one-signal score is that signal wearing a composite's grammar.
//
// ⚠ NO PARTY, ANYWHERE. Only the procedural half of the parliamentary risk score is computed
// here, precisely so this cannot rank a candidate's sections — see `build_screening.ts` for why
// the composite was not ported.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ScanLine } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatInt, formatPct } from "@/lib/currency";
import {
  hasScreeningContent,
  type PresidentialScreening,
  type ScreeningBandId,
} from "@/data/presidential/useScreening";

const PCT_DIGITS = 1;
/** Below this share of one-signal rows the round-level note is noise. */
const ONE_SIGNAL_NOTE_SHARE = 0.5;

const BAND_KEY: Record<ScreeningBandId, string> = {
  low: "presidential_screen_band_low",
  elevated: "presidential_screen_band_elevated",
  high: "presidential_screen_band_high",
  critical: "presidential_screen_band_critical",
};

/** ⚠ MUTED FOR EVERY BAND. A red „критично" chip beside a section number reads as a verdict on
 *  that station, which is the one thing the caveat above it rules out. */
const BAND_ORDER: ScreeningBandId[] = ["elevated", "high", "critical"];

export const PresidentialScreeningTile: FC<{
  screening: PresidentialScreening;
}> = ({ screening }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isEn = lang === "en";

  // ⚠ THE SAME PREDICATE THE SECTION GATES ON.
  if (!hasScreeningContent(screening)) return null;

  const { coverage, bands, cuts, top } = screening;
  const oneSignalShare =
    coverage.scored > 0
      ? (coverage.scored - coverage.bothSignals) / coverage.scored
      : 0;

  return (
    <StatCard
      label={
        <Hint text={t("presidential_screen_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <ScanLine className="h-4 w-4" aria-hidden />
            <span>{t("presidential_screen_title")}</span>
          </div>
        </Hint>
      }
    >
      {/* ⚠ THE CAVEAT FIRST, ABOVE THE NUMBERS. */}
      <p className="text-xs text-muted-foreground">
        {isEn ? screening.basisEn : screening.basis}
      </p>

      <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
        {BAND_ORDER.map((band) => {
          const row = bands.find((b) => b.band === band);
          return (
            <div key={band}>
              <dt className="text-xs text-muted-foreground">
                {t(BAND_KEY[band])}
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {formatInt(row?.count ?? 0, lang)}
              </dd>
              <dd className="text-xs text-muted-foreground tabular-nums">
                {formatPct(row?.share ?? 0, lang, PCT_DIGITS)}
              </dd>
            </div>
          );
        })}
      </dl>
      {/* ⚠ THE CUT POINTS ARE FROM THE ARTIFACT, so the words „повишено"/„високо" mean the same
          number here as on `/parliamentary` and a reader can check it. */}
      <p className="mt-2 text-xs text-muted-foreground">
        {t("presidential_screen_cuts", {
          elevated: cuts.elevated,
          high: cuts.high,
          critical: cuts.critical,
        })}
      </p>

      {screening.discriminating ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            {/* ⚠ SCOPED BY ROUND AND NOT THE TILE'S OWN LABEL. Both round panels can be
                mounted in one document, so an unscoped caption names two tables identically —
                and repeating the StatCard's label says nothing new either. */}
            <caption className="sr-only">
              {t("presidential_screen_table_caption", {
                round: screening.round,
              })}
            </caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col">{t("presidential_screen_col_section")}</th>
                <th scope="col" className="text-right">
                  {t("presidential_screen_col_score")}
                </th>
                <th scope="col">{t("presidential_screen_col_signals")}</th>
              </tr>
            </thead>
            <tbody>
              {top.map((s) => (
                <tr key={s.code} className="border-t">
                  {/* ⚠ NOT A LINK, and no party column. This row is a PROMPT TO LOOK at a
                      protocol, and a presidential section page would frame the station as being
                      about the flag. */}
                  <th scope="row" className="text-left font-normal">
                    {/* ⚠ EMPTY-SAFE, AND `_unplaced` IS NOT A PLACE. `??` passes an empty
                        string through, and the producer's oblast fallback is the shard
                        FILENAME — which for 2011's София sections is the placement-refused
                        sentinel. Neither may render as a station's location. */}
                    {s.placeName?.trim() ||
                      s.oblast ||
                      t("presidential_screen_place_unknown")}
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {s.code}
                    </span>
                  </th>
                  <td className="text-right tabular-nums">
                    {formatInt(Math.round(s.score), lang)}
                    <span className="block text-xs text-muted-foreground">
                      {t(BAND_KEY[s.band])}
                    </span>
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {s.components.map((c) => (
                      <span key={c.id} className="block tabular-nums">
                        {t(`presidential_screen_signal_${c.id}`)}{" "}
                        {/* ⚠⚠ AN IMPOSSIBLE RATIO IS NAMED, NOT PRINTED. 26 sections report
                            more added voters than voters — up to 425% — and „Дописани 425%" is
                            not a ratio a reader can act on: it says the protocol does not add
                            up, which is a different and stronger claim about a named station
                            than „this one stands out". The score is unaffected either way,
                            because the cap saturates at 30%. */}
                        {c.implausible
                          ? t("presidential_screen_implausible")
                          : formatPct(c.rawPct / 100, lang, PCT_DIGITS)}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // ⚠⚠ PROSE, NOT TWENTY SECTION NUMBERS. The producer sends no names in this state; this
        // is belt to that braces, and the sentence is what a reader needs instead.
        <p className="mt-3 text-xs italic text-muted-foreground">
          {/* ⚠ THE PRODUCER'S OWN FIGURE, not a second derivation of it from the band counts.
              This tile used to recompute it, which is the only reason a 100×-too-small
              `bands[].share` did not also corrupt this sentence. */}
          {t("presidential_screen_not_discriminating", {
            share: formatPct(screening.elevatedShare, lang, PCT_DIGITS),
          })}
        </p>
      )}

      {oneSignalShare > ONE_SIGNAL_NOTE_SHARE ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("presidential_screen_one_signal")}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        {t("presidential_screen_coverage", {
          scored: formatInt(coverage.scored, lang),
          sections: formatInt(coverage.sections, lang),
          both: formatInt(coverage.bothSignals, lang),
          unscored: formatInt(coverage.unscored, lang),
        })}
      </p>
      {/* ⚠⚠ THE CONFOUND, MEASURED. The caveat above carries a MUNICIPALITY-level correlation
          attached to a SECTION-level list; this says how many of the sections actually named
          here sit inside a district the press has already flagged. Measured across all ten
          rounds it is currently 0 of 20 everywhere — which is the honest counterweight, and a
          high number in some future round would be the finding. */}
      {screening.discriminating &&
      coverage.flaggedDistrictOverlap !== null &&
      top.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("presidential_screen_overlap", {
            overlap: formatInt(coverage.flaggedDistrictOverlap, lang),
            listed: formatInt(top.length, lang),
          })}
        </p>
      ) : null}
      {/* ⚠ THE TWO SIGNALS THAT ARE NOT HERE ARE NAMED. A screening captioned „procedural" that
          silently ran two of four would overstate what it looked at. */}
      <p className="mt-1 text-xs text-muted-foreground">
        {t("presidential_screen_missing_signals")}
      </p>
    </StatCard>
  );
};
