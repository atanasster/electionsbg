/** Specific civic intents before broad budget, place and election fallbacks.
 * These rules inspect ordinary user text; they do not import the starter catalog.
 */
import type { ToolArgs } from "../tools/types";
import { findOblastInText } from "../tools/place";
export const routeCivicQuestion = (
  raw: string,
): { tool: string; args: ToolArgs } | null => {
  const q = raw.toLowerCase().trim();
  const hit = (re: RegExp) => re.test(q);
  const result = (tool: string, args: ToolArgs = {}) => ({ tool, args });
  const captured = (re: RegExp) =>
    raw
      .replace(/[?.!]+$/, "")
      .match(re)?.[1]
      ?.trim()
      .replace(/[?.!]+$/, "");
  const place = () =>
    captured(/.*(?:\bin\s+|\sв\s+)(?:община\s+)?([^?]+)$/i) ??
    captured(/(?:\bof\s+|\sна\s+)(?:община\s+)?([^?]+)$/i);
  if (hit(/президентск|presidential/) && hit(/кръг\s*[12]|round\s*[12]/))
    return result("presidentialResults", {
      cycle: q.match(/20\d{2}/)?.[0],
      round: Number(q.match(/(?:кръг|round)\s*([12])/)?.[1]),
    });
  if (hit(/дигитални умения|digital skills/)) return result("digitalSkills");
  if (hit(/нощувк|туризм|guest nights|touris/)) {
    if (hit(/държав|от кои|countries|source market/))
      return result("tourismSourceMarkets");
    if (hit(/сезон|season|summer|лято|лятото/))
      return result("tourismSeasonality");
  }
  if (hit(/жертв.*пътя|road deaths|загинал.*път/))
    return result("securityRoadSafety");
  if (hit(/weaponry.*export|arms.*export/)) return result("armsExports");
  if (hit(/army.*(?:manned|unfilled)|незает.*армия/))
    return result("defenseReadiness");
  if (hit(/heating aid|помощ.*отопление/)) return result("socialBenefits");
  if (
    hit(
      /social.assistance.*(?:procurement|award)|procurement.*social.assistance/,
    )
  )
    return result("socialSpending");
  if (hit(/регионалн.*инвестици|regional investments/))
    return result("regionalInvestment");
  if (hit(/(?:clinical pathways|клинични пътеки).*(?:често|often)/))
    return result("nzokActivities");
  if (hit(/(?:спести|save).*(?:лекарств|medicin)/))
    return result("nzokDrugSavings");
  if (hit(/(?:болниц|hospitals).*(?:хемодиализ|haemodialys)/))
    return result("nzokPathwayHospitals", { procedure: "хемодиализа" });
  if (hit(/спрямо другите болници|compare to other hospitals/))
    return result("nzokHospitalScorecard", {
      hospital: captured(/(?:представя|does)\s+(.+?)\s+(?:спрямо|compare)/i),
    });
  const contract = q.match(/\b[a-f0-9]{12}\b/)?.[0];
  if (contract && hit(/типичн|normal/))
    return result("procurementNormalcy", { key: contract });
  if (hit(/(?:хемус|hemus)/) && hit(/договор|contracted|възлож/))
    return result("projectLifecycle", { project: "hemus" });
  if (
    hit(/(?:кино|film).*(?:субсиди|subsid)|(?:субсиди|subsid).*(?:кино|film)/)
  ) {
    const company =
      captured(/получил(?:а)?\s+(.+?)\s+за кино/i) ??
      captured(/did\s+(.+?)\s+receive/i);
    if (company) return result("filmSubsidyForProducer", { company });
  }
  if (hit(/субсидии.*получила|subsidies.*receive/))
    return result("subsidiesForEntity", {
      company:
        captured(/получила\s+(.+)/i) ?? captured(/did\s+(.+?)\s+receive/i),
    });
  if (hit(/eu funding.*absorbed/)) return result("fundsProjects");
  if (hit(/financial reports.*time/)) return result("financingOverview");
  if (hit(/(?:емисии.*дълг|debt issuances)/)) return result("govDebt");
  if (hit(/(?:матура|matura).*(?:училище|school)\s*[:—-]/))
    return result("schoolMatura", {
      school: captured(/(?:училище|school)\s*[:—-]\s*(.+)/i),
    });
  if (
    hit(/(?:училища|schools).*(?:в\s|in\s)/) &&
    hit(/най-добр|best|успех|scores/)
  )
    return result("schoolScores", { place: place() });
  if (hit(/(?:air|въздух).*\s(?:in|в)\s/))
    return result("airQuality", { place: place() });
  if (hit(/регистриран.*адрес|registered by address/))
    return result("graoPopulation", { place: place() });
  if (hit(/прозрачна.*община|transparent/))
    return result("transparencyScore", {
      place: captured(/община\s+(.+)/i) ?? captured(/transparent is\s+(.+)/i),
    });
  if (hit(/европейски проекти|eu projects/) && place())
    return result("placeEuProjects", {
      place: place()?.replace(/\s+munic[ií]pio$/i, ""),
    });
  if (hit(/обществени поръчки.*област|procurement.*province/)) {
    const oblast = findOblastInText(q)?.code;
    if (oblast) return result("procurementByOblast", { oblast });
  }
  if (hit(/basket.*risen.*euro/)) return result("priceIndex");
  if (hit(/(?:цена на продукт|product price)\s*[:—-]/))
    return result("productPrice", {
      product: captured(/(?:цена на продукт|product price)\s*[:—-]\s*(.+)/i),
    });
  if (hit(/which municipalities.*highest unemployment/))
    return result("rankPlaces", { indicator: q });
  if (
    hit(/(?:последните избори|latest election)/) &&
    hit(/активност|turnout/) &&
    !hit(/от\s+\d{4}|since/)
  )
    return result("turnout");
  if (hit(/(?:парти|parties).*(?:преброяването наново|recount)/))
    return result("recountByParty", { election: q.match(/20\d{2}/)?.[0] });
  if (hit(/(?:anomalies).*(?:election)/)) return result("electionAnomalies");
  if (hit(/partial local elections|частични местни избори/))
    return result("chmiEvents");
  if (hit(/municipal councils/) && hit(/won/))
    return result("localCouncilVoteShare");
  if (hit(/how many mayors.*win locally/)) return result("localMayorsWon");
  if (hit(/local.election council votes flow/)) return result("localVoteFlows");
  if (hit(/parliamentary votes.*local council/))
    return result("localPrevoteFlow");
  if (hit(/общински съвет|council vote/) && hit(/променя|changed/) && place())
    return result("localPlaceTrend", {
      place: place()?.replace(/\s+changed$/i, ""),
    });
  if (hit(/(?:секции|polling stations).*(?:кмет|mayor)/))
    return result("localMayorSections", {
      place:
        captured(/кметът на\s+(.+?)\s+спечели/i) ??
        captured(/mayor of\s+(.+?)\s+win/i),
    });
  if (hit(/(?:ромски квартали|roma neighbourhoods)/) && hit(/променя|change/))
    return result("romaVoteTrend");
  if (
    hit(/(?:рисковия анализ|risk analysis)/) &&
    hit(/(?:секци|polling stations)/)
  )
    return result("problemSections");
  if (hit(/(?:вота се запазва|votes persists)/))
    return result("voterPersistence");
  if (hit(/group votes.*cohesively/)) return result("factionCohesion");
  const party = q.match(/\b(gerb|bsp|dps|itn|pp-db)\b/)?.[1];
  if (party && hit(/performed over the years/))
    return result("partyTimeline", { party });
  if (party && hit(/by municipality/))
    return result("municipalityBreakdown", {
      party,
      oblast: findOblastInText(q)?.code,
    });
  if (party && hit(/by settlement/))
    return result("settlementBreakdown", {
      party,
      place: place()
        ?.replace(/\s+municipality$/i, "")
        .toLowerCase(),
    });
  if (hit(/section\s+\d{9}.*over the years/))
    return result("sectionHistory", { section: q.match(/\d{9}/)?.[0] });
  return null;
};
