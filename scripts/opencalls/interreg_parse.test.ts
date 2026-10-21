// Interreg parsers, against fixtures captured from the live programme sites on 2026-08-09.
//
// The test that matters most is the first one in `parseWindow`: a call whose page carries a
// programme-period date THREE YEARS after its real deadline. On this dataset a wrong date is not
// a wrong number — it is a reader who misses a deadline, or prepares an application for a call
// that shut seven weeks ago. Every other assertion here is downstream of that one.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  callSlug,
  labelledDeadlines,
  latestLabelledDeadline,
  listCallUrls,
  parseDeadlineClock,
  parseMrrbCall,
  parseMrrbCallTerms,
  parseMrrbNextPage,
  parseMrrbNodeLinks,
  parseProseDate,
  parseCall,
  parseEuroAmount,
  parseIndex,
  parseSlashDate,
  parseTitle,
  parseWindow,
  parseClockTime,
  parseWordDate,
  PROGRAMMES,
  visibleText,
} from "./interreg_parse";

const FIX = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
);
const fx = (n: string) => readFileSync(path.join(FIX, n), "utf8");
const [GBG, BSB] = PROGRAMMES;
const BGRS = PROGRAMMES.find((p) => p.code === "interreg-bg-rs")!;
const ROBG = PROGRAMMES.find((p) => p.kind === "robg")!;

/** The real fixtures behind each parser KIND. A programme whose kind has none here is a
 *  programme no test has ever parsed — the gate below fails on it. */
const FIXTURES_BY_KIND: Record<(typeof PROGRAMMES)[number]["kind"], string[]> =
  {
    gbg: ["interreg_gbg_index.html", "interreg_gbg_call.html"],
    bsb: ["interreg_bsb_index.html", "interreg_bsb_call.html"],
    mrrb: [
      "interreg_mrrb_bgrs_home.html",
      "interreg_mrrb_bgrs_term37.html",
      "interreg_mrrb_bgrs_node250.html",
      "interreg_mrrb_bgrs_node142.html",
      "interreg_mrrb_bgrs_node249.html",
    ],
    robg: [
      "interreg_robg_index.html",
      "interreg_robg_call2.html",
      "interreg_robg_call6.html",
      "interreg_robg_call7.html",
    ],
  };

/** The Sofia calendar day an instant falls on — what a reader sees as „the deadline". */
const sofiaDayOf = (iso: string | null) =>
  iso === null
    ? null
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Sofia",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(iso));

describe("PROGRAMMES", () => {
  it("every listed programme's parser kind is backed by real fixtures", () => {
    // Replaces „lists only programmes that were actually reachable", which pinned the 2014–2020
    // hostnames as blocked — a measurement against the wrong sites (audit 2026-10-21, row 12).
    // The rule it guarded still holds, stated the right way round: a programme is listed only if
    // a test has parsed its pages.
    for (const p of PROGRAMMES) {
      const files = FIXTURES_BY_KIND[p.kind];
      expect(files?.length, p.code).toBeGreaterThan(0);
      for (const f of files)
        expect(existsSync(path.join(FIX, f)), f).toBe(true);
    }
  });

  it("covers all six Bulgarian cross-border programmes", () => {
    expect(PROGRAMMES.map((p) => p.code).sort()).toEqual(
      [
        "interreg-bg-mk",
        "interreg-bg-rs",
        "interreg-bg-tr",
        "interreg-bsb",
        "interreg-gr-bg",
        "interreg-ro-bg",
      ].sort(),
    );
  });

  it("every programme's callPrefix is under its index host", () => {
    // A prefix pointing elsewhere would make `parseIndex` follow off-site links.
    for (const p of PROGRAMMES)
      expect(new URL(p.callPrefix).host, p.code).toBe(new URL(p.indexUrl).host);
  });
});

describe("date parsing", () => {
  it("reads the two formats the programmes actually print", () => {
    expect(sofiaDayOf(parseSlashDate("22/06/2026"))).toBe("2026-06-22");
    expect(sofiaDayOf(parseSlashDate("1/5/2026"))).toBe("2026-05-01");
    expect(sofiaDayOf(parseWordDate("28 June, 2024"))).toBe("2024-06-28");
    expect(sofiaDayOf(parseWordDate("30 March 2023"))).toBe("2023-03-30");
  });

  it("is DAY-first — both programmes are European", () => {
    // Read month-first, 22/06 would be an invalid month and 06/07 would be the wrong day.
    expect(sofiaDayOf(parseSlashDate("06/07/2026"))).toBe("2026-07-06");
  });

  it("KEEPS the time of day, and defaults to end-of-day rather than midnight", () => {
    // Midnight marks a call closed for the whole of its final day and NULLs `days_left` a day
    // early — on this dataset that is the harm the feature exists to prevent.
    expect(parseSlashDate("22/06/2026", { h: 14, mi: 0 })).toBe(
      "2026-06-22T11:00:00.000Z",
    );
    // No time printed → 23:59 local, i.e. open through the stated last day.
    expect(parseSlashDate("22/06/2026")).toBe("2026-06-22T20:59:00.000Z");
  });

  it("is DST-correct, not a fixed +02:00", () => {
    // June is EEST (+03), January is EET (+02). A fixed offset is an hour wrong for every
    // summer deadline, which is most of them.
    expect(parseSlashDate("22/06/2026", { h: 14, mi: 0 })).toBe(
      "2026-06-22T11:00:00.000Z",
    );
    expect(parseSlashDate("22/01/2026", { h: 14, mi: 0 })).toBe(
      "2026-01-22T12:00:00.000Z",
    );
  });

  it("returns null rather than a wrong date", () => {
    expect(parseSlashDate("22/13/2026")).toBeNull(); // month 13
    expect(parseSlashDate("2026-06-22")).toBeNull(); // not this format
    expect(parseWordDate("28 Juni, 2024")).toBeNull(); // not English
    expect(parseWordDate("")).toBeNull();
  });

  it("rejects a rolled-over date instead of silently shifting it", () => {
    // Date.UTC turns 31/02 into 3 March. A deadline that is WRONG is worse than one that is
    // absent, because nothing downstream can tell.
    expect(parseSlashDate("31/02/2026")).toBeNull();
    expect(parseWordDate("30 February 2026")).toBeNull();
  });
});

describe("parseEuroAmount", () => {
  it("reads the European format both sites use", () => {
    expect(parseEuroAmount("3.000.000,00€")).toBe(3_000_000);
    expect(parseEuroAmount("32.050.467,20 €")).toBeCloseTo(32_050_467.2, 2);
    expect(parseEuroAmount("600.000,00€")).toBe(600_000);
  });

  it("does not invent a second reading of an ambiguous separator", () => {
    // The enrichment gate's `numbersIn` deliberately returns every plausible reading, because
    // it is checking a model's quote. Here the field is labelled and structured, so exactly one
    // reading is correct and a second candidate would be a silent 1000x error.
    expect(parseEuroAmount("3.000.000,00€")).not.toBe(3);
    expect(parseEuroAmount("3.000.000,00€")).not.toBe(3000);
  });

  it("returns null when there is no amount", () => {
    expect(parseEuroAmount("to be announced")).toBeNull();
    expect(parseEuroAmount("0,00€")).toBeNull(); // zero is not a budget
  });
});

describe("parseClockTime", () => {
  it("reads both punctuations the sites use", () => {
    expect(parseClockTime("14.00 Eastern European Time (CET+1)")).toEqual({
      h: 14,
      mi: 0,
    });
    expect(parseClockTime("28 June, 2024 (14:00 hrs, Romania time)")).toEqual({
      h: 14,
      mi: 0,
    });
  });

  it("returns null when no time is printed", () => {
    expect(parseClockTime("deadline for submission of proposals")).toBeNull();
  });

  it("does not read a bare decimal as a time", () => {
    // „3.000.000,00€" is all over these pages; a looser pattern turns a budget into 3:00.
    expect(
      parseClockTime("Call Budget 3.000.000,00€ and more text"),
    ).toBeNull();
  });
});

describe("parseIndex", () => {
  it("finds every call on the Greece-Bulgaria index and no navigation", () => {
    const urls = parseIndex(fx("interreg_gbg_index.html"), GBG);
    expect(urls).toHaveLength(7);
    for (const u of urls) expect(u.startsWith(GBG.callPrefix)).toBe(true);
    // The index page itself is not a call.
    expect(urls).not.toContain(GBG.indexUrl);
  });

  it("finds both Black Sea calls, resolving root-relative hrefs", () => {
    // That site links its calls as `/interreg-next-bsb-…/first-call-…`, so a parser that only
    // matched absolute URLs would return zero and look like an empty programme.
    const urls = parseIndex(fx("interreg_bsb_index.html"), BSB);
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.startsWith("https://"))).toBe(true);
  });

  it("dedupes — both sites link the same call twice", () => {
    const urls = parseIndex(fx("interreg_bsb_index.html"), BSB);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("strips the fragment, so #section links are not separate calls", () => {
    const html = `<a href="${GBG.callPrefix}x/">a</a><a href="${GBG.callPrefix}x/#docs">b</a>`;
    expect(parseIndex(html, GBG)).toHaveLength(1);
  });
});

describe("parseWindow — the labelled deadline, never the latest date", () => {
  it("reads Greece-Bulgaria's real deadline, NOT the programme-period date", () => {
    // THE test. The page says „…until, exclusively, 22/06/2026 (deadline for submission…" and
    // also carries 31.12.2029 in a state-aid paragraph. A max-date heuristic publishes this
    // closed call as open for another three years.
    const text = visibleText(fx("interreg_gbg_call.html"));
    expect(text).toContain("31.12.2029");
    const w = parseWindow(text, "gbg");
    // 14.00 EEST on 22 June 2026 — the time is read from the phrase that follows the date.
    expect(w.closesAt).toBe("2026-06-22T11:00:00.000Z");
    expect(sofiaDayOf(w.opensAt)).toBe("2026-05-15");
    expect(w.closesAt?.startsWith("2029")).toBe(false);
  });

  it("reads Black Sea Basin's labelled deadline", () => {
    const w = parseWindow(visibleText(fx("interreg_bsb_call.html")), "bsb");
    // „(14:00 hrs, Romania time)" — same zone as Sofia, EEST in June.
    expect(w.closesAt).toBe("2024-06-28T11:00:00.000Z");
    expect(sofiaDayOf(w.opensAt)).toBe("2024-03-29");
  });

  it("returns nulls when no label is present", () => {
    // Two of the seven live Greece-Bulgaria pages are like this. They must become indicative
    // rows, never a guessed date.
    expect(
      parseWindow("Some page with 31/12/2029 on it and no labels", "gbg"),
    ).toEqual({
      opensAt: null,
      closesAt: null,
    });
    expect(parseWindow("Calls for proposals. Coming soon.", "bsb")).toEqual({
      opensAt: null,
      closesAt: null,
    });
  });

  it("does not read the OTHER programme's phrasing", () => {
    // One parser per shape, on purpose: a single extractor over both is how a change on one
    // site starts silently mis-parsing the other.
    const bsbText = visibleText(fx("interreg_bsb_call.html"));
    expect(parseWindow(bsbText, "gbg").closesAt).toBeNull();
  });
});

describe("parseTitle", () => {
  it("takes the LAST h1 — Black Sea renders a breadcrumb h1 above the real one", () => {
    // Taking the first gave every call on that programme the name „Calls for proposals".
    expect(parseTitle(fx("interreg_bsb_call.html"), "fb")).toBe(
      "Second Calls for Proposals",
    );
  });

  it("keeps Greece-Bulgaria's full title and decodes numeric entities", () => {
    // WordPress emits `&#038;` for the ampersand, so a named-only decoder leaves it visible.
    const t = parseTitle(fx("interreg_gbg_call.html"), "fb");
    expect(t).toContain("6TH CALL");
    expect(t).toContain("&");
    expect(t).not.toContain("&#");
    expect(t).not.toContain("amp;");
  });

  it("falls back rather than returning a site name", () => {
    expect(
      parseTitle("<html><body>no headings</body></html>", "the-slug"),
    ).toBe("the-slug");
  });
});

describe("parseCall", () => {
  it("builds a complete row from the Greece-Bulgaria fixture", () => {
    const c = parseCall(
      fx("interreg_gbg_call.html"),
      `${GBG.callPrefix}6th-call/`,
      GBG,
    )!;
    expect(c.source).toBe("interreg");
    expect(c.sourceKey).toBe("interreg-gr-bg:6th-call");
    expect(c.programmeCode).toBe("interreg-gr-bg");
    expect(c.datePrecision).toBe("exact");
    expect(c.closesAt).toBe("2026-06-22T11:00:00.000Z");
    expect(c.periodLabel).toBeNull();
    expect(c.budgetEur).toBe(3_000_000);
    // A labelled structured field published by the source — the same standing as the ДФЗ XLSX
    // columns, and what 142's CHECK requires before money may reach a sortable column.
    expect(c.enrichment).toBe("source");
  });

  it("REJECTS a page with no labelled deadline instead of filing it as indicative", () => {
    // The only bucket an undated row could reach is `indicative`, which the UI labels
    // „Очаквани приеми" — expected intakes. The two Greece-Bulgaria pages that hit this branch
    // are its 1st and 2nd calls, both long dead. Refusing to invent a date is right; filing a
    // dead call under „expected" turns that honesty into a forward-looking claim.
    expect(
      parseCall(
        "<html><h1>A call with no dates</h1></html>",
        `${GBG.callPrefix}x/`,
        GBG,
      ),
    ).toBeNull();
  });

  it("every row it DOES return is exact, so 142's date pairing holds by construction", () => {
    const c = parseCall(
      fx("interreg_gbg_call.html"),
      `${GBG.callPrefix}x/`,
      GBG,
    );
    expect(c?.datePrecision).toBe("exact");
    expect(c?.closesAt).toBeTruthy();
    expect(c?.periodLabel).toBeNull();
  });

  it("never claims money without a provenance 142 accepts", () => {
    // A dated page with no budget line — the money must stay NULL and the provenance 'none'.
    const c = parseCall(
      "<html><h1>No budget here</h1><p>deadline for submission of proposals 01/09/2026</p></html>",
      `${GBG.callPrefix}x/`,
      GBG,
    );
    expect(c?.budgetEur).toBeNull();
    expect(c?.enrichment).toBe("none");
  });

  it("resolves audience through the SHARED derivation, to `unknown` on an English page", () => {
    // `[]` would read as „no data"; `['unknown']` renders „не е уточнено" and keeps a
    // cross-border call out of a small business's default view. Hard-coding a facet would be a
    // guess — several of these calls are municipal and several are not.
    const c = parseCall(
      fx("interreg_gbg_call.html"),
      `${GBG.callPrefix}x/`,
      GBG,
    )!;
    expect(c.audience).toEqual(["unknown"]);
  });

  it("collects the application-pack documents from the Black Sea page", () => {
    const c = parseCall(
      fx("interreg_bsb_call.html"),
      `${BSB.callPrefix}second-call/`,
      BSB,
    )!;
    expect(c.docs.length).toBeGreaterThan(0);
    for (const d of c.docs) {
      expect(d.url.startsWith("http")).toBe(true);
      expect(d.label.length).toBeGreaterThan(0);
    }
  });

  it("keys on the slug, so a retitled call is the same row", () => {
    expect(callSlug("https://x/call/6th-call/")).toBe("6th-call");
    expect(callSlug("https://x/call/6th-call")).toBe("6th-call");
  });
});

// ── the prose-deadline programmes (МРРБ IPA ×3, RO-BG) — fixtures captured 2026-10-21 ──

describe("parseProseDate — every spelling measured on these sites", () => {
  it.each([
    ["15 September 2023", "2023-09-15"],
    ["15th of August 2023", "2023-08-15"],
    ["31 th of July 2023", "2023-07-31"],
    ["3th of January 2024", "2024-01-03"],
    ["22 nd of December 2025", "2025-12-22"],
    ["June 6, 2025", "2025-06-06"],
    ["March, 20-th, 2024", "2024-03-20"],
    ["02.09.2024", "2024-09-02"],
    ["15/09/2025", "2025-09-15"],
  ])("%s", (raw, want) => {
    const d = parseProseDate(raw)!;
    expect(
      `${d.y}-${String(d.mo).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`,
    ).toBe(want);
  });

  it("does not read a budget as a date", () => {
    // „The total budget of the call is EUR 8 529 412" sits a sentence away from deadlines.
    expect(parseProseDate("8 529 412 Euro")).toBeNull();
  });
});

describe("parseDeadlineClock", () => {
  it.each([
    [", 17:00 EEST", { h: 17, mi: 0 }],
    [", 17.00 h. local time", { h: 17, mi: 0 }],
    [", 5:00 p.m. (Bulgarian time)", { h: 17, mi: 0 }],
    [", 5 p.m. local time", { h: 17, mi: 0 }],
    [", 12.00 (PM)", { h: 12, mi: 0 }], // noon, NOT midnight
    [", 13.00 (PM)", { h: 13, mi: 0 }], // already 24-hour
    [", 13:00 o’clock", { h: 13, mi: 0 }],
    [", 24:00 h. local time", { h: 23, mi: 59 }], // end of day, not next morning
  ])("%s", (after, want) => expect(parseDeadlineClock(after)).toEqual(want));

  it("does not reach into the next sentence", () => {
    expect(parseDeadlineClock(". Info day in Sofia at 10:00")).toBeNull();
  });

  it("does not read the start of a following DATE as a time", () => {
    // „20.10.2024" is a date; reading it as 20:10 moves the deadline by hours.
    expect(parseDeadlineClock(" (published 20.10.2024)")).toBeNull();
  });
});

describe("labelledDeadlines — the label is an allow-list of WHAT is submitted", () => {
  const day = (iso: string) => sofiaDayOf(iso);

  it("reads the application deadline and NOT the questions deadline beside it", () => {
    // bg-rs node 133, verbatim shape: the questions deadline is labelled too, three weeks early.
    const t =
      "Deadline: June 11, 2025, 17:00 EET You can contact the Joint Secretariat. " +
      "Deadline for Submission of Questions: Questions may be submitted no later than 21 " +
      "calendar days before the deadline (by May 21, 2025 ).";
    expect(labelledDeadlines(t).map((d) => day(d.iso))).toEqual(["2025-06-11"]);
  });

  it('ignores a registration deadline and a consultation „until"', () => {
    const t =
      "Deadline for registration: April 14, 2025, Monday, by 17:00 EET. " +
      "Comments on the draft Guidelines for Applicants are welcome until 27 October 2025.";
    expect(labelledDeadlines(t)).toEqual([]);
  });

  it("a bare „deadline:\" qualified by ANOTHER noun is not the call's", () => {
    for (const q of ["Registration", "Questions", "Payment"])
      expect(
        labelledDeadlines(`${q} deadline: 1 June 2026, 17:00 EET`),
        q,
      ).toEqual([]);
    // …while a bare „Deadline:" after a URL — bg-rs node 147, verbatim — still reads.
    expect(
      labelledDeadlines(
        "Jems: https://jems-bgrs.mrrb.bg Deadline: June 6, 2025, 17:30 Bulgarian Local Time",
      ).length,
    ).toBe(1);
  });

  it("finds the date past a non-date digit in the filler", () => {
    // Stopping at the first digit („Call 2") lost this deadline entirely.
    const t =
      "The deadline for submission of project proposals under Call 2 is 15 September 2023, 17:00 EEST.";
    expect(labelledDeadlines(t).map((d) => day(d.iso))).toEqual(["2023-09-15"]);
  });

  it("ignores a HEADLINE announcing an extension, which is followed by a publish date", () => {
    // bg-tr node 129: „…and extension of the deadline for project submission 08.02.2024 Dear…"
    const t =
      "Corrigendum and extension of the deadline for project submission 08.02.2024 Dear " +
      "applicants, … The deadline for submitting the project proposal is extended to " +
      "March 20, 2024, 5 p.m. local time in Bulgaria.";
    expect(labelledDeadlines(t).map((d) => day(d.iso))).toEqual(["2024-03-20"]);
  });

  it("takes the LATEST labelled deadline, so an extension wins", () => {
    const t =
      "The deadline for uploading applications in the Jems system is: 30th of June 2026, " +
      "13:00 o’clock The new deadline for uploading applications in the Jems system is: " +
      "15 th of July 2026, 13:00 o’clock";
    expect(day(latestLabelledDeadline(t)!)).toBe("2026-07-15");
  });

  it("within one day, a printed time beats a reminder that restates the date bare", () => {
    // bg-mk Territorial Strategy: the untimed reminder would default to 23:59 and publish the
    // call as open seven hours after it shut.
    const t =
      "The deadline for submission of Full Project Proposals in Jems is 30 July 2024, " +
      "17:00 EEST. The deadline for submitting full project proposals is set for 30 July 2024.";
    expect(latestLabelledDeadline(t)).toBe("2024-07-30T14:00:00.000Z");
  });

  it("returns null rather than a guess when nothing is labelled", () => {
    expect(
      latestLabelledDeadline("Info day in Sofia: 25 June 2025"),
    ).toBeNull();
  });
});

describe("МРРБ programmes (mrrb) — bg-rs fixtures", () => {
  const home = fx("interreg_mrrb_bgrs_home.html");
  const term = fx("interreg_mrrb_bgrs_term37.html");
  const node = (n: string) => ({
    url: `https://ipa-bgrs.mrrb.bg/en/term/10/node/${n}`,
    html: fx(`interreg_mrrb_bgrs_node${n}.html`),
  });
  const TERM37 = {
    url: "https://ipa-bgrs.mrrb.bg/en/term/37",
    title: "Second Call for SMEs",
    html: term,
  };

  it('lists one call per „Calls for proposals" term and skips the timetable', () => {
    const terms = parseMrrbCallTerms(home, BGRS);
    expect(terms.length).toBe(7);
    expect(terms).toContainEqual({
      url: "https://ipa-bgrs.mrrb.bg/en/term/37",
      title: "Second Call for SMEs",
    });
    expect(terms.some((t) => /timetable/i.test(t.title))).toBe(false);
    // The crawler and the watcher read the same list.
    expect(listCallUrls(home, BGRS)).toEqual(terms.map((t) => t.url));
  });

  it("finds a term's news nodes and its pager", () => {
    const nodes = parseMrrbNodeLinks(term, BGRS);
    expect(nodes.length).toBe(10);
    expect(nodes).toContain("https://ipa-bgrs.mrrb.bg/en/term/10/node/250");
    expect(parseMrrbNextPage(term, TERM37.url)).toBe(
      "https://ipa-bgrs.mrrb.bg/en/term/37?page=1",
    );
  });

  it('CLOSED: dates the call from its announcement node, keeping „5:00 p.m."', () => {
    const c = parseMrrbCall(
      TERM37,
      [node("250"), node("142"), node("249")],
      BGRS,
    )!;
    expect(c.closesAt).toBe("2026-03-31T14:00:00.000Z"); // 17:00 EEST
    expect(c.sourceKey).toBe("interreg-bg-rs:term-37");
    expect(c.title).toBe("Second Call for SMEs");
    expect(c.datePrecision).toBe("exact");
    // Prose budget, not a labelled field — 142 must not see money from here.
    expect(c.budgetEur).toBeNull();
    expect(c.enrichment).toBe("none");
  });

  it("OPEN (synthetic): a future deadline passes through unfiltered", () => {
    // `interreg_mrrb_bgrs_node250_synthetic_open.html` is node 250 with its deadline year moved
    // to 2099 — nothing open existed to capture on 2026-10-21. Open/closed is derived at QUERY
    // time (142); this only pins that the parser does not drop a future date.
    const open = {
      url: "https://ipa-bgrs.mrrb.bg/en/term/10/node/250",
      html: fx("interreg_mrrb_bgrs_node250_synthetic_open.html"),
    };
    expect(sofiaDayOf(parseMrrbCall(TERM37, [open], BGRS)!.closesAt)).toBe(
      "2099-03-31",
    );
  });

  it("UNDATED → REJECTED: a registration deadline and a notice do not date a call", () => {
    // Node 142 carries „Deadline for registration: April 14, 2025" — a real, labelled deadline
    // that is not the call's. The term page text alone carries none either.
    const bare = {
      ...TERM37,
      html: "<main><h1>Second Call for SMEs</h1></main>",
    };
    expect(parseMrrbCall(bare, [node("142"), node("249")], BGRS)).toBeNull();
  });
});

describe("Romania–Bulgaria (robg)", () => {
  const call = (f: string, slug: string) =>
    parseCall(fx(f), `https://interregviarobg.eu/en/${slug}`, ROBG);

  it("lists closed calls AND the open-call slug shape from the index", () => {
    const urls = listCallUrls(fx("interreg_robg_index.html"), ROBG);
    expect(urls.length).toBe(7);
    expect(urls).toContain(
      "https://interregviarobg.eu/en/open-calls-for-proposals-call-6",
    );
    // Navigation under /en/ is not a call.
    expect(urls.some((u) => u.endsWith("/calls-for-proposals-1"))).toBe(false);
    // Call 7's href ends in a typo'd „%20"; kept, a fixed link would mint a second row.
    expect(urls.some((u) => /%20$|\s$/.test(u))).toBe(false);
    expect(
      urls.some((u) => u.endsWith("integrated-territorial-strategy")),
    ).toBe(true);
  });

  it('CLOSED: Call 2 — launching date and „12.00 (PM)" (noon)', () => {
    const c = call("interreg_robg_call2.html", "call-2")!;
    expect(sofiaDayOf(c.opensAt)).toBe("2023-05-10");
    expect(c.closesAt).toBe("2023-09-11T09:00:00.000Z"); // 12:00 EEST
    // The FULL name from <title>, not the site's truncated <h1> („…call for...").
    expect(c.title).toBe(
      "Call 2 - Competitive call for project proposals dedicated to Priority 2: A Green Region, Specific Objectives 2.4 and 2.7",
    );
  });

  it("an extension printed beside the original wins (Call 7)", () => {
    expect(
      sofiaDayOf(call("interreg_robg_call7.html", "call-7")!.closesAt),
    ).toBe("2026-07-15");
  });

  it("recovers Call 6's full name from a page that titles it „Call 6\"", () => {
    const c = call(
      "interreg_robg_call6.html",
      "open-calls-for-proposals-call-6",
    )!;
    expect(c.title).toMatch(/^Call 6 - Call dedicated to the operations/);
    expect(c.closesAt).toBe("2025-12-22T11:00:00.000Z"); // 13:00 EET, extended
  });

  it("OPEN (synthetic): a future deadline passes through unfiltered", () => {
    // Call 7 with its years moved to 2099 — nothing was open on 2026-10-21. Open/closed
    // is derived at QUERY time (142); this pins that the parser does not drop a future date.
    // Every year, not a pattern: the deadlines sit inside markup a phrase regex misses, and a
    // half-shifted page would let the un-shifted extension lose to the original.
    const html = fx("interreg_robg_call7.html").replace(/2026/g, "2099");
    expect(
      sofiaDayOf(
        parseCall(html, "https://interregviarobg.eu/en/call-7", ROBG)!.closesAt,
      ),
    ).toBe("2099-07-15");
  });

  it("UNDATED → REJECTED", () => {
    const html =
      '<article class="article_page"><div class="article_item-content">' +
      "Call 9 - Example. Launching date: 1st of May 2026. Guide published soon." +
      "</div></article>";
    expect(
      parseCall(html, "https://interregviarobg.eu/en/call-9", ROBG),
    ).toBeNull();
  });
});
