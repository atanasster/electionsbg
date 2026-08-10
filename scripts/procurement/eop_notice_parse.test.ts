import { describe, test, expect } from "vitest";
import {
  decodeEntities,
  parseNoticePairs,
  noticeText,
  btValue,
  btValues,
  noticeFields,
  isPriceOnly,
} from "./eop_notice_parse";

/** Verbatim shape of the register's rendered form (tenderId 587133 / 00728-2026-0018). */
const row = (label: string, value: string) =>
  `<tr><td style="width: 70px;"></td><td class=' td__border'>\r\n` +
  `  <div class="label__name">  ${label}</div>\r\n` +
  `  <div class="name"> ${value}</div>\r\n</td></tr>`;

describe("decodeEntities", () => {
  // The register emits numeric character references, so a parser that skips this
  // matches nothing and reports 0% coverage on a fully-populated corpus.
  test("decodes the numeric references the register actually emits", () => {
    expect(
      decodeEntities("&#1044;&#1077;&#1081;&#1085;&#1086;&#1089;&#1090;"),
    ).toBe("Дейност");
    expect(decodeEntities("&#x414;")).toBe("Д");
    expect(decodeEntities("a&nbsp;b")).toBe("a b");
    expect(decodeEntities("&amp;&quot;")).toBe('&"');
  });

  test("leaves already-decoded Cyrillic alone", () => {
    expect(decodeEntities("Дейност")).toBe("Дейност");
  });
});

describe("parseNoticePairs", () => {
  test("extracts label, BT code and value", () => {
    const [p] = parseNoticePairs(
      row(
        "Правна категория на купувача(BT-11-Procedure-Buyer)",
        "Публичноправна организация",
      ),
    );
    expect(p).toEqual({
      label: "Правна категория на купувача",
      code: "BT-11-Procedure-Buyer",
      value: "Публичноправна организация",
    });
  });

  test("a legacy label with no code still yields a pair", () => {
    // 2020–2023 notices are keyed on the Bulgarian label; the pair must survive.
    const [p] = parseNoticePairs(
      row("Официално наименование", "ОБЩИНА СВИЛЕНГРАД"),
    );
    expect(p.code).toBeNull();
    expect(p.label).toBe("Официално наименование");
    expect(p.value).toBe("ОБЩИНА СВИЛЕНГРАД");
  });

  test("handles OPT and OPP codes, not just BT", () => {
    expect(
      parseNoticePairs(row("Купувач(OPT-300-Procedure-Buyer)", "НС"))[0].code,
    ).toBe("OPT-300-Procedure-Buyer");
  });

  test("works on entity-encoded input end to end", () => {
    const enc = row(
      "&#1044;&#1077;&#1081;(BT-10-Procedure-Buyer)",
      "&#1047;&#1076;&#1088;",
    );
    expect(parseNoticePairs(enc)[0]).toMatchObject({
      label: "Дей",
      code: "BT-10-Procedure-Buyer",
      value: "Здр",
    });
  });

  // The form renders many optional rows blank. Keeping them would make "present but
  // empty" and "answered" indistinguishable downstream.
  test("drops blank values", () => {
    expect(parseNoticePairs(row("Незададено(BT-99-Lot)", "   "))).toEqual([]);
  });

  test("keeps document order and repeats", () => {
    const html =
      row("Вид(BT-539-Lot)", "Цена") +
      row("Вид(BT-539-Lot)", "Качество") +
      row("Продължителност(BT-36-Lot)", "24 Месец");
    const pairs = parseNoticePairs(html);
    expect(pairs.map((p) => p.value)).toEqual(["Цена", "Качество", "24 Месец"]);
  });

  test("strips nested markup out of a value", () => {
    const [p] = parseNoticePairs(
      `<div class="label__name">Профил(BT-508-Procedure-Buyer)</div><div class="name"><a href="x">https://app.eop.bg/buyer/1297</a></div>`,
    );
    expect(p.value).toBe("https://app.eop.bg/buyer/1297");
  });

  test("an unparseable blob yields no pairs rather than throwing", () => {
    expect(parseNoticePairs("")).toEqual([]);
    expect(parseNoticePairs("<html><body>nothing here</body></html>")).toEqual(
      [],
    );
  });
});

describe("noticeText", () => {
  test("decodes, strips and collapses — the search payload", () => {
    expect(noticeText(row("&#1044;&#1077;&#1081;", "  a   b  "))).toContain(
      "Дей",
    );
    expect(noticeText(row("x", "  a   b  "))).not.toMatch(/\s{2,}/);
  });
});

describe("btValue / btValues", () => {
  const pairs = parseNoticePairs(
    row("Вид(BT-539-Lot)", "Цена") + row("Вид(BT-539-Lot)", "Качество"),
  );

  test("btValue takes the first, btValues takes all", () => {
    expect(btValue(pairs, "BT-539-Lot")).toBe("Цена");
    expect(btValues(pairs, "BT-539-Lot")).toEqual(["Цена", "Качество"]);
  });

  // null, not "" — a caller must be able to tell "not exposed" from "exposed blank".
  test("an absent code is null, not empty string", () => {
    expect(btValue(pairs, "BT-36-Lot")).toBeNull();
    expect(btValues(pairs, "BT-36-Lot")).toEqual([]);
  });
});

describe("noticeFields", () => {
  test("an eForms notice reports its codes", () => {
    const f = noticeFields(
      parseNoticePairs(
        row(
          "Правна категория(BT-11-Procedure-Buyer)",
          "Орган на централната власт",
        ) +
          row("Продължителност(BT-36-Lot)", "24") +
          row("Вид(BT-539-Lot)", "Цена"),
      ),
    );
    expect(f.isEforms).toBe(true);
    expect(f.btCount).toBe(3);
    expect(f.buyerLegalCategory).toBe("Орган на централната власт");
    expect(f.durationValue).toBe("24");
  });

  // ⚠️ The legacy tier must stay VISIBLY sparse — nulls, never defaults that would
  // read as "no award criteria" on 2020–2023 procedures.
  test("a legacy notice is not eForms and exposes nulls", () => {
    const f = noticeFields(
      parseNoticePairs(row("Официално наименование", "ОБЩИНА X")),
    );
    expect(f.isEforms).toBe(false);
    expect(f.btCount).toBe(0);
    expect(f.buyerLegalCategory).toBeNull();
    expect(f.durationValue).toBeNull();
    expect(f.awardCriteriaTypes).toEqual([]);
  });

  // ⚠️ Real BT-36-Lot values are BARE NUMBERS — measured "60", "90", "24", "3".
  // The unit lives in a sibling row with no `label__name`, so this parse cannot see
  // it at all. An earlier revision asserted "300 Ден", a shape that occurs in zero
  // notices, and the field was named `duration` as though the unit were present.
  test("duration is a bare number and is named as such", () => {
    const f = noticeFields(
      parseNoticePairs(row("Продължителност(BT-36-Lot)", "60")),
    );
    expect(f.durationValue).toBe("60");
  });

  // 16.6% of all pairs carry a parenthesised code; dropping it demoted them to the
  // legacy tier AND left the raw code in `label`, poisoning that tier's only key.
  test("parenthesised eForms codes are codes, not legacy labels", () => {
    const pairs = parseNoticePairs(
      row("Краен срок(BT-131(d)-Lot)", "2026-09-04") +
        row("Основание(BT-67(a)-Procedure)", "чл. 54"),
    );
    expect(pairs.map((p) => p.code)).toEqual([
      "BT-131(d)-Lot",
      "BT-67(a)-Procedure",
    ]);
    // …and the label is clean, not carrying the code text.
    expect(pairs[0].label).toBe("Краен срок");
    expect(noticeFields(pairs).offerDeadlineDate).toBe("2026-09-04");
  });

  test("script and style bodies never reach the text", () => {
    // 7.9% of a notice's raw text is CSS; without this it lands in the search index.
    const t = noticeText(
      `<style>.x{color:red}</style><div class="name">Доставка</div><script>var a=1;</script>`,
    );
    expect(t).toContain("Доставка");
    expect(t).not.toMatch(/color|var a/);
  });
});

describe("isPriceOnly", () => {
  const fieldsFor = (html: string) => noticeFields(parseNoticePairs(html));

  test("price alone is price-only", () => {
    expect(isPriceOnly(fieldsFor(row("Вид(BT-539-Lot)", "Цена")))).toBe(true);
  });

  test("price plus anything else is not", () => {
    expect(
      isPriceOnly(
        fieldsFor(
          row("Вид(BT-539-Lot)", "Цена") + row("Вид(BT-539-Lot)", "Качество"),
        ),
      ),
    ).toBe(false);
  });

  // ⚠️ Tri-state on purpose. `false` would mean "multi-criteria", and returning it
  // for the whole legacy tier — which exposes no criteria at all — would silently
  // assert something the notice never said.
  test("a notice with no criteria is null, NOT false", () => {
    expect(
      isPriceOnly(fieldsFor(row("Официално наименование", "ОБЩИНА X"))),
    ).toBeNull();
  });
});
