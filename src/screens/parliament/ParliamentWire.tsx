// Band 0 — the wire line: what the chamber last did, in one sentence, above everything else.
//
// THE RECESS FRAMING IS COMPUTED AGAINST THE READER'S TODAY, not the build's. hub_stats
// carries an `inRecessDays` stamped when rebuildDerived ran, and this page is prerendered
// and bucket-cached: quoting that number would tell a reader on Friday what was true on
// Monday. The artifact supplies the last sitting's DATE — a fact that does not age — and the
// arithmetic happens here.
//
// It is deliberately one line and not a card. Band 0 sits above the hero; anything with a
// border there competes with the strip for the top of the page, which is the one thing §4.1
// decided the strip should win.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { useDayLabel } from "@/ux/feed";
import type { HubWire } from "@/data/parliament/useParliamentHubFeed";
import { daysSince } from "./recess";
import { LIVE_TAIL_DAYS } from "./stripWindow";

export const ParliamentWire: FC<{
  wire: HubWire | null;
  todayIso?: string;
}> = ({ wire, todayIso }) => {
  const { t, i18n } = useTranslation();
  const day = useDayLabel();
  // With the year. A dissolved parliament's last sitting is years back, and „от 25 март"
  // beside „1960 дни" names a March five years ago as if it were this one.
  const dayLong = useDayLabel("long");
  if (!wire) return null;

  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const recess = daysSince(wire.date, today);
  const locale = i18n.language === "bg" ? "bg-BG" : "en-GB";

  // The figures are the LAST SITTING's in both framings — the difference is only whether
  // that sitting was today. Printing "0 гласувания" during a recess would be false: the
  // chamber did not sit, it did not vote nothing.
  //
  // Built as SEPARATE FRAGMENTS rather than one interpolated sentence, because each number
  // needs its own Bulgarian count form and i18next pluralises on a single `count`: one
  // string holding three numbers can inflect at most one of them, and the first draft
  // shipped „1 гласувания" and „1 точки".
  //
  // The attendance clause DROPS OUT when the day recorded no cast votes, rather than
  // rendering 0%. The 49th's final sitting is exactly that shape — two items, no roll call
  // — and "0% присъствие" would assert an empty chamber where the corpus only says it does
  // not know.
  const figures = [
    t("nsh_num_items", { count: wire.items }),
    // Dropped at zero rather than printed as „0 законопроекта на второ четене", which is true
    // and reads as an oversight — five of the nine parliaments' last sittings passed no bill
    // at second reading, including the current one. The attendance fragment beside it already
    // disappears when it cannot be derived.
    ...(wire.bills > 0 ? [t("nsh_num_bills", { count: wire.bills })] : []),
    // „в този ден" is not filler. The Присъствие tile lower on THIS page reads 73% —
    // weighted over the whole parliament — and this reads 51%. Two numbers under one word
    // with no basis is the exact failure §4.3 spent three audits removing.
    ...(wire.attendance === null
      ? []
      : [
          t("nsh_wire_attendance", {
            pct: new Intl.NumberFormat(locale, {
              style: "percent",
              maximumFractionDigits: 0,
            }).format(wire.attendance),
          }),
        ]),
  ].join(" · ");

  return (
    <p className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">
        {/* THREE framings, not two, and the third is the common case. „не заседава" is a
            claim about a LIVE chamber in recess; applied to a dissolved one it says the 44th
            National Assembly has been failing to sit for 1,960 days. The strip already draws
            this distinction at LIVE_TAIL_DAYS — reusing its threshold is what keeps the
            sentence and the picture beneath it telling the same story. */}
        {recess === 0
          ? t("nsh_wire_today")
          : recess <= LIVE_TAIL_DAYS
            ? t("nsh_wire_recess", { count: recess, date: day(wire.date) })
            : t("nsh_wire_last_sat", { date: dayLong(wire.date) })}
      </span>
      {": "}
      <Link to={`/votes/${wire.date}`} className="font-medium">
        {figures}
      </Link>
      {/* The second-reading basis, named where the number is. „3 законопроекта" without
          „на второ четене, по заглавие" is the kind of figure that gets quoted back as
          "three laws passed" — and §4.2 established that this corpus has no adoption
          marker at all, so that reading would be unsupportable. */}
      {/* The basis rides with the number it qualifies, and disappears with it. */}
      {wire.bills > 0 ? (
        <span className="ml-1 text-xs">{t("nsh_wire_basis")}</span>
      ) : null}
    </p>
  );
};
