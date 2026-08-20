// АОП — Списък с външни експерти по чл. 232а, ал. 2 от ЗОП (plan P4).
//
// The state's list of external experts a contracting authority may co-opt onto an
// evaluation committee. Joined to the procurement-officer layer it makes „the same
// person wrote the documentation and then sat on the committee" a query rather than
// an investigation.
//
// ⚠️ THE REGISTER IS HISTORICAL AND CLOSED IN PRACTICE — this is the single most
// important fact about the dataset and every consumer must carry it. Measured
// 2026-08-20 over the full crawl: 88 experts, and **not one of them is still
// valid**. The newest validity ended 2023-01-01 and no expert has been added since
// 2020-01-01. So the register answers „who WAS an approved external expert between
// 2017 and 2023"; it cannot answer „who is available now", and any surface phrasing
// it in the present tense is asserting something the source does not say.
//
// Finding it is worth recording, because the obvious search does not: aop.bg's own
// navigation does not link it, and `www.aop.bg/ee2014.php` — the URL the ЦАИС
// bundle carries for the чл. 229 list — is a 404. The live URL is the OTHER config
// key in the same object (`externalExperts229AUrl` in app.eop.bg's main bundle),
// and the page behind it is a plain 1990s PHP GET form, not the Angular SPA that
// links to it.
//
// The transport is deliberately dull: a GET, no session, no cookie, no token, and
// a windows-1251 body. The one non-obvious parameter is `ets_prof_oblast` — the
// register has no „all areas" option, so membership is only obtainable as one
// query per competence area.

export const AOP_EXPERTS_URL = "https://www.aop.bg/ets.php";

/** Politeness + identification. */
export const AOP_EXPERTS_UA =
  "electionsbg.com data pipeline (procurement/aop-experts)";

/** Competence areas are numbered 1..77 in the register's own <select>. There is no
 *  „--- Всички ---" that returns rows: submitting the blank form re-renders the
 *  form with no result table at all, so the areas ARE the enumeration.
 *
 *  ⚠️ An expert may hold SEVERAL areas (28 of 88 do), so the per-area counts sum to
 *  more than the register's size. Dedupe on УНЕ — never sum the areas. */
export const AOP_EXPERT_AREAS: readonly number[] = Array.from(
  { length: 77 },
  (_, i) => i + 1,
);

/** One competence area's result page. Every field is sent, blank, exactly as the
 *  form does — the register is an old PHP script and there is no reason to discover
 *  which omissions it tolerates. */
export const areaUrl = (area: number): string => {
  if (!Number.isInteger(area) || area < 1)
    throw new Error(`areaUrl: area must be a positive integer, got ${area}`);
  const q = new URLSearchParams({
    mode: "search",
    ets_venum: "",
    ets_appl_id: "",
    first_name: "",
    mid_name: "",
    last_name: "",
    ets_prof_oblast: String(area),
  });
  return `${AOP_EXPERTS_URL}?${q}`;
};

/** The register's page is windows-1251 and says so only in a <meta>. Decoding it as
 *  UTF-8 does not throw — it yields replacement characters, i.e. a corpus of
 *  mojibake names that still passes every row count. */
export const AOP_EXPERTS_ENCODING = "windows-1251";
