// School exam-score tool: top schools in a município by their latest ДЗИ
// (matura) / НВО state-exam average, per subject. Reads schools/index.json.

import { fetchData } from "./dataClient";
import { resolveMunicipality } from "./place";
import { round2 } from "./dataset";
import type { Column, Envelope, Row, ToolArgs, ToolContext } from "./types";

// Sofia's районы fall back to the SOF00 city aggregate (mirrors census/taxes).
const schoolCode = (obshtina: string): string =>
  obshtina === "SOF" ? "SOF00" : obshtina;

type School = {
  name: string;
  address: string;
  scoresByYear: Record<string, Record<string, number>>;
};
type SchoolsIndex = {
  latestYear: number;
  subjects: Record<string, { bg: string; en: string }>;
  schoolsByObshtina: Record<string, School[]>;
};

// Resolve a subject key (e.g. "dzi_bel") from free text; default ДЗИ Bulgarian.
const resolveSubject = (raw: string, available: string[]): string => {
  const q = raw.toLowerCase();
  const exam = /нво|nvo|7|основно/.test(q) ? "nvo" : "dzi";
  const subj = /математ|math/.test(q) ? "math" : "bel";
  const want = `${exam}_${subj}`;
  if (available.includes(want)) return want;
  if (available.includes("dzi_bel")) return "dzi_bel";
  return available[0];
};

// Latest year for which a school has a score in the chosen subject.
const latestScore = (
  s: School,
  subject: string,
): { year: string; value: number } | undefined => {
  const years = Object.keys(s.scoresByYear).sort().reverse();
  for (const y of years) {
    const v = s.scoresByYear[y]?.[subject];
    if (typeof v === "number") return { year: y, value: v };
  }
  return undefined;
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
      provenance: ["schools/index.json"],
    };
  }
  const idx = await fetchData<SchoolsIndex>("/schools/index.json");
  const schools = idx.schoolsByObshtina[schoolCode(place.obshtina)] ?? [];
  if (!schools.length) {
    return {
      tool: "schoolScores",
      domain: "indicators",
      kind: "scalar",
      title: bg
        ? `Няма данни за училища в ${place.name}`
        : `No school data for ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: ["schools/index.json"],
    };
  }
  const available = Array.from(
    new Set(
      schools.flatMap((s) =>
        Object.values(s.scoresByYear).flatMap((y) => Object.keys(y)),
      ),
    ),
  );
  const subject = resolveSubject(
    String(args.indicator ?? args.place ?? ""),
    available,
  );
  const subjectLabel = idx.subjects[subject]
    ? idx.subjects[subject][ctx.lang]
    : subject;

  const scored = schools
    .map((s) => {
      const sc = latestScore(s, subject);
      return sc ? { name: s.name, address: s.address, ...sc } : null;
    })
    .filter(
      (
        x,
      ): x is { name: string; address: string; year: string; value: number } =>
        !!x,
    )
    .sort((a, b) => b.value - a.value);

  if (!scored.length) {
    return {
      tool: "schoolScores",
      domain: "indicators",
      kind: "scalar",
      title: bg
        ? `Няма оценки по „${subjectLabel}“ за ${place.name}`
        : `No "${subjectLabel}" scores for ${place.nameEn}`,
      viz: "none",
      facts: { place: place.name },
      provenance: ["schools/index.json"],
    };
  }
  const top = scored.slice(0, 12);
  const columns: Column[] = [
    { key: "school", label: bg ? "Училище" : "School" },
    { key: "address", label: bg ? "Място" : "Place" },
    { key: "score", label: bg ? "Оценка" : "Score", numeric: true },
  ];
  const rows: Row[] = top.map((s) => ({
    school: s.name,
    address: s.address,
    score: round2(s.value),
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
    facts: {
      place: bg ? place.name : place.nameEn,
      subject: subjectLabel,
      schools: scored.length,
      top_school: top[0] ? `${top[0].name} (${round2(top[0].value)})` : "—",
    },
    provenance: ["schools/index.json"],
  };
};
