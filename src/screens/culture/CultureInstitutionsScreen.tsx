// /culture/institutions — the register itself: who the sector's bodies ARE.
//
// It exists because the register is the sector's spine and was invisible. Until
// 2026-08-18 `kulturaReferenceData.ts` carried 23 EIKs and the corpus sweep found
// SEVENTEEN national art schools in none of its lists — including НУКК, the
// largest buyer in the ACF story, absent from every roll-up, roster, map and
// search box at once. This page is where that list is now readable.
//
// ═══════════════════════════════════════════════════════════════════════════════
// FOUR LISTS, RENDERED AS FOUR — because collapsing them is the defect T0.6 was
// decided to fix. The old anti-allowlist carried two different claims under one
// name: „this is not a culture body" (Община Куклен, a regex false match) and
// „this is a culture body that answers to somebody else" (Националният
// военноисторически музей). Reading the second as the first is how €28.6m of
// art-academy procurement came to have no home.
//
//   роll-up   — principal = МК. What every € figure on this sector means.
//   adjacent  — a REAL cultural body with a non-МК principal. Declared, shown,
//               and in no total.
//   verify    — държавен-or-общински genuinely unsettled. Listed, not resolved.
//   excluded  — not a cultural body at all. Not rendered here; the register keeps
//               them so a future name-match cannot re-admit them.
// ═══════════════════════════════════════════════════════════════════════════════

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Title } from "@/ux/Title";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { formatInt } from "@/lib/currency";
import { CultureDirectorsSection } from "./CultureDirectorsSection";
import {
  CULTURE_BODIES,
  STATE_CULTURE_INSTITUTES,
  ART_SCHOOLS,
  DKI_CONFIRMED_INSTITUTES,
  ADJACENT_EIKS,
  VERIFY_PRINCIPAL_EIKS,
  NFC_EIK,
} from "@/lib/kulturaReferenceData";

const Row: FC<{ eik: string; name: string; note?: string }> = ({
  eik,
  name,
  note,
}) => (
  <li className="flex items-baseline justify-between gap-3 px-4 py-2">
    {/* НФЦ is the one body with NO /awarder page — a Bulstat entity with zero
        procurement, so the link would land on „no company with this EIK". A row
        whose destination cannot render does not get one. */}
    {eik === NFC_EIK ? (
      <span className="min-w-0 truncate">{name}</span>
    ) : (
      <Link to={`/awarder/${eik}`} className="min-w-0 truncate hover:underline">
        {name}
      </Link>
    )}
    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
      {note ?? eik}
    </span>
  </li>
);

export const CultureInstitutionsScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const seen = new Set(CULTURE_BODIES.map((b) => b.eik));
  const institutes = STATE_CULTURE_INSTITUTES.filter((i) => !seen.has(i.eik));
  const adjacent = Object.entries(ADJACENT_EIKS);
  const kindLabel: Record<string, { bg: string; en: string }> = {
    higher_ed_arts: { bg: "висше училище (МОН)", en: "higher education (МОН)" },
    ban_museum: { bg: "БАН", en: "БАН" },
    mo_museum: { bg: "Министерство на отбраната", en: "Ministry of Defence" },
    other_ministry: { bg: "друго министерство", en: "another ministry" },
  };

  return (
    <>
      <Title
        description={
          bg
            ? "Регистърът на културните институции: държавните институти и националните училища по изкуствата с принципал Министерството на културата, културните тела с друг принципал, и тези с неизяснен."
            : "The register of Bulgaria's cultural institutions: the state institutes and national art schools whose principal is the Ministry of Culture, the cultural bodies answering to someone else, and those still unresolved."
        }
      >
        {bg ? "Институциите" : "The institutions"}
      </Title>
      <SectorBreadcrumb
        parent={{ label: bg ? "Култура" : "Culture", to: "/culture" }}
        current={bg ? "Институции" : "Institutions"}
      />

      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
        {bg
          ? "Всяка цифра за сектора зависи от този списък, затова той е разделен на четири и всяка част казва какво твърди. „Извън обхвата“ не значи „не съществува“ — значи „плаща го някой друг“."
          : "Every figure about this sector depends on this list, so it is split four ways and each part says what it claims. „Outside the roll-up“ does not mean „does not exist“ — it means „somebody else pays for it“."}
      </p>

      <div className="mt-4 space-y-6">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">
            {bg
              ? `Държавни културни институти (${formatInt(CULTURE_BODIES.length + institutes.length, lang)})`
              : `State cultural institutes (${formatInt(CULTURE_BODIES.length + institutes.length, lang)})`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {bg
              ? "Принципал: Министерство на културата. Това е наборът, който всяка сума за сектора означава."
              : "Principal: the Ministry of Culture. This is the set every sector total means."}
          </p>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {CULTURE_BODIES.map((b) => (
              <Row
                key={b.eik}
                eik={b.eik}
                name={bg ? b.bg : b.en}
                note={bg ? b.noteBg : b.noteEn}
              />
            ))}
            {institutes.map((i) => (
              <Row key={i.eik} eik={i.eik} name={i.bg} />
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">
            {bg
              ? `Национални училища по изкуствата (${formatInt(ART_SCHOOLS.length, lang)})`
              : `National art schools (${formatInt(ART_SCHOOLS.length, lang)})`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {bg
              ? "Второстепенни разпоредители на МК — и най-слабо конкурентният слой в сектора. До 18 август 2026 г. нито едно от тях не беше в никой списък."
              : "МК's second-level spending units — and the sector's worst-competing layer. Until 18 August 2026 not one of them was in any list."}
          </p>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {ART_SCHOOLS.map((a) => (
              <Row key={a.eik} eik={a.eik} name={a.bg} />
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">
            {bg
              ? `Културни тела с друг принципал (${formatInt(adjacent.length, lang)})`
              : `Cultural bodies with another principal (${formatInt(adjacent.length, lang)})`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {bg
              ? "Истински културни институции, които не се плащат от МК — висшите училища по изкуствата, музеите на БАН и на МО. Показани, но извън всяка сума за сектора."
              : "Real cultural institutions that МК does not pay for — the arts universities and the БАН and МО museums. Shown, and outside every sector total."}
          </p>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {adjacent.map(([eik, a]) => (
              <Row
                key={eik}
                eik={eik}
                name={a.bg}
                note={bg ? kindLabel[a.kind]?.bg : kindLabel[a.kind]?.en}
              />
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">
            {bg
              ? `С неизяснен принципал (${formatInt(VERIFY_PRINCIPAL_EIKS.length, lang)})`
              : `Principal unresolved (${formatInt(VERIFY_PRINCIPAL_EIKS.length, lang)})`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {bg
              ? "Регионални музеи, библиотеки и театри, при които държавен срещу общински не се решава от името. Изброени, за да не изчезнат — не са в роll-up-а."
              : "Regional museums, libraries and theatres where държавен versus общински is not settled by the name. Listed so they cannot drift — not in the roll-up."}
          </p>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {VERIFY_PRINCIPAL_EIKS.map((eik) => (
              <Row key={eik} eik={eik} name={eik} note="" />
            ))}
          </ul>
        </section>

        <section id="people" className="scroll-mt-20 space-y-2">
          <h2 className="text-lg font-semibold">
            {bg ? "Кой ги ръководи" : "Who runs them"}
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {bg
              ? "Всеки от тях е декларирал сам, под собственото си име, къде работи — това е връзката по-долу. Тя НЕ твърди, че някой е подписал конкретен договор, нито че още заема поста: декларацията носи година, длъжността не."
              : "Each of these people stated, under their own name, where they work — that is the link below. It does NOT claim anyone signed a particular contract, nor that they still hold the post: the filing carries a year, the post does not."}
          </p>
          <ul className="space-y-3">
            {[
              ...STATE_CULTURE_INSTITUTES,
              ...ART_SCHOOLS,
              ...DKI_CONFIRMED_INSTITUTES,
            ].map((i) => (
              <CultureDirectorsSection
                key={i.eik}
                eik={i.eik}
                name={i.bg}
                bg={bg}
              />
            ))}
          </ul>
          <p className="text-sm">
            <Link
              to="/persons?role=cultural_institute"
              className="text-primary hover:underline"
            >
              {bg ? "Виж хората →" : "See the people →"}
            </Link>
          </p>
        </section>
      </div>
    </>
  );
};
