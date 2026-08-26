// `RegistryFilterSelect` — the one rule that is not obvious from reading it.
//
// ⚠️ AN ACTIVE VALUE ALWAYS GETS AN ITEM. Radix renders an EMPTY trigger when the controlled
// `value` matches no `SelectItem` — not the placeholder, empty — so a deep link to a value the
// facet does not offer shows a blank box over a table that IS filtered: the reader sees the
// effect and not the cause. Both registries reach that state by live paths (/persons' role and
// party facets are of the representative seat while the filter matches every seat; on
// /companies any narrowing can drop the selected value out of its own facet), which is why the
// rule lives in the shared component rather than in either page.

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { RegistryFilterSelect } from "./RegistryFilterSelect";
import {
  registryOptionLabel,
  registrySelectWillRender,
} from "./registryFilterRules";

const base = {
  onChange: () => {},
  allLabel: "ВСИЧКИ",
  allValue: "__all__",
  options: [
    { value: "ngo_assoc", label: "сдружение", count: 21_815 },
    { value: "coop", label: "кооперация", count: 2_708 },
  ],
};

describe("RegistryFilterSelect", () => {
  it("shows the active value in the trigger when the facet offers it", () => {
    render(<RegistryFilterSelect {...base} value="coop" />);
    expect(screen.getByRole("combobox").textContent).toMatch(/кооперация/);
  });

  it("⚠️ shows an active value the facet does NOT offer, rather than a blank box", () => {
    // The whole reason this component is not a bare Select. Without the synthesised item the
    // trigger renders empty and the page says nothing about why the table is narrowed.
    render(<RegistryFilterSelect {...base} value="state_enterprise" />);
    expect(screen.getByRole("combobox").textContent).toMatch(
      /state_enterprise/,
    );
  });

  it("shows the all-label when nothing is selected", () => {
    render(<RegistryFilterSelect {...base} value="__all__" />);
    expect(screen.getByRole("combobox").textContent).toMatch(/ВСИЧКИ/);
  });

  it("takes the sentinel as a PROP — a shared control must not import a page's URL module", () => {
    // Both registries spell it "__all__" today, but each owns its own constant. A component
    // that imported PERSON_FILTER_ALL would make /companies depend on /persons' URL contract.
    render(<RegistryFilterSelect {...base} allValue="NONE" value="NONE" />);
    expect(screen.getByRole("combobox").textContent).toMatch(/ВСИЧКИ/);
  });

  it("renders nothing when there are no options and no active value", () => {
    // A picker offering only „всички" is a control that cannot do anything.
    const { container } = render(
      <RegistryFilterSelect {...base} options={[]} value="__all__" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("still renders when the ONLY item is a facet-less active value", () => {
    const { container } = render(
      <RegistryFilterSelect {...base} options={[]} value="SOF46" />,
    );
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByRole("combobox").textContent).toMatch(/SOF46/);
  });

  it("names itself for a screen reader", () => {
    // The trigger otherwise announces only its current value, so a reader hears „кооперация"
    // with no indication of which dimension it filters.
    render(<RegistryFilterSelect {...base} value="coop" label="Вид" />);
    expect(screen.getByRole("combobox", { name: "Вид" })).toBeInTheDocument();
  });

  it("prefers a VISIBLE label over its own string", () => {
    render(
      <>
        <span id="lbl">Състояние</span>
        <RegistryFilterSelect
          {...base}
          value="coop"
          label="ignored"
          labelledBy="lbl"
        />
      </>,
    );
    expect(
      screen.getByRole("combobox", { name: "Състояние" }),
    ).toBeInTheDocument();
  });
});

describe("registryOptionLabel", () => {
  it("⚠️ formats the count for the LOCALE — the separator is not cosmetic", () => {
    // „21 815" (BG, a non-breaking space) and „21,815" are different strings, and this picker
    // sits beside a KPI band formatting the same figures. Asserted on the digits plus a
    // separator character class rather than on a literal, because the exact space codepoint is
    // an ICU implementation detail.
    expect(
      registryOptionLabel(
        { value: "a", label: "сдружение", count: 21_815 },
        "bg-BG",
      ),
    ).toMatch(/^сдружение \(21[\s\u00a0\u202f]815\)$/);
    expect(
      registryOptionLabel(
        { value: "a", label: "assoc", count: 21_815 },
        "en-US",
      ),
    ).toBe("assoc (21,815)");
  });

  it("omits the count where the facet column and the filter column differ", () => {
    // A count that under-promises what clicking returns is worse than no count.
    expect(
      registryOptionLabel({ value: "a", label: "кооперация" }, "bg-BG"),
    ).toBe("кооперация");
  });

  it("⚠️ RENDERS a zero count — the guard is `!= null`, not falsiness", () => {
    // „(0)" is a true statement about a facet bucket that exists and is empty. Suppressing it
    // would make an empty bucket indistinguishable from a column with no counts at all.
    expect(
      registryOptionLabel(
        { value: "a", label: "кооперация", count: 0 },
        "bg-BG",
      ),
    ).toBe("кооперация (0)");
  });
});

describe("registrySelectWillRender", () => {
  it("is false only for an empty vocabulary with nothing selected", () => {
    // The bar asks this so a picker's LABEL does not render over a picker that does not.
    expect(registrySelectWillRender([], "__all__", "__all__")).toBe(false);
    expect(registrySelectWillRender([], "SOF46", "__all__")).toBe(true);
    expect(
      registrySelectWillRender(
        [{ value: "coop", label: "к" }],
        "__all__",
        "__all__",
      ),
    ).toBe(true);
  });

  it("agrees with what the component actually does", () => {
    // The two must not drift — the bar's label suppression is only correct while they agree.
    for (const [options, value] of [
      [[], "__all__"],
      [[], "SOF46"],
      [[{ value: "coop", label: "к" }], "__all__"],
    ] as const) {
      const { container } = render(
        <RegistryFilterSelect {...base} options={[...options]} value={value} />,
      );
      expect(container.firstChild !== null).toBe(
        registrySelectWillRender(options, value, "__all__"),
      );
    }
  });
});
