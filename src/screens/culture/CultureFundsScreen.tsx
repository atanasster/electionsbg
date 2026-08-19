// /culture/funds — every public euro reaching culture that is NOT a contract.
//
// §1.7's „Всички публични пари" view: one row per corpus, each labelled with its
// BASIS and its COVERAGE. That labelling is the page, not decoration around it.
//
// ═══════════════════════════════════════════════════════════════════════════════
// NOTHING ON THIS PAGE MAY BE SUMMED, and the copy says so in the first sentence.
// The arms are not comparable quantities:
//
//   ИСУН by EIK    — the register's own 45 bodies. Reproducible, and a strict
//                    SUBSET of the name-matched figure.
//   ИСУН by name   — a floor with a fuzzy edge: 1,559 beneficiaries, mostly
//                    читалища. 56% above the EIK-exact figure, and BOTH are true.
//   ДФЗ читалища   — a farm-subsidy corpus. No state cultural institution has
//                    ever received one; the culture presence here is читалища and
//                    is reachable only by NAME (0 rows by EIK).
//   Interreg       — a partner's published BUDGET, not a contract value, and
//                    only ~21% of Bulgarian partners on culture-themed
//                    operations carry an EIK at all.
//
// The plan's §0 records the two figures that made this rule: a naive culture
// regex over ДФЗ returns €166.3m against a true €18.3m („полски КУЛТУРИ"), and
// the ИСУН headline was ~70% false positives before the matcher was written down.
// ═══════════════════════════════════════════════════════════════════════════════

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Title } from "@/ux/Title";
import { SectorBreadcrumb } from "@/screens/components/procurement/SectorBreadcrumb";
import { formatEurCompact, formatInt } from "@/lib/currency";
import { useCultureHubStats } from "@/data/culture/hubStats";

export const CultureFundsScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  const { data: s, isLoading } = useCultureHubStats();

  const rows = s
    ? [
        {
          key: "isun-eik",
          label: bg
            ? "ИСУН — по ЕИК на бенефициента"
            : "ИСУН — by beneficiary EIK",
          eur: s.funds.eikExactEur,
          sub: bg
            ? `${formatInt(s.funds.eikExactProjects, lang)} проекта на институциите от регистъра`
            : `${formatInt(s.funds.eikExactProjects, lang)} projects, the register's own institutions`,
          basis: bg
            ? "Възпроизводимо: точно съвпадение по ЕИК срещу списъка на сектора. Подмножество на реда отдолу."
            : "Reproducible: an exact EIK match against the sector register. A subset of the row below.",
        },
        {
          key: "isun-name",
          label: bg
            ? "ИСУН — по име на бенефициента"
            : "ИСУН — by beneficiary name",
          eur: s.funds.byNameEur,
          sub: bg
            ? `${formatInt(s.funds.byNameProjects, lang)} проекта, предимно читалища`
            : `${formatInt(s.funds.byNameProjects, lang)} projects, mostly читалища`,
          basis: bg
            ? "Долна граница с размита граница: съвпадение по име, с изключенията срещу „аквакултури“ и „изкуствен интелект“. 56% над реда отгоре — и двете са верни."
            : "A floor with a fuzzy edge: a name match, guarded against „аквакултури“ and „изкуствен интелект“. 56% above the row above — both are true.",
        },
        {
          key: "interreg",
          label: bg
            ? "Interreg — тематично (култура и наследство)"
            : "Interreg — culture and heritage themed",
          eur: s.interreg.thematicEur,
          sub: bg
            ? `${formatInt(s.interreg.partners, lang)} български партньора по ${formatInt(s.interreg.partnerRows, lang)} участия`
            : `${formatInt(s.interreg.partners, lang)} Bulgarian partners across ${formatInt(s.interreg.partnerRows, lang)} participations`,
          basis: bg
            ? `Публикуван БЮДЖЕТ на партньора, не стойност на договор — не е съпоставим с редовете отгоре. Свързва се през ТЕМАТА на операцията, не през списък с бенефициенти, и само ${formatInt(s.interreg.rowsWithEik, lang)} от ${formatInt(s.interreg.partnerRows, lang)} участия носят ЕИК, така че филтър по ЕИК отговаря на около една пета от въпроса.`
            : `A partner's published BUDGET, not a contract value — not comparable with the rows above. Joined through the operation's THEME rather than a beneficiary set, and only ${formatInt(s.interreg.rowsWithEik, lang)} of ${formatInt(s.interreg.partnerRows, lang)} participations carry an EIK, so an EIK-keyed filter answers about a fifth of the question.`,
        },
        {
          key: "chitalishta",
          label: bg ? "ДФЗ — народни читалища" : "ДФЗ — народни читалища",
          eur: s.agri.chitalishtaEur,
          sub: bg
            ? `${formatInt(s.agri.chitalishtaRows, lang)} плащания`
            : `${formatInt(s.agri.chitalishtaRows, lang)} payments`,
          basis: bg
            ? "Земеделски субсидии. Нито един държавен културен институт не получава такива — присъствието на културата тук са читалищата, и се стига до тях само по ИМЕ (0 реда по ЕИК)."
            : "Farm subsidies. No state cultural institution receives one — culture's presence here is читалища, reachable only by NAME (0 rows by EIK).",
        },
      ]
    : [];

  return (
    <>
      <Title
        description={
          bg
            ? "Европейските и националните пари, които стигат до културата извън обществените поръчки — ИСУН, ДФЗ и Interreg, всяко с основата си и с покритието си."
            : "The European and national money reaching culture outside public procurement — ИСУН, ДФЗ and Interreg, each with its basis and its coverage."
        }
      >
        {bg ? "Еврофондове и субсидии" : "EU funds and subsidies"}
      </Title>
      <SectorBreadcrumb
        parent={{ label: bg ? "Култура" : "Culture", to: "/culture" }}
        current={bg ? "Еврофондове" : "EU funds"}
      />

      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
        {bg
          ? "Редовете по-долу НЕ се събират. Всеки е от различен регистър, на различна основа: едното е стойност на договор, другото е публикуван бюджет на партньор, третото — земеделска субсидия. Затова всеки носи основата си до себе си."
          : "The rows below do NOT sum. Each comes from a different register on a different basis: one is a contract value, another a partner's published budget, a third a farm subsidy. So each carries its basis beside it."}
      </p>

      {isLoading && (
        <div className="mt-4 h-40 animate-pulse rounded-xl border bg-card" />
      )}

      {!isLoading && !s && (
        <div className="mt-4 rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {bg
            ? "Обобщените числа не са налични на този сървър — стартирай npm run db:gen-culture-hub-stats."
            : "The summary figures are not available on this server — run npm run db:gen-culture-hub-stats."}
        </div>
      )}

      {s && (
        <div className="mt-4 space-y-6">
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.key} className="rounded-xl border bg-card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{r.label}</span>
                  <span className="shrink-0 text-xl font-bold tabular-nums">
                    {eur(r.eur)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{r.sub}</p>
                <p className="mt-2 text-xs text-muted-foreground">{r.basis}</p>
              </li>
            ))}
          </ul>

          <section id="chitalishta" className="scroll-mt-20 space-y-2">
            <h2 className="text-lg font-semibold">
              {bg ? "Читалищата" : "Народни читалища"}
            </h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {bg
                ? `Читалищата са най-широкият културен поток по брой получатели: ${eur(s.funds.chitalishtaEur)} по ИСУН и ${eur(s.agri.chitalishtaEur)} по ДФЗ. Те са самостоятелни юридически лица с общинско делегиране — около 3 000 на брой, с текучество — затова групата се определя по ИМЕ, а не със списък с ЕИК, и затова не влиза в заглавната цифра на сектора.`
                : `Читалища are culture's widest stream by recipient count: ${eur(s.funds.chitalishtaEur)} from ИСУН and ${eur(s.agri.chitalishtaEur)} from ДФЗ. They are independent legal entities with municipal delegation — about 3,000 of them, with turnover — so the group is defined by NAME rather than by an EIK list, and stays out of the sector's headline figure.`}
            </p>
          </section>

          <section id="spine" className="scroll-mt-20 space-y-2">
            <h2 className="text-lg font-semibold">
              {bg ? "Проследи парите" : "Follow the money"}
            </h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {bg
                ? "Кодът по ПВУ (BG-RRP-…) на един грант се записва и в текста на поръчката, която той плаща — така грантът, процедурата, договорът и изпълнителят се свързват в една верига. Спината покрива само частта по ПВУ; договорите по ЕФРР и ЕСФ не носят такъв код."
                : "A grant's RRF code (BG-RRP-…) is written into the text of the procurement it pays for, which links grant, procedure, contract and contractor into one chain. The spine covers the RRF slice only — ЕФРР and ЕСФ contracts carry no such code."}
            </p>
            <p className="text-sm">
              <Link to="/funds" className="text-primary hover:underline">
                {bg ? "Виж всички еврофондове →" : "See all EU funds →"}
              </Link>
            </p>
          </section>
        </div>
      )}
    </>
  );
};
