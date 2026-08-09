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
import {
  callSlug,
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
  it("lists only programmes that were actually reachable", () => {
    // Three of Bulgaria's six cross-border programmes reset the connection on 2026-08-09 from
    // two independent clients. Listing one would produce a crawler reporting „0 calls" for a
    // site it never read — a hole that looks like a finding.
    const hosts = PROGRAMMES.map((p) => new URL(p.indexUrl).host);
    for (const blocked of [
      "ipacbc-bgrs.eu",
      "www.ipa-cbc-007.eu",
      "www.ipacbc-bgtr.eu",
    ])
      expect(hosts, blocked).not.toContain(blocked);
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
