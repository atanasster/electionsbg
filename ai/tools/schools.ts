// School exam-score tool: top schools in a município by their latest ДЗИ
// (matura) / НВО state-exam average, per subject. Served from Postgres
// (education-muni-scores, migration 055) — the relational school_scores table,
// which carries every subject × year — so it no longer fetches the 1.25 MB
// /schools/index.json on every call (one source of truth with schoolMatura).

import { fetchDb } from "./dataClient";
import { resolveMunicipality } from "./place";
import { muniLocator } from "./geo";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// Sofia's районы fall back to the SOF00 city aggregate (mirrors census/taxes).
const schoolCode = (obshtina: string): string =>
  obshtina === "SOF" ? "SOF00" : obshtina;

type MuniScore = {
  name: string;
  address: string | null;
  year: number;
  value: number;
  n: number | null;
};

const SUBJECT_LABEL: Record<string, { bg: string; en: string }> = {
  dzi_bel: { bg: "ДЗИ по БЕЛ", en: "matura, Bulgarian" },
  dzi_math: { bg: "ДЗИ по математика", en: "matura, maths" },
  nvo_bel: { bg: "НВО по БЕЛ (7. клас)", en: "НВО, Bulgarian (grade 7)" },
  nvo_math: { bg: "НВО по математика (7. клас)", en: "НВО, maths (grade 7)" },
};

// Resolve a subject key (dzi/nvo × bel/math) from free text; default ДЗИ БЕЛ.
const resolveSubject = (raw: string): string => {
  const q = raw.toLowerCase();
  const exam = /нво|nvo|7|основно/.test(q) ? "nvo" : "dzi";
  const subj = /математ|math/.test(q) ? "math" : "bel";
  return `${exam}_${subj}`;
};

export const schoolScores = async (
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Envelope> => {
  const bg = ctx.lang === "bg";
  const place = await resolveMunicipality(String(args.place ?? ""));
  if (!place) {
    return {
      tool: "schoolScores",
      domain: "indicators",
      kind: "scalar",
      title: bg
        ? `Не намерих община „${args.place ?? ""}“`
        : `No municipality matched "${args.place ?? ""}"`,
      viz: "none",
      facts: { query: String(args.place ?? "") },
      provenance: ["education-muni-scores"],
    };
  }

  const subject = resolveSubject(String(args.indicator ?? args.place ?? ""));
  const label = SUBJECT_LABEL[subject] ?? { bg: subject, en: subject };
  const subjectLabel = bg ? label.bg : label.en;

  const scored =
    (await fetchDb<MuniScore[]>("education-muni-scores", {
      obshtina: schoolCode(place.obshtina),
      subject,
    })) ?? [];

  if (!scored.length) {
    return {
      tool: "schoolScores",
      domain: "indicators",
      kind: "scalar",
      title: bg
        ? `Няма оценки по „${subjectLabel}“ за ${place.name}`
        : `No "${subjectLabel}" scores for ${place.nameEn}`,
      viz: "none",
      facts: { place: bg ? place.name : place.nameEn },
      provenance: ["education-muni-scores"],
    };
  }

  const top = scored.slice(0, 12);
  const columns: Column[] = [
    { key: "school", label: bg ? "Училище" : "School" },
    { key: "address", label: bg ? "Място" : "Place" },
    { key: "score", label: bg ? "Оценка" : "Score", numeric: true },
  ];
  const rows: Row[] = top.map((r) => ({
    school: r.name,
    address: r.address ?? "",
    score: round2(r.value),
  }));
  return {
    tool: "schoolScores",
    domain: "indicators",
    kind: "table",
    title: bg
      ? `Училища по ${subjectLabel} — ${place.name}`
      : `Schools by ${subjectLabel} — ${place.nameEn}`,
    subtitle: bg
      ? `Среден успех, най-нова налична година`
      : `Average score, latest available year`,
    columns,
    rows,
    viz: "none",
    geo: muniLocator(
      place.obshtina,
      place.oblast,
      bg ? place.name : place.nameEn,
    ),
    facts: {
      place: bg ? place.name : place.nameEn,
      subject: subjectLabel,
      schools: scored.length,
      top_school: top[0] ? `${top[0].name} (${round2(top[0].value)})` : "—",
    },
    provenance: ["education-muni-scores"],
  };
};
