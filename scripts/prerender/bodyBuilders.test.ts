// The prerendered /procurement/settlement/{ekatte} body must NAME ITS OWN SCOPE.
//
// The figures baked in here come from procurement_by_settlement(NULL, NULL) — the whole
// corpus — but the live page defaults to the selected parliament's window (?pscope). A
// static page cannot track a URL parameter, so the only honest option is to say which
// period it is quoting. Without that, the text Google indexes states a total that no
// default view of the page displays, and a reader arriving from search sees a smaller
// number and reads it as a contradiction.
//
// The instruction it gives ("pick X") names a real button, so the label is pinned against
// the locale bundle the button actually renders from — a rename there would otherwise
// leave the prerendered HTML telling readers to click something that no longer exists.

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildProcurementSettlementBody,
  buildPollsAgencyBody,
  buildPollsBody,
  SCOPE_ALL_YEARS_LABEL,
} from "./bodyBuilders";
import bg from "../../src/locales/bg/translation.json";
import en from "../../src/locales/en/translation.json";
import { SITE_ORIGIN } from "@/lib/siteOrigin";

const varna = {
  name: "Варна",
  province: "Варна",
  contractCount: 15079,
  totalEur: 3622680723,
  awarderCount: 112,
};

describe("buildProcurementSettlementBody", () => {
  it("states that the figures cover all years, in both languages", () => {
    expect(buildProcurementSettlementBody("bg", varna)).toContain(
      "за целия период",
    );
    expect(buildProcurementSettlementBody("en", varna)).toContain(
      "across all years on record",
    );
  });

  it("says the page defaults to a NARROWER window", () => {
    // Naming the scope is only half of it: without this clause the reader has no reason
    // to expect the on-screen number to differ at all.
    expect(buildProcurementSettlementBody("bg", varna)).toContain(
      "текущия парламент",
    );
    expect(buildProcurementSettlementBody("en", varna)).toContain(
      "current parliament",
    );
  });

  it("quotes the EXACT label ScopeControl renders", () => {
    // The one assertion that couples this static string to the running UI. If
    // `procurement_scope_all_years` is ever reworded, this fails here rather than
    // shipping HTML that points at a button by the wrong name.
    expect(SCOPE_ALL_YEARS_LABEL.bg).toBe(
      (bg as Record<string, string>).procurement_scope_all_years,
    );
    expect(SCOPE_ALL_YEARS_LABEL.en).toBe(
      (en as Record<string, string>).procurement_scope_all_years,
    );
    expect(buildProcurementSettlementBody("bg", varna)).toContain(
      `„${SCOPE_ALL_YEARS_LABEL.bg}“`,
    );
    expect(buildProcurementSettlementBody("en", varna)).toContain(
      `“${SCOPE_ALL_YEARS_LABEL.en}”`,
    );
  });

  it("still carries the three figures the body is built from", () => {
    const out = buildProcurementSettlementBody("bg", varna);
    expect(out).toContain("15 079");
    expect(out).toContain("112");
    expect(out).toContain("Варна");
  });

  it("appends the province only when it differs from the settlement", () => {
    const sofia = { ...varna, name: "София", province: "София (столица)" };
    expect(buildProcurementSettlementBody("bg", sofia)).toContain(
      "София, София (столица)",
    );
    // Варна in Варна must not read "Варна, Варна".
    expect(buildProcurementSettlementBody("bg", varna)).not.toContain(
      "Варна, Варна",
    );
  });

  it("escapes the place name rather than interpolating it raw", () => {
    const evil = { ...varna, name: "<script>alert(1)</script>", province: "x" };
    const out = buildProcurementSettlementBody("bg", evil);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
});

// Tier 4 T4.4 Increment C — the presidential-polls section `buildPollsBody` /
// `buildPollsAgencyBody` append, read from decision 10's separate file family
// (`polls/presidential/*.json`) at build time so the band is in the static HTML.
describe("presidential polls section (buildPollsBody / buildPollsAgencyBody)", () => {
  const roots: string[] = [];
  const publicRoot = (): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polls-body-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "polls", "presidential"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "polls", "agencies.json"),
      JSON.stringify([
        { id: "GM", name_bg: "Глобал Метрикс", name_en: "Global Metrics" },
      ]),
    );
    return root;
  };
  const AGENCY = {
    id: "GM",
    name_bg: "Глобал Метрикс",
    name_en: "Global Metrics",
  };
  const POLL = {
    id: "gm-2026-07-11",
    agencyId: "GM",
    fieldwork: "through Jul 11 2026",
    electionDate: "2026-11-08",
    respondents: 1503,
    methodology: { bg: "Метод", en: "Method" },
    source: "https://globalmetrics.eu/example",
    race: "presidential",
    cycle: null,
  };
  const DETAILS = [
    {
      pollId: POLL.id,
      agencyId: "GM",
      candidateKey: "provisional:илияна-йотова",
      candidateName_bg: "Илияна Йотова",
      candidateName_en: "Iliana Yotova",
      nominator: null,
      placeholderFor: null,
      support: 30,
    },
  ];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
  });

  it("buildPollsBody omits the section entirely when no presidential polls.json exists", () => {
    const root = publicRoot();
    expect(buildPollsBody(root)).not.toContain("Президентски проучвания");
  });

  it("buildPollsBody omits the section for an empty presidential corpus", () => {
    const root = publicRoot();
    fs.writeFileSync(
      path.join(root, "polls", "presidential", "polls.json"),
      "[]",
    );
    expect(buildPollsBody(root)).not.toContain("Президентски проучвания");
  });

  it("buildPollsBody appends one row per agency's latest poll, linking to /polls/:agencyId", () => {
    const root = publicRoot();
    fs.writeFileSync(
      path.join(root, "polls", "presidential", "polls.json"),
      JSON.stringify([POLL]),
    );
    fs.writeFileSync(
      path.join(root, "polls", "presidential", "polls_details.json"),
      JSON.stringify(DETAILS),
    );
    const out = buildPollsBody(root);
    expect(out).toContain("Президентски проучвания");
    expect(out).toContain(`href="${SITE_ORIGIN}/polls/GM"`);
    expect(out).toContain("Илияна Йотова");
  });

  it("buildPollsAgencyBody appends the agency's own presidential polls even with no parliamentary take", () => {
    // The real case this exists for: GM has zero SCORED parliamentary polls (no entry in
    // analysis.json's agencyTakes), so `take` is undefined and the function returns early —
    // the presidential section must already be in `parts` by the time that early return fires.
    const root = publicRoot();
    fs.writeFileSync(
      path.join(root, "polls", "analysis.json"),
      JSON.stringify({ agencyTakes: [] }),
    );
    fs.writeFileSync(
      path.join(root, "polls", "presidential", "polls.json"),
      JSON.stringify([POLL]),
    );
    fs.writeFileSync(
      path.join(root, "polls", "presidential", "polls_details.json"),
      JSON.stringify(DETAILS),
    );
    const out = buildPollsAgencyBody(root, AGENCY);
    expect(out).toContain("Президентски проучвания");
    expect(out).toContain("Илияна Йотова");
    expect(out).toContain("30.0%");
  });

  it("buildPollsAgencyBody still renders the take's summary/lean/warning after the presidential section, when analysis.json has one", () => {
    // The pre-existing case Increment C's restructuring must leave unchanged: an agency WITH
    // a scored parliamentary take. The presidential section (independent of `take`) must
    // appear too, and in the right order — before the take-derived sections, matching where
    // it is inserted in `buildPollsAgencyBody`.
    const root = publicRoot();
    fs.writeFileSync(
      path.join(root, "polls", "analysis.json"),
      JSON.stringify({
        agencyTakes: [
          {
            agencyId: "GM",
            summary: { bg: "Резюме за GM" },
            lean: { bg: "Отклонение за GM" },
            warning: { bg: "Предупреждение за GM" },
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(root, "polls", "presidential", "polls.json"),
      JSON.stringify([POLL]),
    );
    fs.writeFileSync(
      path.join(root, "polls", "presidential", "polls_details.json"),
      JSON.stringify(DETAILS),
    );
    const out = buildPollsAgencyBody(root, AGENCY);
    expect(out).toContain("Президентски проучвания");
    expect(out).toContain("Резюме за GM");
    expect(out).toContain("Отклонение за GM");
    expect(out).toContain("Предупреждение за GM");
    expect(out.indexOf("Президентски проучвания")).toBeLessThan(
      out.indexOf("Резюме за GM"),
    );
  });

  it("buildPollsAgencyBody still renders the agency name and presidential section when analysis.json is entirely absent", () => {
    // Found via a smoke test against the real corpus: the function used to `return ""` the
    // instant `analysis.json` did not exist — not merely when this agency had no `take` — so
    // a fresh build (or any machine that has not yet generated the parliamentary narrative)
    // rendered a completely blank body for a presidential-only agency, presidential section
    // included.
    const root = publicRoot();
    fs.writeFileSync(
      path.join(root, "polls", "presidential", "polls.json"),
      JSON.stringify([POLL]),
    );
    fs.writeFileSync(
      path.join(root, "polls", "presidential", "polls_details.json"),
      JSON.stringify(DETAILS),
    );
    const out = buildPollsAgencyBody(root, AGENCY);
    expect(out).toContain("Глобал Метрикс");
    expect(out).toContain("Президентски проучвания");
    expect(out).toContain("Илияна Йотова");
  });

  it("buildPollsAgencyBody omits the section for an agency with no presidential poll", () => {
    const root = publicRoot();
    fs.writeFileSync(
      path.join(root, "polls", "analysis.json"),
      JSON.stringify({ agencyTakes: [] }),
    );
    fs.writeFileSync(
      path.join(root, "polls", "presidential", "polls.json"),
      JSON.stringify([{ ...POLL, agencyId: "TR" }]),
    );
    const out = buildPollsAgencyBody(root, AGENCY);
    expect(out).not.toContain("Президентски проучвания");
  });
});
