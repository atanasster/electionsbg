// Component guard for „Политически връзки" on the REGISTRY basis.
//
// This block puts a living politician's name next to a private individual's or a named
// company's, so its failure mode is not a wrong number — it is a claim about people. What is
// pinned here is the wording, not the layout:
//
//  1. THE OFFICE IS NAMED, never a bare „политик". „народен представител" and „общински
//     съветник" are both political links and nowhere near the same claim; the reference case
//     has one of each, from the same fixture.
//  2. THE EVIDENCE IS ON EVERY ROW — the company, and on the company page the bridge person.
//     The whole assertion is „these names appear together in the Търговски регистър", and a
//     row without its company is unverifiable.
//  3. THE NAME-MATCH CAVEAT IS IN VISIBLE BODY TEXT, not a tooltip. The registry publishes no
//     personal id, so every row is a lead. A reader on a phone never hovers.
//  4. IT IS NOT AN ACCUSATION. Co-registration is a registry fact; the copy says so, and no
//     risk/суspicion vocabulary may appear.
//  5. IT SELF-SUPPRESSES on null (migration 200 not applied) and on empty — never „(0)",
//     which is the structural zero this whole block exists to stop publishing.
//
// Hermetic: no fetch (vitest.setup throws on an unstubbed one); the block renders `<Link>` and
// `CompanyLink`, so every render goes through a MemoryRouter.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OfficeLinksBlock, type OfficeLinksPayload } from "./OfficeLinksBlock";

// The reference case: Георги Георгиев Манолов ⨝ Антон Йорданов Адамов (народен представител,
// 45 НС) at two companies neither of which ever won a public contract, plus a Pernik
// councillor. „ВИ 8 СТУДИОС" is load-bearing — it is В-initial, so it exercises `bgIn`.
const PAYLOAD: OfficeLinksPayload = {
  basis: "registry",
  count: 3,
  links: [
    {
      slug: "mp-3026",
      display_name: "Антон Йорданов Адамов",
      registryName: "АНТОН ЙОРДАНОВ АДАМОВ",
      offices: [
        { source: "mp", role: "mp", party: null },
        { source: "official_exec", role: "state_enterprise", party: null },
      ],
      uic: "206325958",
      company: "ВИ 8 СТУДИОС",
      roles: "partner",
      viaName: "Георги Георгиев Манолов",
    },
    {
      slug: "mp-3026",
      display_name: "Антон Йорданов Адамов",
      offices: [{ source: "mp", role: "mp", party: null }],
      uic: "206440670",
      company: "ТЕАТРО ВАРНА",
      roles: "partner",
      viaName: "Георги Георгиев Манолов",
    },
    {
      slug: "georgi-milev-mjs1hv",
      display_name: "Георги Костадинов Милев",
      offices: [{ source: "local", role: "councillor", party: null }],
      uic: "200556020",
      company: "ЗВЕЗДЕЛИНА БИЛДИНГ",
      roles: "partner,manager",
      viaName: "Георги Георгиев Манолов",
    },
  ],
};

const flat = (el: HTMLElement | null): string =>
  (el?.textContent ?? "").replace(/[\u00a0\u202f\u2009]/g, " ");

const show = (props: Partial<Parameters<typeof OfficeLinksBlock>[0]> = {}) =>
  render(
    <MemoryRouter>
      <OfficeLinksBlock data={PAYLOAD} {...props} />
    </MemoryRouter>,
  );

describe("OfficeLinksBlock", () => {
  it("names the OFFICE, never a bare generic label", () => {
    const { container } = show();
    const t = flat(container);
    expect(t).toMatch(/народен представител/);
    expect(t).toMatch(/общински съветник/);
    // A generic label would collapse an MP and a 2007 councillor into one claim.
    expect(t).not.toMatch(/·\s*политик\b/);
  });

  it("puts the name-match caveat in VISIBLE body text", () => {
    const { container } = show();
    const t = flat(container);
    expect(t).toMatch(/Свързването е по име/);
    expect(t).toMatch(/не публикува личен идентификатор/);
    expect(t).toMatch(/повод за проверка, не като доказателство/);
  });

  it("states the basis is the registry, not procurement", () => {
    // The whole reason the block exists: the sibling block's zero was structural because it
    // reads a procurement-derived table. A reader must be able to tell the two apart.
    const t = flat(show().container);
    expect(t).toMatch(/Основата е самото вписване/);
    expect(t).toMatch(/никога не са печелили договор с държавата/);
  });

  it("never renders co-registration as wrongdoing", () => {
    const t = flat(show().container);
    expect(t).toMatch(/не е нарушение/);
    for (const word of [/риск/i, /съмнител/i, /схема/i, /корупц/i]) {
      expect(t).not.toMatch(word);
    }
  });

  it("carries the evidence on every row", () => {
    show();
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    // the person, and the company the two share
    expect(hrefs).toContain("/person/mp-3026");
    expect(hrefs).toContain("/company/206325958");
    expect(hrefs).toContain("/company/200556020");
  });

  it("names the bridge person ONLY on the company (indirect) arm", () => {
    // On a person's own page the bridge is the subject, so „чрез <subject>" is noise. On a
    // company's page it is the entire mechanism of the claim and must be visible.
    expect(flat(show({ indirect: true }).container)).toMatch(
      /чрез\s*Георги Георгиев Манолов/,
    );
    expect(flat(show().container)).not.toMatch(/чрез/);
  });

  it("uses във before a В-initial company name", () => {
    // „в ВИ 8 СТУДИОС" was the first row this block ever rendered. The rule is shared with
    // judicialKind's `bgIn`, not restated here.
    const t = flat(show().container);
    expect(t).toMatch(/във ВИ 8 СТУДИОС/);
    // …and stays „в" where that is correct.
    expect(t).toMatch(/в ЗВЕЗДЕЛИНА БИЛДИНГ/);
  });

  it("shows the registry's own spelling only when it really differs", () => {
    // So a reader checking the Търговски регистър searches for what is written THERE — the
    // „show the registry name, never attribute it" rule. A hyphen or a lost space is the real
    // case: `normHolderName`'s corpus is full of them.
    const differs = flat(
      show({
        data: {
          ...PAYLOAD,
          count: 1,
          links: [
            {
              ...PAYLOAD.links[0],
              display_name: "Антон Йорданов Адамов",
              registryName: "АНТОН ЙОРДАНОВ-АДАМОВ",
            },
          ],
        },
      }).container,
    );
    expect(differs).toMatch(/в регистъра: „АНТОН ЙОРДАНОВ-АДАМОВ"/);

    // ⚠️ CASE ALONE IS NOT A DIFFERENT SPELLING. The registry writes officer names in caps,
    // so an exact-string comparison would append „в регистъра: „АНТОН ЙОРДАНОВ АДАМОВ"" to
    // essentially every row — noise that would bury the rows where the spelling genuinely
    // diverges. The reference fixture is exactly that case and must stay silent.
    expect(flat(show().container)).not.toMatch(/в регистъра:/);
  });

  it("renders NOTHING when the payload is null (migration 200 not applied)", () => {
    const { container } = show({ data: null });
    expect(container.textContent).toBe("");
  });

  it("renders NOTHING when there are no links — never a zero count", () => {
    const { container } = show({
      data: { basis: "registry", count: 0, links: [] },
    });
    expect(container.textContent).toBe("");
  });

  it("discloses a truncated list against `count`, not the delivered array", () => {
    // The SQL caps `links` at 100 while `count` is unbounded, so subtracting the array would
    // under-disclose — the same trap as the consortium tile's LIMIT 25.
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...PAYLOAD.links[0],
      slug: `p${i}`,
      uic: `10000000${i}`,
    }));
    const t = flat(
      show({ data: { basis: "registry", count: 40, links: many } }).container,
    );
    expect(t).toMatch(/\(40\)/);
    expect(t).toMatch(/и още 30 връзки/);
  });

  it("falls back to the EIK when the company has no name", () => {
    const t = flat(
      show({
        data: {
          ...PAYLOAD,
          count: 1,
          links: [{ ...PAYLOAD.links[0], company: null }],
        },
      }).container,
    );
    expect(t).toMatch(/206325958/);
  });
});
