// Council voting record on an /officials/<slug> profile page. Renders
// only when the official is a sitting / former councillor and their slug
// appears in data/officials/derived/councillor_signals.json. For everyone
// else (cabinet members, governors, mayors with no per-councillor data),
// returns null and the section disappears.
//
// What it shows:
//   - Attendance % (with rose styling when below 70%)
//   - Vote breakdown (За / Против / Въздържал counts + horizontal bar)
//   - Dissent % (with party label) when the councillor has a party
//     reference frame and dissented in ≥ 10% of votes
//   - A link back to the município's MyArea council surface so users can
//     scan the actual decisions in context.
//
// Coverage today: 199 councillors across V. Tarnovo + Sofia + Burgas
// (the three municipalities where the council ingest has named-vote
// data). The set grows automatically as more municipalities unlock.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Vote, ChevronRight } from "lucide-react";
import { Link } from "@/ux/Link";
import { useCouncillorProfile } from "@/data/council/useCouncillorProfile";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";

type Props = {
  slug: string;
};

const VOTE_COLOR = {
  for: "#10b981",
  against: "#ef4444",
  abstain: "#f59e0b",
};

const ATTENDANCE_SEVERE = 0.7;
const DISSENT_BADGE = 0.1;

export const CouncilActivitySection: FC<Props> = ({ slug }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bg" ? "bg" : "en";
  const { data } = useCouncillorProfile(slug);
  const { byId: partyById } = useCanonicalParties();
  const { findMunicipality } = useMunicipalities();

  if (!data) return null;

  const attendancePct = Math.round(data.attendance * 100);
  const severe = data.attendance < ATTENDANCE_SEVERE;
  const dissentPct =
    data.dissent != null && data.dissent >= DISSENT_BADGE
      ? Math.round(data.dissent * 100)
      : null;
  const party = data.partyCanonicalId
    ? partyById.get(data.partyCanonicalId)
    : null;
  const muni = findMunicipality(data.obshtina);
  const muniName = muni
    ? lang === "bg"
      ? muni.name
      : (muni.name_en ?? muni.name)
    : data.obshtina;

  const totalCast = data.forCount + data.againstCount + data.abstainCount;
  const forPct = totalCast > 0 ? (data.forCount / totalCast) * 100 : 0;
  const againstPct = totalCast > 0 ? (data.againstCount / totalCast) * 100 : 0;
  const abstainPct = totalCast > 0 ? (data.abstainCount / totalCast) * 100 : 0;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm space-y-4">
      <h2 className="text-base font-semibold flex items-center gap-2">
        <Vote className="h-4 w-4" />
        {lang === "bg"
          ? "Гласувания в общинския съвет"
          : "Council voting record"}
        <span className="text-xs text-muted-foreground font-normal">
          · {muniName}
        </span>
      </h2>

      {/* Party + headline KPIs row */}
      <div className="flex flex-wrap items-center gap-3">
        {party ? (
          <span
            className="inline-block text-xs font-medium rounded px-2 py-0.5 text-white"
            style={{ backgroundColor: party.color ?? "#888" }}
          >
            {party.displayName}
          </span>
        ) : null}
        <div className="text-xs text-muted-foreground">
          <span className={severe ? "text-rose-600 font-semibold" : ""}>
            {lang === "bg"
              ? `Присъствие ${attendancePct}%`
              : `Attendance ${attendancePct}%`}
          </span>
          <span className="ml-2 tabular-nums">
            ({data.votesCast} / {data.totalResolutions})
          </span>
        </div>
        {dissentPct != null ? (
          <span className="text-xs text-amber-600">
            {lang === "bg"
              ? `Несъгласие с партията ${dissentPct}%`
              : `Party dissent ${dissentPct}%`}
          </span>
        ) : null}
      </div>

      {/* Stacked horizontal bar — For / Against / Abstain */}
      {totalCast > 0 ? (
        <div className="space-y-2">
          <div className="h-3 w-full rounded overflow-hidden border bg-muted/30 flex">
            <div
              style={{ width: `${forPct}%`, backgroundColor: VOTE_COLOR.for }}
              title={`За: ${data.forCount}`}
            />
            <div
              style={{
                width: `${againstPct}%`,
                backgroundColor: VOTE_COLOR.against,
              }}
              title={`Против: ${data.againstCount}`}
            />
            <div
              style={{
                width: `${abstainPct}%`,
                backgroundColor: VOTE_COLOR.abstain,
              }}
              title={`Въздържал се: ${data.abstainCount}`}
            />
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground tabular-nums">
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: VOTE_COLOR.for }}
              />
              {lang === "bg" ? "За" : "For"} {data.forCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: VOTE_COLOR.against }}
              />
              {lang === "bg" ? "Против" : "Against"} {data.againstCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: VOTE_COLOR.abstain }}
              />
              {lang === "bg" ? "Въздържал се" : "Abstain"} {data.abstainCount}
            </span>
          </div>
        </div>
      ) : null}

      {/* Footer note + back-link to município council surface */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {lang === "bg"
            ? `Данните покриват последните ${data.totalResolutions} поименни гласувания в общината.`
            : `Coverage: the most recent ${data.totalResolutions} named-vote resolutions in this município.`}
        </span>
        <Link
          to={`/my-area/${data.obshtina}#council`}
          underline={false}
          className="inline-flex items-center gap-0.5 hover:text-foreground"
        >
          {lang === "bg" ? "Виж решенията" : "View decisions"}
          <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      <p className="text-[10px] text-muted-foreground italic">
        {t("my_area_council_ai_disclaimer")}
      </p>
    </section>
  );
};
