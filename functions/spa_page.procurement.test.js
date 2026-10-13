// /procurement/contract/<key> — a server-rendered head instead of the homepage's.
const { SITE_ORIGIN } = require("./site_origin");
const test = require("node:test");
const assert = require("node:assert");
const {
  matchSpaPage,
  isSpaPagePath,
  selfUrlFor,
  procurementContractPage,
  renderIntoShell,
  FALLBACK_SHELL,
} = require("./spa_page.js");

const ROW = {
  key: "3e86f178b8ae",
  title:
    "„Извършване на СМР на обект: „Ремонт и доизграждане коритото на река Бели Лом в регулацията на гр. Разград“, по обособени позиции“, Обособена позиция 1: …",
  lot_name:
    "„Ремонт и доизграждане коритото на река Бели Лом в регулацията на гр. Разград – първи етап“",
  awarder_eik: "000505910",
  awarder_name: "Община Разград",
  contractor_eik: "103982953",
  contractor_name: "Балкански ООД",
  amount_eur: 6797599.05,
  cpv: "45246000",
  date: "2026-02-20",
  date_signed: "2026-02-04",
  number_of_tenderers: 7,
};

test("matchSpaPage claims both contract-key shapes in both languages", () => {
  assert.deepEqual(matchSpaPage("/procurement/contract/3e86f178b8ae"), {
    kind: "procurement",
    key: "3e86f178b8ae",
    lang: "bg",
  });
  assert.deepEqual(matchSpaPage("/en/procurement/contract/obed-c946d6eff247"), {
    kind: "procurement",
    key: "obed-c946d6eff247",
    lang: "en",
  });
  assert.equal(
    selfUrlFor(matchSpaPage("/procurement/contract/3e86f178b8ae")),
    `${SITE_ORIGIN}/procurement/contract/3e86f178b8ae`,
  );
});

test("a malformed key is ours to serve but gets no invented head", () => {
  for (const p of [
    "/procurement/contract/",
    "/procurement/contract/XYZ",
    "/procurement/contract/3e86f178b8ae/extra",
    "/procurement/contract/..%2F..%2Fetc",
  ]) {
    assert.equal(matchSpaPage(p), null, p);
    assert.equal(isSpaPagePath(p), true, p);
  }
  // The browser routes beside it are not ours.
  assert.equal(isSpaPagePath("/procurement/contracts"), false);
  assert.equal(isSpaPagePath("/procurement"), false);
});

test("the head names the lot, the awarder and the figures", () => {
  const page = procurementContractPage(
    ROW,
    "bg",
    `${SITE_ORIGIN}/procurement/contract/3e86f178b8ae`,
  );
  assert.match(page.title, /първи етап/);
  assert.match(page.title, /договор на Община Разград$/);
  assert.match(page.description, /Балкански ООД/);
  assert.match(page.description, /2026-02-04/);
  assert.match(page.description, /7 оферти/);
  assert.match(page.bodyHtml, /href="[^"]+\/awarder\/000505910"/);
  assert.match(page.bodyHtml, /href="[^"]+\/company\/103982953"/);
  const html = renderIntoShell(FALLBACK_SHELL, page);
  assert.ok(!html.includes("Парламентарни избори"));
  assert.ok(
    html.includes(
      `canonical" href="${SITE_ORIGIN}/procurement/contract/3e86f178b8ae"`,
    ),
  );
});

test("the EN page canonicalises to the BG one; an unlinkable supplier gets no link", () => {
  const page = procurementContractPage(
    { ...ROW, contractor_eik: "np-1a2b3c", lot_name: null },
    "en",
    `${SITE_ORIGIN}/en/procurement/contract/3e86f178b8ae`,
  );
  assert.equal(
    page.canonicalUrl,
    `${SITE_ORIGIN}/procurement/contract/3e86f178b8ae`,
  );
  assert.ok(!page.bodyHtml.includes("/company/np-"));
  assert.match(page.title, /contract by Община Разград$/);
});

test("a NULL value is left out, never printed as 0 €", () => {
  const page = procurementContractPage(
    { ...ROW, amount_eur: null, number_of_tenderers: null },
    "bg",
    `${SITE_ORIGIN}/procurement/contract/3e86f178b8ae`,
  );
  assert.ok(!page.description.includes("0 €"));
  assert.ok(!page.bodyHtml.includes("Стойност"));
  assert.ok(!page.bodyHtml.includes("Брой оферти"));
});

test("an amendment is worded as an amendment, not as its base contract", () => {
  const url = `${SITE_ORIGIN}/procurement/contract/3e86f178b8ae`;
  const base = procurementContractPage({ ...ROW, tag: "contract" }, "bg", url);
  const amend = procurementContractPage(
    { ...ROW, tag: "contractAmendment" },
    "bg",
    url,
  );
  assert.notEqual(amend.title, base.title);
  assert.match(amend.title, /^Анекс: /);
  assert.ok(!amend.description.includes("възлага"));
  assert.match(amend.description, /^Анекс към договор/);
});
